import {
    useRef,
    useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-state';
import {
    importFullExcel,
    importHoldingsFromCsv,
    importHoldingsFromExcel,
    t,
} from '@bg-tax/core';

type ImportOption = 'none' | 'excel' | 'excel-full' | 'fresh';

export function YearSetup() {
    const navigate = useNavigate();
    const { taxYear, baseCurrency, setTaxYear, setBaseCurrency, importHoldings, reset } = useAppStore();
    const [importOption, setImportOption] = useState<ImportOption>('fresh');
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleYearChange = (year: number) => {
        setTaxYear(year);
        setBaseCurrency(year <= 2025 ? 'BGN' : 'EUR');
    };

    const handleFileImport = async (file: File) => {
        setImportError(null);
        setImportStatus(null);

        try {
            if (importOption === 'excel') {
                let holdings;
                if (file.name.endsWith('.csv')) {
                    const text = await file.text();
                    holdings = importHoldingsFromCsv(text);
                } else {
                    const buffer = await file.arrayBuffer();
                    holdings = await importHoldingsFromExcel(buffer);
                }
                for (const h of holdings) h.source = { type: 'Initial import', file: file.name };
                importHoldings(holdings);
                setImportStatus(`Imported ${holdings.length} holdings`);
            } else if (importOption === 'excel-full') {
                const buffer = await file.arrayBuffer();
                const data = await importFullExcel(buffer);
                const { importSales, importDividends, importStockYield, importIbInterest, importRevolutInterest } = useAppStore.getState();
                const parts: string[] = [];
                if (data.holdings.length) {
                    for (const h of data.holdings) h.source = { type: 'Initial import', file: file.name };
                    importHoldings(data.holdings);
                    parts.push(`${data.holdings.length} притежания`);
                }
                if (data.sales.length) {
                    for (const s of data.sales) s.source = { type: 'Initial import', file: file.name };
                    importSales(data.sales);
                    parts.push(`${data.sales.length} продажби`);
                }
                if (data.dividends.length) {
                    for (const d of data.dividends) d.source = { type: 'Initial import', file: file.name };
                    importDividends(data.dividends);
                    parts.push(`${data.dividends.length} дивиденти`);
                }
                if (data.stockYield.length) {
                    importStockYield(data.stockYield);
                    parts.push(`${data.stockYield.length} stock yield`);
                }
                if (data.ibInterest.length) {
                    for (const i of data.ibInterest) i.source = { type: 'Initial import', file: file.name };
                    importIbInterest(data.ibInterest);
                    parts.push(`${data.ibInterest.length} IB лихви`);
                }
                if (data.revolutInterest.length) {
                    importRevolutInterest(data.revolutInterest);
                    parts.push(`${data.revolutInterest.length} Revolut лихви`);
                }
                setImportStatus(parts.length > 0 ? `Imported: ${parts.join(', ')}` : 'No data found in file');
            }
        } catch (err) {
            setImportError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const options: { value: ImportOption; label: string; description: string; accept?: string }[] = [
        { value: 'fresh', label: t('import.fresh'), description: t('import.freshDesc') },
        {
            value: 'excel',
            label: `Притежания от предходна година (Excel, CSV)`,
            description: `Зарежда само притежанията от миналогодишния файл Данъчна_${
                taxYear - 1
            }.xlsx (лист "Притежания") или CSV с колони: Брокер, Символ, Държава, Дата, Количество, Валута, Цена`,
            accept: '.xlsx,.csv',
        },
        {
            value: 'excel-full',
            label: `Продължи от Данъчна_${taxYear}.xlsx`,
            description: 'Зарежда всички данни (притежания, продажби, дивиденти, лихви, курсове) от файл на приложението',
            accept: '.xlsx',
        },
    ];

    return (
        <div style={{ padding: '2rem', display: 'flex', gap: '3rem' }}>
            <div style={{ maxWidth: '600px', flex: 1 }}>
                <h1>{t('page.setup')}</h1>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                        {t('label.taxYear')}
                    </label>
                    <input
                        type='number'
                        value={taxYear}
                        onChange={(e) => handleYearChange(parseInt(e.target.value))}
                        min={2024}
                        max={2035}
                        style={{ padding: '0.5rem', fontSize: '1rem', width: '120px' }}
                    />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                        {t('label.baseCurrency')}
                    </label>
                    <div
                        style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: 'var(--bg-secondary)',
                            borderRadius: '4px',
                            display: 'inline-block',
                            fontSize: '1rem',
                        }}
                    >
                        {baseCurrency}
                        <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            {baseCurrency === 'BGN' ? t('label.fixedFor2025') : t('label.fixedFor2026')}
                        </span>
                    </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                        {t('label.importHoldings')}
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {options.map((opt) => (
                            <label
                                key={opt.value}
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '0.5rem',
                                    padding: '0.75rem 1rem',
                                    borderRadius: '6px',
                                    border: `1px solid ${importOption === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                                    backgroundColor: importOption === opt.value ? 'var(--drop-bg)' : 'transparent',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type='radio'
                                    name='importOption'
                                    value={opt.value}
                                    checked={importOption === opt.value}
                                    onChange={() => {
                                        setImportOption(opt.value);
                                        setImportStatus(null);
                                        setImportError(null);
                                    }}
                                    style={{ marginTop: '0.2rem' }}
                                />
                                <div>
                                    <div style={{ fontWeight: 500 }}>{opt.label}</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{opt.description}</div>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                {(importOption === 'excel' || importOption === 'excel-full') && (
                    <div style={{ marginBottom: '1.5rem' }}>
                        <input
                            ref={fileInputRef}
                            type='file'
                            accept={options.find(o => o.value === importOption)?.accept}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileImport(file);
                            }}
                            style={{ display: 'none' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    padding: '0.6rem 1.5rem',
                                    fontSize: '1rem',
                                    backgroundColor: 'var(--bg-secondary)',
                                    color: 'var(--text)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                {t('button.chooseFile')}
                            </button>
                            {importOption === 'excel' && (
                                <a
                                    href='/holdings-template.csv'
                                    download='holdings-template.csv'
                                    style={{ fontSize: '0.85rem', color: 'var(--accent)' }}
                                >
                                    Изтегли шаблон (CSV)
                                </a>
                            )}
                        </div>
                    </div>
                )}

                {importStatus && (
                    <div
                        style={{
                            padding: '0.75rem 1rem',
                            marginBottom: '1rem',
                            borderRadius: '6px',
                            backgroundColor: 'var(--success-bg)',
                            border: '1px solid var(--success-border)',
                        }}
                    >
                        {importStatus}
                    </div>
                )}

                {importError && (
                    <div
                        style={{
                            padding: '0.75rem 1rem',
                            marginBottom: '1rem',
                            borderRadius: '6px',
                            backgroundColor: 'var(--error-bg)',
                            border: '1px solid var(--error-border)',
                        }}
                    >
                        {importError}
                    </div>
                )}

                <button
                    onClick={() => navigate('/import')}
                    style={{
                        padding: '0.75rem 2rem',
                        fontSize: '1rem',
                        backgroundColor: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                    }}
                >
                    {t('button.continue')}
                </button>

                <button
                    onClick={() => {
                        if (confirm('This will clear all imported data. Are you sure?')) {
                            reset();
                            localStorage.removeItem('bg-tax-autosave');
                            setImportStatus(null);
                            setImportError(null);
                            setImportOption('fresh');
                        }
                    }}
                    style={{
                        padding: '0.75rem 2rem',
                        fontSize: '1rem',
                        backgroundColor: 'transparent',
                        color: '#dc3545',
                        border: '1px solid #dc3545',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginLeft: '1rem',
                    }}
                >
                    {t('button.reset')}
                </button>
            </div>

            <div
                style={{
                    maxWidth: '300px',
                    padding: '1.5rem',
                    backgroundColor: 'var(--card-bg)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    alignSelf: 'flex-start',
                    marginTop: '3rem',
                }}
            >
                <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>&#128274;</div>
                <p style={{ fontSize: '0.95rem', color: 'var(--text)', margin: 0, lineHeight: 1.6, fontWeight: 500 }}>
                    {t('privacy.notice')}
                </p>
            </div>
        </div>
    );
}
