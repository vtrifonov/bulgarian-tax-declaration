import {
    useRef,
    useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-state';
import {
    importHoldingsFromExcel,
    t,
} from '@bg-tax/core';
import type { AppState } from '@bg-tax/core';

type ImportOption = 'none' | 'json' | 'excel' | 'fresh';

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
            if (importOption === 'json') {
                const text = await file.text();
                const data = JSON.parse(text) as Partial<AppState>;
                if (data.holdings && Array.isArray(data.holdings)) {
                    importHoldings(data.holdings);
                    setImportStatus(`Imported ${data.holdings.length} holdings from JSON`);
                } else {
                    setImportError('JSON file does not contain a "holdings" array');
                }
            } else if (importOption === 'excel') {
                const buffer = await file.arrayBuffer();
                const holdings = await importHoldingsFromExcel(buffer);
                importHoldings(holdings);
                setImportStatus(`Imported ${holdings.length} holdings from Excel`);
            }
        } catch (err) {
            setImportError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const options: { value: ImportOption; label: string; description: string; accept?: string }[] = [
        { value: 'fresh', label: t('import.fresh'), description: t('import.freshDesc') },
        { value: 'json', label: t('import.json'), description: "Previous year's app export — recommended, lossless", accept: '.json' },
        { value: 'excel', label: t('import.excel'), description: "Previous year's Данъчна {YEAR}.xlsx — reads Притежания sheet", accept: '.xlsx' },
    ];

    return (
        <div style={{ padding: '2rem', maxWidth: '600px' }}>
            <h1>{t('page.setup')}</h1>

            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    {t('label.taxYear')}
                </label>
                <input
                    type='number'
                    value={taxYear}
                    onChange={(e) => handleYearChange(parseInt(e.target.value))}
                    min={2025}
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

            {(importOption === 'json' || importOption === 'excel') && (
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
    );
}
