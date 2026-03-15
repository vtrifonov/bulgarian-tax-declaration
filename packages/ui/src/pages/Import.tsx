import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-state';
import { parseIBCsv, parseRevolutCsv, matchWhtToDividends, resolveCountry, calcDividendTax, FxService, InMemoryFxCache } from '@bg-tax/core';
import type { IBParsedData, RevolutInterest } from '@bg-tax/core';

interface ImportedFile {
  name: string;
  type: 'ib' | 'revolut';
  status: 'success' | 'error';
  message: string;
}

function detectFileType(content: string, filename: string): 'ib' | 'revolut' | null {
  if (content.startsWith('Statement,Header,Field Name')) return 'ib';
  if (filename.startsWith('savings-statement') || content.includes('Interest PAID')) return 'revolut';
  // Check for IB CSV by looking for known sections
  if (content.includes('Trades,Header,DataDiscriminator')) return 'ib';
  return null;
}

export function Import() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importedFiles, setImportedFiles] = useState<ImportedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fetchingFx, setFetchingFx] = useState(false);

  const {
    importHoldings, importDividends,
    importStockYield, importRevolutInterest,
    setFxRates, taxYear, baseCurrency,
    holdings,
  } = useAppStore();

  const processFile = useCallback(async (file: File) => {
    const content = await file.text();
    const fileType = detectFileType(content, file.name);

    if (!fileType) {
      setImportedFiles(prev => [...prev, {
        name: file.name,
        type: 'ib',
        status: 'error',
        message: 'Unrecognized file format. Expected IB activity statement or Revolut savings CSV.',
      }]);
      return;
    }

    try {
      if (fileType === 'ib') {
        const parsed: IBParsedData = parseIBCsv(content);

        // Match WHT to dividends
        const { matched, unmatched } = matchWhtToDividends(parsed.dividends, parsed.withholdingTax);
        const allDividends = [...matched, ...unmatched];

        // Resolve countries and calculate BG tax for dividends
        for (const d of allDividends) {
          d.country = resolveCountry(d.symbol);
          // Calculate BG tax due and WHT credit (amounts are in original currency for now,
          // final base-currency conversion happens at export/declaration time)
          const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);
          d.bgTaxDue = bgTaxDue;
          d.whtCredit = whtCredit;
        }
        importDividends(allDividends);
        importStockYield(parsed.stockYield);

        // For trades, we need FIFO processing — store buys as holdings for now
        // Sells will be processed when user has all data loaded
        const buys = parsed.trades.filter(t => t.quantity > 0);
        const newHoldings = buys.map(t => ({
          id: crypto.randomUUID(),
          broker: 'IB',
          country: resolveCountry(t.symbol),
          symbol: t.symbol,
          dateAcquired: t.dateTime.split(',')[0].trim(),
          quantity: t.quantity,
          currency: t.currency,
          unitPrice: t.price,
        }));
        importHoldings([...holdings, ...newHoldings]);

        const sells = parsed.trades.filter(t => t.quantity < 0).length;

        setImportedFiles(prev => [...prev, {
          name: file.name,
          type: 'ib',
          status: 'success',
          message: `${buys.length} buys, ${sells} sells, ${allDividends.length} dividends, ${parsed.stockYield.length} stock yield entries`,
        }]);
      } else {
        const revolut: RevolutInterest = parseRevolutCsv(content);
        const existing = useAppStore.getState().revolutInterest;
        importRevolutInterest([...existing, revolut]);

        const netInterest = revolut.entries.reduce((sum, e) => sum + e.amount, 0);

        setImportedFiles(prev => [...prev, {
          name: file.name,
          type: 'revolut',
          status: 'success',
          message: `${revolut.currency}: ${revolut.entries.length} entries, net ${netInterest.toFixed(2)} ${revolut.currency}`,
        }]);
      }
    } catch (err) {
      setImportedFiles(prev => [...prev, {
        name: file.name,
        type: fileType,
        status: 'error',
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    }
  }, [holdings, importHoldings, importDividends, importStockYield, importRevolutInterest]);

  const processFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      if (file.name.endsWith('.csv')) {
        processFile(file);
      } else {
        setImportedFiles(prev => [...prev, {
          name: file.name,
          type: 'ib',
          status: 'error',
          message: 'Only .csv files are supported',
        }]);
      }
    });
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = ''; // Reset so same file can be re-selected
    }
  }, [processFiles]);

  return (
    <div style={{ padding: '2rem', maxWidth: '700px' }}>
      <h1>Data Import</h1>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          border: `3px dashed ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: '12px',
          padding: '3rem 2rem',
          textAlign: 'center',
          backgroundColor: isDragOver ? 'var(--drop-bg)' : 'var(--card-bg)',
          cursor: 'pointer',
          transition: 'all 0.2s',
          marginBottom: '1.5rem',
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
          {isDragOver ? '📂' : '📄'}
        </div>
        <p style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>
          {isDragOver ? 'Drop files here' : 'Drag & drop CSV files here'}
        </p>
        <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>or</p>
        <button
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          style={{
            padding: '0.6rem 1.5rem',
            fontSize: '1rem',
            backgroundColor: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Browse Files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '1rem', marginBottom: 0 }}>
          Supported: Interactive Brokers CSV, Revolut Savings CSV
        </p>
      </div>

      {/* Imported files list */}
      {importedFiles.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Imported Files</h3>
          {importedFiles.map((f, i) => (
            <div
              key={i}
              style={{
                padding: '0.75rem 1rem',
                marginBottom: '0.5rem',
                borderRadius: '6px',
                backgroundColor: f.status === 'success' ? 'var(--success-bg)' : 'var(--error-bg)',
                border: `1px solid ${f.status === 'success' ? 'var(--success-border)' : 'var(--error-border)'}`,
              }}
            >
              <div style={{ fontWeight: 'bold' }}>
                {f.status === 'success' ? '✅' : '❌'} {f.name}
                <span style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.8rem',
                  backgroundColor: f.type === 'ib' ? 'var(--accent)' : '#28a745',
                  color: 'white',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '3px',
                }}>
                  {f.type === 'ib' ? 'IB' : 'Revolut'}
                </span>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                {f.message}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        disabled={fetchingFx}
        onClick={async () => {
          // Collect all currencies from imported data
          const state = useAppStore.getState();
          const currencies = new Set<string>();
          for (const h of state.holdings) if (h.currency) currencies.add(h.currency);
          for (const d of state.dividends) if (d.currency) currencies.add(d.currency);
          for (const s of state.stockYield) if (s.currency) currencies.add(s.currency);
          for (const r of state.revolutInterest) if (r.currency) currencies.add(r.currency);

          // Fetch FX rates from ECB
          const needed = [...currencies].filter(c => c !== 'BGN' && c !== 'EUR');
          if (needed.length > 0) {
            setFetchingFx(true);
            try {
              const fxService = new FxService(new InMemoryFxCache(), baseCurrency);
              const rates = await fxService.fetchRates(needed, taxYear);
              setFxRates(rates);
            } catch (err) {
              console.error('Failed to fetch FX rates:', err);
            } finally {
              setFetchingFx(false);
            }
          }

          navigate('/workspace');
        }}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          backgroundColor: importedFiles.some(f => f.status === 'success') ? 'var(--accent)' : 'var(--border)',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          opacity: fetchingFx ? 0.7 : 1,
        }}
      >
        {fetchingFx ? 'Fetching FX rates...' : 'Continue to Workspace'}
      </button>
    </div>
  );
}
