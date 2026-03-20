import {
    assembleSpb8,
    fetchYearEndPrices,
    fxToBaseCurrency,
    generateSpb8Excel,
    resolveIsinSync,
    t,
} from '@bg-tax/core';
import type { Spb8PersonalData } from '@bg-tax/core';
import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';

import { useAppStore } from '../store/app-state';

function getPriceFetch(): typeof fetch {
    // Always proxy through Vite in dev, or use Tauri HTTP plugin in desktop
    return (async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
        const isTauri = '__TAURI_INTERNALS__' in window;

        if (isTauri) {
            const mod = await import('@tauri-apps/plugin-http');

            return mod.fetch(urlStr, init);
        }

        // Browser dev mode — proxy through Vite
        const proxied = urlStr
            .replace('https://stooq.com', '/api/stooq')
            .replace('https://query1.finance.yahoo.com', '/api/yahoo');

        return fetch(proxied, init);
    }) as typeof fetch;
}

export function Spb8() {
    const {
        holdings,
        sales,
        fxRates,
        taxYear,
        foreignAccounts,
        spb8PersonalData,
        addForeignAccount,
        updateForeignAccount,
        deleteForeignAccount,
        updateHolding,
        setSpb8PersonalData,
    } = useAppStore();

    const [reportType, setReportType] = useState<'P' | 'R'>('P');
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const toggleSection = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportSuccess, setExportSuccess] = useState<string | null>(null);

    const [editingAccount, setEditingAccount] = useState<number | null>(null);

    const [editingPersonal, setEditingPersonal] = useState(false);
    const [personalDataForm, setPersonalDataForm] = useState<Spb8PersonalData>(spb8PersonalData || {});

    // Display data: use store (survives async load), edit form uses local state
    const displayPersonal = editingPersonal ? personalDataForm : (spb8PersonalData || personalDataForm);

    // User-entered year-end market prices per ISIN (for threshold calculation)
    const yearEndPrices = useAppStore(s => s.yearEndPrices);
    const setYearEndPrices = useAppStore(s => s.setYearEndPrices);
    const [priceFetchProgress, setPriceFetchProgress] = useState<string | null>(null);
    const [priceFetchError, setPriceFetchError] = useState<string | null>(null);

    useEffect(() => {
        for (const [index, holding] of holdings.entries()) {
            if (holding.consumedByFifo || holding.isin || !holding.symbol) {
                continue;
            }
            const isin = resolveIsinSync(holding.symbol);

            if (!isin) {
                continue;
            }

            updateHolding(index, { ...holding, isin });
        }
    }, [holdings, updateHolding]);

    // Assemble SPB-8 data
    const spb8Data = useMemo(() => {
        try {
            const assembled = assembleSpb8(
                {
                    taxYear,
                    baseCurrency: taxYear >= 2026 ? 'EUR' : 'BGN',
                    language: 'en',
                    holdings,
                    sales,
                    dividends: [],
                    stockYield: [],
                    brokerInterest: [],
                    fxRates,
                    manualEntries: [],
                    foreignAccounts,
                    spb8PersonalData,
                },
                spb8PersonalData || {},
                reportType,
            );

            // Apply user-entered year-end prices
            for (const sec of assembled.securities) {
                if (yearEndPrices[sec.isin]) {
                    sec.priceEndOfYear = yearEndPrices[sec.isin];
                }
            }

            // Recompute BGN values with updated prices
            const toBase = (ccy: string) => fxToBaseCurrency(ccy, taxYear, fxRates);

            for (const sec of assembled.securities) {
                const price = sec.priceEndOfYear ?? holdings.find(h => h.isin === sec.isin)?.unitPrice ?? 0;

                sec.amountEndOfYearBgn = sec.quantityEndOfYear * price * toBase(sec.currency);
            }

            assembled.totalBgn = assembled.accounts.reduce((sum, a) => sum + (a.amountEndOfYearBgn ?? 0), 0)
                + assembled.securities.reduce((sum, s) => sum + (s.amountEndOfYearBgn ?? 0), 0);
            assembled.thresholdMet = assembled.totalBgn >= (taxYear >= 2026 ? 50_000 / 1.95583 : 50_000);

            return assembled;
        } catch (e) {
            console.error('Failed to assemble SPB-8:', e);

            return null;
        }
    }, [holdings, sales, fxRates, taxYear, foreignAccounts, spb8PersonalData, reportType, yearEndPrices]);

    const baseCcy = taxYear >= 2026 ? 'EUR' : 'BGN';

    const handleClearCachedData = useCallback(async () => {
        const { del } = await import('idb-keyval');

        await Promise.all([
            del('bg-tax-year-end-prices'),
            del('bg-tax-fx-rates'),
            del('bg-tax-country-cache'),
        ]);
        setYearEndPrices({});
        useAppStore.getState().setFxRates({});
    }, [setYearEndPrices]);

    const handleFetchPrices = useCallback(async () => {
        if (!spb8Data) {
            return;
        }
        const symbols = spb8Data.securities
            .filter(s => s.isin)
            .map(s => {
                // Collect all symbol aliases for this ISIN
                const allSymbols = [...new Set(holdings.filter(h => h.isin === s.isin).map(h => h.symbol))];

                return {
                    symbol: allSymbols[0] ?? s.isin,
                    alternativeSymbols: allSymbols.slice(1),
                    isin: s.isin,
                    currency: s.currency,
                };
            });

        if (symbols.length === 0) {
            return;
        }

        setPriceFetchProgress(`0/${symbols.length}`);
        setPriceFetchError(null);

        try {
            const prices = await fetchYearEndPrices(
                symbols,
                taxYear,
                getPriceFetch(),
                (done, total, sym) => setPriceFetchProgress(done < total ? `${done}/${total} (${sym})` : null),
                yearEndPrices, // skip already-fetched prices
            );

            const newPrices: Record<string, number> = { ...yearEndPrices };

            for (const p of prices) {
                newPrices[p.isin] = p.price;
            }

            setYearEndPrices(newPrices);

            const needed = symbols.filter(s => !yearEndPrices[s.isin]).length;
            const fetched = prices.length;

            if (needed > 0 && fetched < needed) {
                setPriceFetchError(`Получени ${fetched} от ${needed} цени. Stooq и Yahoo са достигнали лимита на заявките. Опитайте отново по-късно.`);
            }
        } catch (e) {
            console.error('Price fetch failed:', e);
            setPriceFetchError('Грешка при извличане на цени. Опитайте отново по-късно.');
            setPriceFetchProgress(null);
        }
    }, [spb8Data, holdings, taxYear, yearEndPrices, setYearEndPrices]);

    // Shared styles
    const thL: React.CSSProperties = { padding: '0.5rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 };
    const thR: React.CSSProperties = { padding: '0.5rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 };
    const tdL: React.CSSProperties = { padding: '0.5rem', color: 'var(--text)' };
    const tdM: React.CSSProperties = { padding: '0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' };
    const rowBorder: React.CSSProperties = { borderBottom: '1px solid var(--border)' };

    const handleExportExcel = async () => {
        if (!spb8Data) {
            setExportError('Failed to assemble SPB-8 data');

            return;
        }

        setExporting(true);
        setExportError(null);
        setExportSuccess(null);
        try {
            const buffer = await generateSpb8Excel(spb8Data);
            const blob = new Blob([buffer.buffer as ArrayBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const filename = `СПБ-8_${taxYear}.xlsx`;

            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setExportSuccess(filename);
            setTimeout(() => setExportSuccess(null), 5000);
        } catch (error) {
            console.error('Failed to export Excel:', error);
            setExportError(error instanceof Error ? error.message : String(error));
        } finally {
            setExporting(false);
        }
    };

    const renderSection = (key: string, title: string, subtitle: string, show: boolean, content: () => React.ReactNode) => {
        if (!show) {
            return null;
        }

        const isCollapsed = collapsed[key] ?? false;

        return (
            <div key={key} style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '1rem', overflow: 'hidden' }}>
                <div
                    onClick={() => toggleSection(key)}
                    style={{ padding: '1rem 1.5rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}
                >
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text)' }}>{title}</h2>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{subtitle}</p>
                    </div>
                    <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                        ▼
                    </span>
                </div>
                {!isCollapsed && <div style={{ padding: '0 1.5rem 1.5rem' }}>{content()}</div>}
            </div>
        );
    };

    const missingIsins = spb8Data?.securities.filter(s => !s.isin) ?? [];

    return (
        <div style={{ padding: '2rem' }}>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '2rem',
                }}
            >
                <h1>{t('spb8.title')}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {exportError && (
                        <span style={{ color: '#dc3545', fontSize: '0.9rem' }}>
                            {exportError}
                        </span>
                    )}
                    {exportSuccess && (
                        <span
                            style={{
                                color: '#28a745',
                                fontSize: '0.9rem',
                                padding: '0.3rem 0.75rem',
                                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                                borderRadius: '4px',
                            }}
                        >
                            ✓ Downloaded {exportSuccess}
                        </span>
                    )}
                    <button
                        onClick={handleExportExcel}
                        disabled={exporting || !spb8Data}
                        style={{
                            padding: '0.75rem 1.5rem',
                            backgroundColor: exporting || !spb8Data ? 'var(--text-secondary)' : 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: exporting || !spb8Data ? 'wait' : 'pointer',
                            fontSize: '1rem',
                            fontWeight: 500,
                            opacity: exporting || !spb8Data ? 0.7 : 1,
                        }}
                    >
                        {exporting ? 'Exporting...' : t('spb8.export')}
                    </button>
                </div>
            </div>

            {spb8Data && (
                <div
                    style={{
                        padding: '1rem',
                        marginBottom: '1.5rem',
                        backgroundColor: spb8Data.thresholdMet ? 'rgba(255, 193, 7, 0.12)' : 'rgba(40, 167, 69, 0.12)',
                        border: `1px solid ${spb8Data.thresholdMet ? 'rgba(255, 193, 7, 0.4)' : 'rgba(40, 167, 69, 0.4)'}`,
                        borderRadius: '4px',
                        color: 'var(--text)',
                        fontSize: '0.95rem',
                    }}
                >
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                        {spb8Data.thresholdMet
                            ? t('spb8.threshold.met').replace('{total}', spb8Data.totalBgn.toFixed(2)).replace('{ccy}', baseCcy)
                            : t('spb8.threshold.notMet').replace('{total}', spb8Data.totalBgn.toFixed(2)).replace('{ccy}', baseCcy)}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {spb8Data.thresholdMet ? t('spb8.threshold.info.taxYear') + ' ' + taxYear : t('spb8.threshold.info.informational')}
                    </div>
                </div>
            )}

            {missingIsins.length > 0 && (
                <div
                    style={{
                        padding: '0.75rem 1rem',
                        marginBottom: '1.5rem',
                        backgroundColor: 'rgba(255, 193, 7, 0.12)',
                        border: '1px solid rgba(255, 193, 7, 0.4)',
                        borderRadius: '4px',
                        color: 'var(--text)',
                        fontSize: '0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                    }}
                >
                    <span style={{ fontSize: '1.1rem' }}>⚠</span>
                    {missingIsins.length} {t('spb8.missingIsin')} — enter ISIN codes before export
                </div>
            )}

            {renderSection(
                'reportType',
                t('spb8.reportType'),
                'Initial (P) or Corrective (R)',
                true,
                () => (
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input
                                type='radio'
                                checked={reportType === 'P'}
                                onChange={() => setReportType('P')}
                                aria-label={t('spb8.reportType.initial')}
                            />
                            {t('spb8.reportType.initial')}
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input
                                type='radio'
                                checked={reportType === 'R'}
                                onChange={() => setReportType('R')}
                                aria-label={t('spb8.reportType.corrective')}
                            />
                            {t('spb8.reportType.corrective')}
                        </label>
                    </div>
                ),
            )}

            {renderSection(
                'personalData',
                t('spb8.personalData'),
                t('spb8.personalData.sectionHint'),
                true,
                () => (
                    <div style={{ width: '100%' }}>
                        {!editingPersonal
                            ? (
                                <div>
                                    <div
                                        style={{
                                            marginBottom: '1rem',
                                            fontSize: '0.9rem',
                                            color: 'var(--text-secondary)',
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))',
                                            gap: '0.5rem 1.5rem',
                                            alignItems: 'start',
                                        }}
                                    >
                                        {displayPersonal.name || displayPersonal.email
                                            ? (
                                                <>
                                                    {displayPersonal.name && <div>{displayPersonal.name}</div>}
                                                    {displayPersonal.email && <div>{displayPersonal.email}</div>}
                                                    {displayPersonal.phone && <div>{displayPersonal.phone}</div>}
                                                    {displayPersonal.address?.city && <div>{`${t('spb8.personalData.city')}: ${displayPersonal.address.city}`}</div>}
                                                    {displayPersonal.address?.postalCode && (
                                                        <div>{`${t('spb8.personalData.postalCode')}: ${displayPersonal.address.postalCode}`}</div>
                                                    )}
                                                    {displayPersonal.address?.district && <div>{`${t('spb8.personalData.district')}: ${displayPersonal.address.district}`}</div>}
                                                    {displayPersonal.address?.street && <div>{`${t('spb8.personalData.street')}: ${displayPersonal.address.street}`}</div>}
                                                    {displayPersonal.address?.number && <div>{`${t('spb8.personalData.number')}: ${displayPersonal.address.number}`}</div>}
                                                    {displayPersonal.address?.entrance && <div>{`${t('spb8.personalData.entrance')}: ${displayPersonal.address.entrance}`}</div>}
                                                </>
                                            )
                                            : <span>{t('spb8.personalData.noDataEntered')}</span>}
                                    </div>
                                    <div
                                        style={{
                                            marginBottom: '1rem',
                                            padding: '0.75rem',
                                            backgroundColor: 'rgba(108, 117, 125, 0.1)',
                                            borderRadius: '4px',
                                            fontSize: '0.85rem',
                                            color: 'var(--text-secondary)',
                                            lineHeight: '1.4',
                                        }}
                                    >
                                        {t('spb8.personalData.privacyNotice')}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            onClick={() => {
                                                setPersonalDataForm(spb8PersonalData || {});
                                                setEditingPersonal(true);
                                            }}
                                            style={{
                                                padding: '0.5rem 1rem',
                                                backgroundColor: 'var(--accent)',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                            }}
                                            aria-label={t('spb8.personalData.editButton')}
                                        >
                                            {t('spb8.personalData.editButton')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSpb8PersonalData({});
                                                setPersonalDataForm({});
                                            }}
                                            style={{
                                                padding: '0.5rem 1rem',
                                                backgroundColor: '#dc3545',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                            }}
                                            aria-label={t('spb8.personalData.clearButton')}
                                        >
                                            {t('spb8.personalData.clearButton')}
                                        </button>
                                    </div>
                                </div>
                            )
                            : (
                                <div>
                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))',
                                            gap: '1rem',
                                            marginBottom: '1rem',
                                        }}
                                    >
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.name')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.name || ''}
                                                onChange={e => setPersonalDataForm({ ...personalDataForm, name: e.target.value })}
                                                aria-label={t('spb8.personalData.name')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.egn')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.egn || ''}
                                                onChange={e => setPersonalDataForm({ ...personalDataForm, egn: e.target.value })}
                                                aria-label={t('spb8.personalData.egn')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.phone')}
                                            </label>
                                            <input
                                                type='tel'
                                                value={personalDataForm.phone || ''}
                                                onChange={e => setPersonalDataForm({ ...personalDataForm, phone: e.target.value })}
                                                aria-label={t('spb8.personalData.phone')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.email')}
                                            </label>
                                            <input
                                                type='email'
                                                value={personalDataForm.email || ''}
                                                onChange={e => setPersonalDataForm({ ...personalDataForm, email: e.target.value })}
                                                aria-label={t('spb8.personalData.email')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.city')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.address?.city || ''}
                                                onChange={e =>
                                                    setPersonalDataForm({
                                                        ...personalDataForm,
                                                        address: { ...personalDataForm.address, city: e.target.value },
                                                    })}
                                                aria-label={t('spb8.personalData.city')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.postalCode')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.address?.postalCode || ''}
                                                onChange={e =>
                                                    setPersonalDataForm({
                                                        ...personalDataForm,
                                                        address: { ...personalDataForm.address, postalCode: e.target.value },
                                                    })}
                                                aria-label={t('spb8.personalData.postalCode')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.district')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.address?.district || ''}
                                                onChange={e =>
                                                    setPersonalDataForm({
                                                        ...personalDataForm,
                                                        address: { ...personalDataForm.address, district: e.target.value },
                                                    })}
                                                aria-label={t('spb8.personalData.district')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.street')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.address?.street || ''}
                                                onChange={e =>
                                                    setPersonalDataForm({
                                                        ...personalDataForm,
                                                        address: { ...personalDataForm.address, street: e.target.value },
                                                    })}
                                                aria-label={t('spb8.personalData.street')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.number')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.address?.number || ''}
                                                onChange={e =>
                                                    setPersonalDataForm({
                                                        ...personalDataForm,
                                                        address: { ...personalDataForm.address, number: e.target.value },
                                                    })}
                                                aria-label={t('spb8.personalData.number')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {t('spb8.personalData.entrance')}
                                            </label>
                                            <input
                                                type='text'
                                                value={personalDataForm.address?.entrance || ''}
                                                onChange={e =>
                                                    setPersonalDataForm({
                                                        ...personalDataForm,
                                                        address: { ...personalDataForm.address, entrance: e.target.value },
                                                    })}
                                                aria-label={t('spb8.personalData.entrance')}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '4px',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            onClick={() => {
                                                setSpb8PersonalData(personalDataForm);
                                                setEditingPersonal(false);
                                            }}
                                            style={{
                                                padding: '0.5rem 1rem',
                                                backgroundColor: 'var(--accent)',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                            }}
                                            aria-label={t('button.save')}
                                        >
                                            {t('button.save')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setPersonalDataForm(spb8PersonalData || {});
                                                setEditingPersonal(false);
                                            }}
                                            style={{
                                                padding: '0.5rem 1rem',
                                                backgroundColor: 'var(--bg)',
                                                color: 'var(--text-secondary)',
                                                border: '1px solid var(--border)',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                            }}
                                            aria-label={t('button.cancel')}
                                        >
                                            {t('button.cancel')}
                                        </button>
                                    </div>
                                </div>
                            )}
                    </div>
                ),
            )}

            {renderSection(
                'accounts',
                t('spb8.accounts'),
                `${foreignAccounts?.length || 0} account(s)`,
                true,
                () => (
                    <>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: '1rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                                    <th style={thL}>{t('spb8.accounts.broker')}</th>
                                    <th style={thL}>{t('spb8.accounts.type')}</th>
                                    <th style={thL}>{t('spb8.accounts.maturity')}</th>
                                    <th style={thL}>{t('spb8.accounts.country')}</th>
                                    <th style={thL}>{t('spb8.accounts.currency')}</th>
                                    <th style={thR}>{t('spb8.accounts.startAmount')}</th>
                                    <th style={thR}>{t('spb8.accounts.endAmount')}</th>
                                    <th style={{ ...thR, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('spb8.accounts.tableHeader.startThousands')}</th>
                                    <th style={{ ...thR, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('spb8.accounts.tableHeader.endThousands')}</th>
                                    <th style={thR}>{`Край ${baseCcy}`}</th>
                                    <th style={{ padding: '0.5rem', width: '60px' }}>{t('spb8.accounts.tableHeader.action')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(foreignAccounts || []).map((account, idx) => (
                                    <tr key={idx} style={rowBorder}>
                                        <td style={tdL}>{account.broker}</td>
                                        <td style={tdL}>{account.type}</td>
                                        <td style={tdL}>{account.maturity}</td>
                                        <td style={tdL}>{account.country}</td>
                                        <td style={tdL}>{account.currency}</td>
                                        <td style={tdM}>{account.amountStartOfYear.toFixed(2)}</td>
                                        <td style={tdM}>{account.amountEndOfYear.toFixed(2)}</td>
                                        <td style={{ ...tdM, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{Math.round(account.amountStartOfYear / 1000)}</td>
                                        <td style={{ ...tdM, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{Math.round(account.amountEndOfYear / 1000)}</td>
                                        <td style={{ ...tdM, color: 'var(--text-secondary)' }}>
                                            {(spb8Data?.accounts.find(a => a.currency === account.currency && a.country === account.country)?.amountEndOfYearBgn ?? 0).toFixed(2)}
                                        </td>
                                        <td style={{ padding: '0.5rem', display: 'flex', gap: '0.25rem' }}>
                                            <button
                                                onClick={() => setEditingAccount(idx)}
                                                style={{
                                                    padding: '0.25rem 0.5rem',
                                                    backgroundColor: 'var(--bg)',
                                                    color: 'var(--text)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.75rem',
                                                }}
                                                aria-label={t('button.edit')}
                                            >
                                                {t('button.edit')}
                                            </button>
                                            <button
                                                onClick={() => deleteForeignAccount(idx)}
                                                style={{
                                                    padding: '0.25rem 0.5rem',
                                                    backgroundColor: '#dc3545',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.75rem',
                                                }}
                                            >
                                                Del
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 600 }}>
                                    <td style={tdL} colSpan={9}>{t('spb8.accounts.totalRow')}</td>
                                    <td style={tdM}>
                                        {(spb8Data?.accounts.reduce((sum, a) => sum + (a.amountEndOfYearBgn ?? 0), 0) ?? 0).toFixed(2)} {baseCcy}
                                    </td>
                                    <td />
                                </tr>
                            </tbody>
                        </table>
                        {editingAccount !== null && (
                            <div style={{ backgroundColor: 'var(--bg)', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
                                <h4 style={{ margin: '0 0 1rem 0' }}>{t('spb8.editAccount.title')}</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>{t('spb8.accounts.broker')}</label>
                                        <input
                                            type='text'
                                            value={foreignAccounts![editingAccount].broker}
                                            onChange={e => updateForeignAccount(editingAccount, { ...foreignAccounts![editingAccount], broker: e.target.value })}
                                            aria-label={t('spb8.accounts.broker')}
                                            style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: 'inherit' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>{t('spb8.accounts.currency')}</label>
                                        <input
                                            type='text'
                                            value={foreignAccounts![editingAccount].currency}
                                            onChange={e => updateForeignAccount(editingAccount, { ...foreignAccounts![editingAccount], currency: e.target.value })}
                                            aria-label={t('spb8.accounts.currency')}
                                            style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: 'inherit' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>{t('spb8.accounts.startAmount')}</label>
                                        <input
                                            type='number'
                                            value={foreignAccounts![editingAccount].amountStartOfYear}
                                            onChange={e =>
                                                updateForeignAccount(editingAccount, { ...foreignAccounts![editingAccount], amountStartOfYear: parseFloat(e.target.value) })}
                                            aria-label={t('spb8.accounts.startAmount')}
                                            style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: 'inherit' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>{t('spb8.accounts.endAmount')}</label>
                                        <input
                                            type='number'
                                            value={foreignAccounts![editingAccount].amountEndOfYear}
                                            onChange={e =>
                                                updateForeignAccount(editingAccount, { ...foreignAccounts![editingAccount], amountEndOfYear: parseFloat(e.target.value) })}
                                            aria-label={t('spb8.accounts.endAmount')}
                                            style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: 'inherit' }}
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={() => setEditingAccount(null)}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        backgroundColor: 'var(--accent)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                    }}
                                    aria-label={t('button.done')}
                                >
                                    {t('button.done')}
                                </button>
                            </div>
                        )}
                        <div>
                            <button
                                onClick={() =>
                                    addForeignAccount({
                                        broker: 'Manual',
                                        type: '03',
                                        maturity: 'S',
                                        country: 'BG',
                                        currency: 'BGN',
                                        amountStartOfYear: 0,
                                        amountEndOfYear: 0,
                                    })}
                                style={{
                                    padding: '0.5rem 1rem',
                                    backgroundColor: 'var(--bg)',
                                    color: 'var(--text)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                }}
                            >
                                {t('spb8.accounts.addRow')}
                            </button>
                        </div>
                    </>
                ),
            )}

            {spb8Data && renderSection(
                'securities',
                t('spb8.securities'),
                `${spb8Data.securities.length} security(ies)`,
                true,
                () => (
                    <>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <button
                                onClick={handleFetchPrices}
                                disabled={!!priceFetchProgress}
                                style={{
                                    padding: '0.4rem 1rem',
                                    backgroundColor: '#0d6efd',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: priceFetchProgress ? 'wait' : 'pointer',
                                    fontSize: '0.85rem',
                                    opacity: priceFetchProgress ? 0.7 : 1,
                                }}
                            >
                                {priceFetchProgress ? `${t('spb8.fetchingPrices')} ${priceFetchProgress}...` : t('spb8.fetchPrices').replace('{date}', `31.12.${taxYear}`)}
                            </button>
                            {Object.keys(yearEndPrices).length > 0 && (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {Object.keys(yearEndPrices).length} prices loaded
                                </span>
                            )}
                            {priceFetchError && (
                                <span style={{ fontSize: '0.8rem', color: '#dc3545' }}>
                                    {priceFetchError}
                                </span>
                            )}
                            <button
                                onClick={handleClearCachedData}
                                style={{
                                    padding: '0.4rem 0.8rem',
                                    backgroundColor: 'transparent',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                }}
                            >
                                {t('spb8.clearCachedData')}
                            </button>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                                    <th style={thL}>{t('spb8.securities.isin')}</th>
                                    <th style={thL}>{t('spb8.securities.tableHeader.symbol')}</th>
                                    <th style={thL}>{t('spb8.securities.currency')}</th>
                                    <th style={thR}>{t('spb8.securities.startQty')}</th>
                                    <th style={thR}>{t('spb8.securities.endQty')}</th>
                                    <th style={thR}>{t('spb8.securities.tableHeader.yearEndPrice')}</th>
                                    <th style={thR}>{`Край ${baseCcy}`}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {spb8Data.securities.map((sec, idx) => (
                                    <tr key={idx} style={rowBorder}>
                                        <td style={tdL}>
                                            {sec.isin ? sec.isin : <span style={{ color: 'red' }}>MISSING</span>}
                                        </td>
                                        <td style={tdL}>{holdings.find(h => h.isin === sec.isin)?.symbol ?? ''}</td>
                                        <td style={tdL}>{sec.currency}</td>
                                        <td style={tdM}>{sec.quantityStartOfYear.toFixed(4)}</td>
                                        <td style={tdM}>{sec.quantityEndOfYear.toFixed(4)}</td>
                                        <td style={tdM}>
                                            <input
                                                type='number'
                                                step='0.01'
                                                value={yearEndPrices[sec.isin] ?? sec.priceEndOfYear ?? ''}
                                                placeholder={String(holdings.find(h => h.isin === sec.isin)?.unitPrice ?? '—')}
                                                onChange={e => setYearEndPrices({ ...yearEndPrices, [sec.isin]: parseFloat(e.target.value) || 0 })}
                                                aria-label={`${t('spb8.securities.tableHeader.yearEndPrice')} (${sec.isin})`}
                                                style={{
                                                    width: '80px',
                                                    padding: '0.2rem 0.4rem',
                                                    textAlign: 'right',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.85rem',
                                                    backgroundColor: 'var(--bg)',
                                                    color: 'var(--text)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '3px',
                                                }}
                                            />
                                        </td>
                                        <td style={{ ...tdM, color: 'var(--text-secondary)' }}>{(sec.amountEndOfYearBgn ?? 0).toFixed(2)}</td>
                                    </tr>
                                ))}
                                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 600 }}>
                                    <td style={tdL} colSpan={3}>{t('spb8.securities.totalRow')}</td>
                                    <td style={tdM}>{spb8Data.securities.reduce((sum, s) => sum + s.quantityStartOfYear, 0).toFixed(4)}</td>
                                    <td style={tdM}>{spb8Data.securities.reduce((sum, s) => sum + s.quantityEndOfYear, 0).toFixed(4)}</td>
                                    <td />
                                    <td style={tdM}>{spb8Data.securities.reduce((sum, s) => sum + (s.amountEndOfYearBgn ?? 0), 0).toFixed(2)} {baseCcy}</td>
                                </tr>
                            </tbody>
                        </table>
                    </>
                ),
            )}
        </div>
    );
}
