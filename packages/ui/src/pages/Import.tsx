import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-state';
import {
    calcDividendTax,
    FifoEngine,
    FxService,
    InMemoryFxCache,
    matchWhtToDividends,
    parseIBCsv,
    parseRevolutCsv,
    resolveCountry,
} from '@bg-tax/core';
import type {
    IBParsedData,
    RevolutInterest,
} from '@bg-tax/core';

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
        importHoldings,
        importSales,
        importDividends,
        importStockYield,
        importRevolutInterest,
        setFxRates,
        taxYear,
        baseCurrency,
        holdings,
    } = useAppStore();

    // Auto-fetch FX rates when new currencies are detected
    useEffect(() => {
        const state = useAppStore.getState();
        const currencies = new Set<string>();
        for (const h of state.holdings) if (h.currency) currencies.add(h.currency);
        for (const d of state.dividends) if (d.currency) currencies.add(d.currency);
        for (const s of state.stockYield) if (s.currency) currencies.add(s.currency);
        for (const r of state.revolutInterest) if (r.currency) currencies.add(r.currency);

        const needed = [...currencies].filter(c => c !== 'BGN' && c !== 'EUR');
        if (needed.length === 0) return;

        // Check if we already have rates for all needed currencies
        const existing = Object.keys(state.fxRates);
        const missing = needed.filter(c => !existing.includes(c));
        if (missing.length === 0) return;

        setFetchingFx(true);
        const fxService = new FxService(new InMemoryFxCache(), baseCurrency);
        fxService.fetchRates(needed, taxYear).then(rates => {
            setFxRates(rates);
            setFetchingFx(false);
        }).catch(() => {
            setFetchingFx(false);
        });
    }, [importedFiles.length]); // Re-run after each file import

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

                // Build country map for FIFO engine
                const countryMap: Record<string, string> = {};
                for (const t of parsed.trades) {
                    countryMap[t.symbol] = resolveCountry(t.symbol);
                }

                // FIFO: process all trades (buys + sells) against existing holdings
                const fifo = new FifoEngine([...holdings]);
                const { holdings: newHoldings, sales: newSales, warnings } = fifo.processTrades(parsed.trades, 'IB', countryMap);

                importHoldings(newHoldings);
                importSales(newSales);

                const buys = parsed.trades.filter(t => t.quantity > 0).length;
                const sells = parsed.trades.filter(t => t.quantity < 0).length;
                const warnMsg = warnings.length > 0 ? ` (${warnings.length} warnings)` : '';

                setImportedFiles(prev => [...prev, {
                    name: file.name,
                    type: 'ib',
                    status: 'success',
                    message:
                        `${buys} buys, ${sells} sells → ${newSales.length} matched sales, ${newHoldings.length} remaining holdings, ${allDividends.length} dividends, ${parsed.stockYield.length} stock yield${warnMsg}`,
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
        <div style={{ padding: '2rem' }}>
            <h1>Data Import</h1>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'start' }}>
                {/* Left column: drop zone + files + continue */}
                <div>
                    {/* Drop zone */}
                    <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        style={{
                            border: `3px dashed ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: '12px',
                            padding: '1.5rem 2rem',
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
                            type='file'
                            accept='.csv'
                            multiple
                            onChange={handleFileInput}
                            style={{ display: 'none' }}
                        />
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '1rem', marginBottom: 0 }}>
                            Supported: Interactive Brokers CSV, Revolut Savings CSV
                        </p>
                    </div>

                    {/* FX Rate loading indicator */}
                    {fetchingFx && (
                        <div
                            style={{
                                padding: '0.75rem 1rem',
                                marginBottom: '1rem',
                                borderRadius: '6px',
                                backgroundColor: 'var(--drop-bg)',
                                border: '1px solid var(--accent)',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <div
                                    style={{
                                        width: '16px',
                                        height: '16px',
                                        border: '2px solid var(--accent)',
                                        borderTopColor: 'transparent',
                                        borderRadius: '50%',
                                        animation: 'spin 0.8s linear infinite',
                                    }}
                                />
                                Fetching FX rates from ECB...
                            </div>
                            <div style={{ height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div
                                    style={{
                                        height: '100%',
                                        backgroundColor: 'var(--accent)',
                                        borderRadius: '2px',
                                        animation: 'progress 2s ease-in-out infinite',
                                    }}
                                />
                            </div>
                            <style>
                                {`
                        @keyframes spin { to { transform: rotate(360deg); } }
                        @keyframes progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
                    `}
                            </style>
                        </div>
                    )}

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
                                        <span
                                            style={{
                                                marginLeft: '0.5rem',
                                                fontSize: '0.8rem',
                                                backgroundColor: f.type === 'ib' ? 'var(--accent)' : '#28a745',
                                                color: 'white',
                                                padding: '0.1rem 0.4rem',
                                                borderRadius: '3px',
                                            }}
                                        >
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

                {/* Right column: instructions */}
                <div
                    style={{
                        padding: '1.25rem',
                        backgroundColor: 'var(--bg-secondary)',
                        borderRadius: '8px',
                        fontSize: '0.9rem',
                        lineHeight: '1.6',
                    }}
                >
                    <h3 style={{ marginBottom: '0.75rem' }}>How to export your statements</h3>
                    <div style={{ marginBottom: '0.75rem' }}>
                        <strong>Interactive Brokers:</strong>
                        <ol style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                            <li>
                                Go to <em>Performance & Reports → Statements</em>
                            </li>
                            <li>
                                Click <em>Activity</em> statement
                            </li>
                            <li>
                                Period: <strong>Annual</strong> (or custom: Jan 1 — Dec 31)
                            </li>
                            <li>
                                Format: <strong>CSV</strong>
                            </li>
                            <li>
                                Click <em>Run</em>, then download the file
                            </li>
                        </ol>
                    </div>
                    <div>
                        <strong>Revolut Savings:</strong>
                        <ol style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                            <li>
                                Go to <em>Savings → your vault → Statements</em>
                            </li>
                            <li>Select the tax year period</li>
                            <li>Download one CSV per currency vault (EUR, USD, GBP)</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    );
}
