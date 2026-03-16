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
    t,
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
        importIbInterest,
        importRevolutInterest,
        setFxRates,
        taxYear,
        baseCurrency,
        holdings,
    } = useAppStore();

    // Auto-fetch FX rates when new currencies are detected — includes prior-year dates
    useEffect(() => {
        const state = useAppStore.getState();
        const currencies = new Set<string>();
        const years = new Set<number>();
        years.add(taxYear);

        // Collect all currencies and years from data
        for (const h of state.holdings) {
            if (h.currency) currencies.add(h.currency);
            if (h.dateAcquired) years.add(parseInt(h.dateAcquired.substring(0, 4)));
        }
        for (const d of state.dividends) {
            if (d.currency) currencies.add(d.currency);
            if (d.date) years.add(parseInt(d.date.substring(0, 4)));
        }
        for (const s of state.stockYield) if (s.currency) currencies.add(s.currency);
        for (const i of state.ibInterest) {
            if (i.currency) currencies.add(i.currency);
            if (i.date) years.add(parseInt(i.date.substring(0, 4)));
        }
        for (const r of state.revolutInterest) if (r.currency) currencies.add(r.currency);

        const needed = [...currencies].filter(c => c !== 'BGN' && c !== 'EUR');
        if (needed.length === 0) return;

        // Check if we need to fetch any missing year+currency combo
        const yearsArr = [...years].filter(y => y >= 2020).sort();
        let hasMissing = false;
        for (const ccy of needed) {
            for (const yr of yearsArr) {
                const dateToCheck = `${yr}-06-15`;
                if (!state.fxRates[ccy]?.[dateToCheck]) {
                    hasMissing = true;
                    break;
                }
            }
            if (hasMissing) break;
        }
        if (!hasMissing) return;

        setFetchingFx(true);
        const fxService = new FxService(new InMemoryFxCache(), baseCurrency);
        // Fetch all needed years in parallel
        Promise.all(
            yearsArr.map(yr => fxService.fetchRates(needed, yr)),
        ).then(results => {
            // Merge all year results
            const merged: Record<string, Record<string, number>> = {};
            for (const rates of results) {
                for (const [ccy, dateRates] of Object.entries(rates)) {
                    merged[ccy] = { ...merged[ccy], ...dateRates };
                }
            }
            setFxRates(merged);
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

                // Check for duplicate IB holdings
                const duplicateHoldings: Set<string> = new Set();
                for (const trade of parsed.trades) {
                    const tradeDate = trade.dateTime.split(' ')[0]; // Extract YYYY-MM-DD from "YYYY-MM-DD HH:MM:SS"
                    for (const existingHolding of holdings) {
                        if (
                            existingHolding.broker === 'IB'
                            && existingHolding.symbol === trade.symbol
                            && existingHolding.dateAcquired === tradeDate
                            && existingHolding.quantity === Math.abs(trade.quantity)
                        ) {
                            duplicateHoldings.add(`${trade.symbol}-${tradeDate}-${trade.quantity}`);
                        }
                    }
                }

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
                importIbInterest(parsed.interest);

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
                const dupMsg = duplicateHoldings.size > 0 ? ` [WARNING: ${duplicateHoldings.size} potential duplicate holdings detected]` : '';

                setImportedFiles(prev => [...prev, {
                    name: file.name,
                    type: 'ib',
                    status: 'success',
                    message:
                        `${buys} buys, ${sells} sells → ${newSales.length} matched sales, ${newHoldings.length} remaining holdings, ${allDividends.length} dividends, ${parsed.stockYield.length} stock yield, ${parsed.interest.length} interest${warnMsg}${dupMsg}`,
                }]);
            } else {
                const revolut: RevolutInterest = parseRevolutCsv(content);
                const existing = useAppStore.getState().revolutInterest;

                // Check for duplicate Revolut currency
                const isDuplicate = existing.some(r => r.currency === revolut.currency);

                if (isDuplicate) {
                    setImportedFiles(prev => [...prev, {
                        name: file.name,
                        type: 'revolut',
                        status: 'error',
                        message: `This file appears to already be imported (${revolut.currency} already exists). Skipping to prevent duplicates.`,
                    }]);
                    return;
                }

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
    }, [holdings, importHoldings, importDividends, importStockYield, importIbInterest, importRevolutInterest]);

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
            <h1>{t('page.import')}</h1>

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
                            {isDragOver ? t('import.dropHere') : t('import.dragDrop')}
                        </p>
                        <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>{t('import.or')}</p>
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
                            {t('button.browseFiles')}
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
                            {t('import.supported')}
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
                                {t('import.fetchingFx')}
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
                            <h3 style={{ marginBottom: '0.5rem' }}>{t('import.importedFiles')}</h3>
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
                        onClick={() => navigate('/workspace')}
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
                        {fetchingFx ? 'Fetching FX rates...' : t('button.continue')}
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
                    <h3 style={{ marginBottom: '0.75rem' }}>{t('import.howTo')}</h3>
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
