import {
    calcDividendRowTax,
    generateExcel,
    generateNraAppendix8,
    t,
    TaxCalculator,
    toBaseCurrency,
} from '@bg-tax/core';
import {
    useMemo,
    useState,
} from 'react';

import { useNraFiller } from '../hooks/useNraFiller.js';
import {
    applySorting,
    useAppStore,
} from '../store/app-state';

export function Declaration() {
    const {
        holdings: unsortedHoldings,
        sales: unsortedSales,
        dividends: unsortedDividends,
        stockYield,
        brokerInterest,
        fxRates,
        baseCurrency,
        taxYear,
        foreignAccounts,
        savingsSecurities,
        spb8PersonalData,
        yearEndPrices,
        tableSorting,
    } = useAppStore();

    const nraFiller = useNraFiller(unsortedDividends, fxRates, baseCurrency);

    const holdings = useMemo(
        () => applySorting(unsortedHoldings, tableSorting.holdings ?? []),
        [unsortedHoldings, tableSorting.holdings],
    );
    const sales = useMemo(
        () => applySorting(unsortedSales, tableSorting.sales ?? []),
        [unsortedSales, tableSorting.sales],
    );
    const dividends = useMemo(
        () => applySorting(unsortedDividends, tableSorting.dividends ?? []),
        [unsortedDividends, tableSorting.dividends],
    );

    // Calculate tax results
    const calculator = new TaxCalculator(baseCurrency);

    const capitalGainsResult = calculator.calcCapitalGains(sales);
    const dividendsTaxResult = calculator.calcDividendsTax(dividends, fxRates);

    // Calculate broker interest tax (all brokers — includes IB Stock Yield/SYEP entries)
    let brokerInterestTotalGross = 0;
    let brokerInterestTotalTax = 0;

    for (const bi of brokerInterest) {
        if (bi.entries.length > 0) {
            const entrySum = bi.entries.reduce((sum, e) => sum + e.amount, 0);
            const entryBase = toBaseCurrency(entrySum, bi.currency, `${taxYear}-06-30`, 'BGN', fxRates);

            if (!isNaN(entryBase)) {
                brokerInterestTotalGross += entryBase;
                brokerInterestTotalTax += entryBase * 0.1;
            }
        }
    }

    // Stock yield (SYEP) entries are already included in brokerInterest (IB EUR/USD tabs),
    // so don't add stockYieldResult to avoid double-counting
    const totalInterestGross = brokerInterestTotalGross;
    const totalInterestTax = brokerInterestTotalTax;

    // Build dynamic broker list for interest label
    const interestBrokers = new Set<string>();

    if (stockYield.length > 0) interestBrokers.add('IB');

    for (const bi of brokerInterest) {
        if (bi.entries.length > 0) interestBrokers.add(bi.broker);
    }

    const interestBrokersLabel = interestBrokers.size > 0 ? ` — ${[...interestBrokers].join(' + ')}` : '';

    // Calculate total tax due
    const totalTaxDue = capitalGainsResult.taxDue
        + dividendsTaxResult.totalBgTax
        + totalInterestTax;

    // Приложение 5, Част I — Holdings as of Dec 31
    const holdingsForDeclaration = useMemo(() => {
        return holdings
            .filter(h => h.symbol && h.quantity > 0 && h.country !== 'България')
            .map(h => {
                const totalCcy = h.quantity * h.unitPrice;
                const totalBgn = toBaseCurrency(totalCcy, h.currency, h.dateAcquired, 'BGN', fxRates);

                return {
                    symbol: h.symbol,
                    country: h.country,
                    quantity: h.quantity,
                    dateAcquired: h.dateAcquired,
                    currency: h.currency,
                    totalCcy,
                    totalBgn: isNaN(totalBgn) ? totalCcy : totalBgn,
                };
            });
    }, [holdings, fxRates]);

    const formatDate = (iso: string): string => {
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);

        return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
    };

    // Приложение 5, Таблица 2 — Sales summary (code 508)
    const salesTable2 = useMemo(() => {
        const toBgn = (amount: number, ccy: string, date: string) => {
            const v = toBaseCurrency(amount, ccy, date, 'BGN', fxRates);

            return isNaN(v) ? amount : v;
        };

        let totalProceeds = 0;
        let totalCost = 0;
        let totalGains = 0;
        let totalLosses = 0;

        for (const s of sales) {
            if (!s.symbol || s.quantity === 0) {
                continue;
            }
            const proceeds = toBgn(s.quantity * s.sellPrice, s.currency, s.dateSold);
            const cost = toBgn(s.quantity * s.buyPrice, s.currency, s.dateAcquired);

            totalProceeds += proceeds;
            totalCost += cost;
            const pl = proceeds - cost;

            if (pl > 0) {
                totalGains += pl;
            } else {
                totalLosses += Math.abs(pl);
            }
        }

        const row5 = Math.max(0, totalGains - totalLosses); // difference (0 if negative)
        const row6 = row5 * 0.10; // 10% expense deduction
        const row7 = row5 - row6; // taxable income

        return { totalProceeds, totalCost, totalGains, totalLosses, row5, row6, row7 };
    }, [sales, fxRates]);

    // Приложение 8, Част III — Dividends per-row detail (code 8141)
    const dividendsForDeclaration = useMemo(() => {
        return dividends
            .filter(d => d.symbol && d.grossAmount > 0)
            .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date))
            .map(d => {
                const { grossBase, whtBase, tax5pct, bgTaxDue } = calcDividendRowTax(
                    d.grossAmount,
                    d.withholdingTax,
                    d.currency,
                    d.date,
                    'BGN',
                    fxRates,
                );

                return {
                    symbol: d.symbol,
                    country: d.country,
                    grossBgn: grossBase,
                    whtBgn: whtBase,
                    allowedCredit: tax5pct,
                    recognizedCredit: Math.min(whtBase, tax5pct),
                    taxDue: bgTaxDue,
                };
            });
    }, [dividends, fxRates]);

    // Приложение 6, Част I — Interest income (code 603)
    // totalInterestGross is already computed above in BGN (from stockYield + revolut)
    const interestBgn = totalInterestGross;

    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const toggleSection = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

    // Shared styles for declaration tables
    const thL: React.CSSProperties = { padding: '0.5rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 };
    const thR: React.CSSProperties = { padding: '0.5rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 };
    const thNum: React.CSSProperties = { padding: '0.25rem 0.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.8rem' };
    const tdL: React.CSSProperties = { padding: '0.5rem', color: 'var(--text)' };
    const tdM: React.CSSProperties = { padding: '0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' };
    const rowBorder: React.CSSProperties = { borderBottom: '1px solid var(--border)' };

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

    const summaryRow = (label: string, value: number, bold = false) => (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '3fr 1fr',
                padding: '0.5rem',
                borderBottom: bold ? 'none' : '1px solid var(--border)',
                backgroundColor: bold ? 'var(--bg)' : 'transparent',
                borderRadius: bold ? '4px' : '0',
            }}
        >
            <span style={{ color: 'var(--text)', fontWeight: bold ? 700 : 400 }}>{label}</span>
            <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: bold ? 700 : 600, fontSize: bold ? '1.05rem' : 'inherit', color: 'var(--accent)' }}>
                {value.toFixed(2)}
            </span>
        </div>
    );

    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportSuccess, setExportSuccess] = useState<string | null>(null);

    const handleExportExcel = async () => {
        setExporting(true);
        setExportError(null);
        setExportSuccess(null);
        try {
            const stateAsAppState = {
                taxYear,
                baseCurrency,
                language: 'en' as const,
                holdings,
                sales,
                dividends,
                stockYield,
                brokerInterest,
                fxRates,
                manualEntries: [],
                foreignAccounts,
                savingsSecurities,
                spb8PersonalData,
                yearEndPrices,
            };

            const buffer = await generateExcel(stateAsAppState);
            const blob = new Blob([buffer.buffer as ArrayBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const filename = `Данъчна_${taxYear}.xlsx`;

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

    const [nraExporting, setNraExporting] = useState(false);
    const [nraSuccess, setNraSuccess] = useState<string | null>(null);
    const [nraError, setNraError] = useState<string | null>(null);

    const handleExportNraAppendix8 = async () => {
        setNraExporting(true);
        setNraSuccess(null);
        setNraError(null);
        try {
            const foreignHoldings = holdings.filter(h => h.country !== 'България');
            const buffer = await generateNraAppendix8(foreignHoldings, fxRates);
            const blob = new Blob([buffer.buffer as ArrayBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const filename = `Приложение_8_Част_I_${taxYear}.xlsx`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');

            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setNraSuccess(filename);
            setTimeout(() => setNraSuccess(null), 5000);
        } catch (error) {
            console.error('Failed to export NRA Appendix 8:', error);
            setNraError(error instanceof Error ? error.message : String(error));
        } finally {
            setNraExporting(false);
        }
    };

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
                <h1>{t('page.declaration')}</h1>
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
                        disabled={exporting}
                        style={{
                            padding: '0.75rem 1.5rem',
                            backgroundColor: exporting ? 'var(--text-secondary)' : 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: exporting ? 'wait' : 'pointer',
                            fontSize: '1rem',
                            fontWeight: 500,
                            opacity: exporting ? 0.7 : 1,
                        }}
                    >
                        {exporting ? 'Exporting...' : t('button.export')}
                    </button>
                </div>
            </div>

            {(holdings.length > 0 || (foreignAccounts && foreignAccounts.length > 0)) && (
                <div
                    style={{
                        padding: '0.75rem 1rem',
                        marginBottom: '1rem',
                        backgroundColor: 'rgba(255, 193, 7, 0.12)',
                        border: '1px solid rgba(255, 193, 7, 0.4)',
                        borderRadius: '6px',
                        fontSize: '0.9rem',
                        color: 'var(--text)',
                    }}
                >
                    ⚠ Не забравяйте да подадете и{' '}
                    <a href='#/spb8' style={{ color: '#ffc107', fontWeight: 600 }}>
                        форма СПБ-8 към БНБ
                    </a>{' '}
                    — годишен отчет за притежаваните финансови активи в чужбина (срок: 31 март).
                </div>
            )}

            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Данъчна година {taxYear} • Базова валута {baseCurrency}
            </p>

            {holdings.filter(h => h.consumedByFifo).length > 0 && (
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
                    {t('warning.consumedHoldings').replace('{count}', String(holdings.filter(h => h.consumedByFifo).length))}
                </div>
            )}

            {renderSection('p5t2', 'Приложение 5, Таблица 2', 'Доходи от продажба или замяна на финансови активи (код 508)', sales.length > 0, () => (
                <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border)' }}>
                                <th style={thL}>№</th>
                                <th style={thL}>Код</th>
                                <th style={thR}>Общ размер на продажната цена</th>
                                <th style={thR}>Обща цена на придобиване</th>
                                <th style={thR}>Реализирани печалби</th>
                                <th style={thR}>Реализирани загуби</th>
                            </tr>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['1', '2', '3', '4', '5', '6'].map(n => <th key={n} style={thNum}>{n}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={rowBorder}>
                                <td style={tdL}>1.1</td>
                                <td style={tdL}>508</td>
                                <td style={tdM}>{salesTable2.totalProceeds.toFixed(2)}</td>
                                <td style={tdM}>{salesTable2.totalCost.toFixed(2)}</td>
                                <td style={tdM}>{salesTable2.totalGains.toFixed(2)}</td>
                                <td style={tdM}>{salesTable2.totalLosses.toFixed(2)}</td>
                            </tr>
                            <tr style={{ ...rowBorder, backgroundColor: 'var(--bg)' }}>
                                <td colSpan={4} style={{ ...tdL, fontWeight: 600 }}>4. Обща сума за годината</td>
                                <td style={{ ...tdM, fontWeight: 600 }}>{salesTable2.totalGains.toFixed(2)}</td>
                                <td style={{ ...tdM, fontWeight: 600 }}>{salesTable2.totalLosses.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
                        {summaryRow('5. Разлика (ред 4, кол. 5 минус кол. 6; ако е отрицателна — нула)', salesTable2.row5)}
                        {summaryRow('6. Разходи за дейността (10 на сто от ред 5)', salesTable2.row6)}
                        {summaryRow('7. Облагаем доход по Таблица 2 (ред 5 – ред 6)', salesTable2.row7, true)}
                    </div>
                </>
            ))}

            {renderSection(
                'p6c1',
                'Приложение 6, Част I',
                'Доходи от други източници по чл. 35 от ЗДДФЛ — Лихви (код 603)',
                interestBgn > 0,
                () => (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border)' }}>
                                <th style={thL}>№</th>
                                <th style={thL}>Описание</th>
                                <th style={{ ...thR, textAlign: 'center' }}>Код</th>
                                <th style={thR}>Размер на дохода</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={rowBorder}>
                                <td style={{ ...tdL, color: 'var(--text-secondary)' }}>2</td>
                                <td style={tdL}>Обща сума на доходите с код 601</td>
                                <td style={{ ...tdM, textAlign: 'center' }}>601</td>
                                <td style={{ ...tdM, color: 'var(--text-secondary)' }}>0.00</td>
                            </tr>
                            <tr style={{ ...rowBorder, backgroundColor: 'var(--bg)' }}>
                                <td style={tdL}>3</td>
                                <td style={{ ...tdL, fontWeight: 500 }}>Обща сума на доходите с код 603 (Лихви){interestBrokersLabel}</td>
                                <td style={{ ...tdM, textAlign: 'center', fontWeight: 600 }}>603</td>
                                <td style={{ ...tdM, fontWeight: 700, color: 'var(--accent)' }}>{interestBgn.toFixed(2)}</td>
                            </tr>
                            {['604', '605', '606'].map((code, i) => (
                                <tr key={code} style={rowBorder}>
                                    <td style={{ ...tdL, color: 'var(--text-secondary)' }}>{i + 4}</td>
                                    <td style={tdL}>Обща сума на доходите с код {code}</td>
                                    <td style={{ ...tdM, textAlign: 'center' }}>{code}</td>
                                    <td style={{ ...tdM, color: 'var(--text-secondary)' }}>0.00</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ),
            )}

            {renderSection(
                'p8c1',
                'Приложение 8, Част I',
                `Притежавани към 31.12.${taxYear} акции и дялови участия в дружества в чужбина`,
                holdingsForDeclaration.length > 0,
                () => (
                    <>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                                    <th style={thL}>Вид</th>
                                    <th style={thL}>Символ</th>
                                    <th style={thL}>Държава</th>
                                    <th style={thR}>Брой</th>
                                    <th style={thL}>Дата на придобиване</th>
                                    <th style={thR}>Обща цена (валута)</th>
                                    <th style={thR}>В лева</th>
                                </tr>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {['1', '', '2', '3', '4', '5', '6'].map((n, i) => <th key={i} style={thNum}>{n}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {holdingsForDeclaration.map((h, idx) => (
                                    <tr key={idx} style={rowBorder}>
                                        <td style={tdL}>Акции</td>
                                        <td style={tdL}>{h.symbol}</td>
                                        <td style={tdL}>{h.country}</td>
                                        <td style={tdM}>{h.quantity}</td>
                                        <td style={tdL}>{formatDate(h.dateAcquired)}</td>
                                        <td style={tdM}>{h.totalCcy.toFixed(2)} {h.currency}</td>
                                        <td style={{ ...tdM, fontWeight: 600, color: 'var(--accent)' }}>{h.totalBgn.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--border)' }}>
                                    <td colSpan={6} style={{ ...tdL, fontWeight: 700 }}>Общо</td>
                                    <td style={{ ...tdM, fontWeight: 700, color: 'var(--accent)' }}>{holdingsForDeclaration.reduce((s, h) => s + h.totalBgn, 0).toFixed(2)}</td>
                                </tr>
                            </tfoot>
                        </table>
                        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button
                                onClick={handleExportNraAppendix8}
                                disabled={nraExporting}
                                style={{
                                    padding: '0.5rem 1rem',
                                    backgroundColor: nraExporting ? 'var(--text-secondary)' : 'var(--accent)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: nraExporting ? 'wait' : 'pointer',
                                    fontSize: '0.9rem',
                                    opacity: nraExporting ? 0.7 : 1,
                                }}
                            >
                                {nraExporting ? 'Генериране...' : 'Изтегли за НАП (Excel)'}
                            </button>
                            {nraSuccess && (
                                <span style={{ color: '#28a745', fontSize: '0.85rem', padding: '0.2rem 0.5rem', backgroundColor: 'rgba(40, 167, 69, 0.1)', borderRadius: '4px' }}>
                                    ✓ {nraSuccess}
                                </span>
                            )}
                            {nraError && <span style={{ color: '#dc3545', fontSize: '0.85rem' }}>{nraError}</span>}
                            {!nraSuccess && !nraError && !nraExporting && (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    Прикачете файла в портала на НАП
                                </span>
                            )}
                        </div>
                    </>
                ),
            )}

            {renderSection(
                'p8c3',
                'Приложение 8, Част III',
                'Дължим окончателен данък — Дивиденти (код 8141)',
                dividendsForDeclaration.length > 0,
                () => (
                    <>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '900px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                                        {[
                                            '№',
                                            'Наименование',
                                            'Държава',
                                            'Код',
                                            'Метод',
                                            'Брутен размер',
                                            'Цена придоб.',
                                            'Разлика',
                                            'Данък в чужбина',
                                            'Допустим кредит',
                                            'Признат кредит',
                                            'Дължим данък',
                                        ].map((h, i) => (
                                            <th
                                                key={i}
                                                style={i >= 5
                                                    ? { padding: '0.4rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 }
                                                    : { padding: '0.4rem', textAlign: i >= 3 ? 'center' : 'left', color: 'var(--text-secondary)', fontWeight: 600 }}
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                        {Array.from({ length: 12 }, (_, i) => <th key={i} style={thNum}>{i + 1}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {dividendsForDeclaration.map((d, idx) => (
                                        <tr key={idx} style={rowBorder}>
                                            <td style={tdL}>{idx + 1}.1</td>
                                            <td style={{ ...tdL, fontWeight: 500 }}>{d.symbol}</td>
                                            <td style={tdL}>{d.country}</td>
                                            <td style={{ ...tdM, textAlign: 'center' }}>8141</td>
                                            <td style={{ ...tdM, textAlign: 'center' }}>1</td>
                                            <td style={tdM}>{d.grossBgn.toFixed(2)}</td>
                                            <td style={{ ...tdM, color: 'var(--text-secondary)' }}>0.00</td>
                                            <td style={{ ...tdM, color: 'var(--text-secondary)' }}>0.00</td>
                                            <td style={tdM}>{d.whtBgn.toFixed(2)}</td>
                                            <td style={tdM}>{d.allowedCredit.toFixed(2)}</td>
                                            <td style={tdM}>{d.recognizedCredit.toFixed(2)}</td>
                                            <td style={{ ...tdM, fontWeight: 600, color: 'var(--accent)' }}>{d.taxDue.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                                        <td colSpan={5} style={{ ...tdL, fontWeight: 700 }}>Общо</td>
                                        <td style={{ ...tdM, fontWeight: 700 }}>{dividendsForDeclaration.reduce((s, d) => s + d.grossBgn, 0).toFixed(2)}</td>
                                        <td style={{ ...tdM, color: 'var(--text-secondary)' }}>0.00</td>
                                        <td style={{ ...tdM, color: 'var(--text-secondary)' }}>0.00</td>
                                        <td style={{ ...tdM, fontWeight: 700 }}>{dividendsForDeclaration.reduce((s, d) => s + d.whtBgn, 0).toFixed(2)}</td>
                                        <td style={{ ...tdM, fontWeight: 700 }}>{dividendsForDeclaration.reduce((s, d) => s + d.allowedCredit, 0).toFixed(2)}</td>
                                        <td style={{ ...tdM, fontWeight: 700 }}>{dividendsForDeclaration.reduce((s, d) => s + d.recognizedCredit, 0).toFixed(2)}</td>
                                        <td style={{ ...tdM, fontWeight: 700, color: 'var(--accent)' }}>{dividendsForDeclaration.reduce((s, d) => s + d.taxDue, 0).toFixed(2)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                <button
                                    onClick={() => nraFiller.startFilling()}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        backgroundColor: nraFiller.status === 'copied' ? '#28a745' : 'var(--accent)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: 500,
                                    }}
                                >
                                    {nraFiller.status === 'copied'
                                        ? `Скрипт (${nraFiller.rowCount} реда)`
                                        : 'Генерирай скрипт'}
                                </button>
                                {nraFiller.canUseBrowser && (
                                    <button
                                        onClick={() => nraFiller.startBrowser()}
                                        disabled={nraFiller.status === 'browser'}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            backgroundColor: nraFiller.status === 'browser' ? '#6c757d' : 'var(--accent)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: nraFiller.status === 'browser' ? 'wait' : 'pointer',
                                            fontSize: '0.9rem',
                                            fontWeight: 500,
                                            opacity: nraFiller.status === 'browser' ? 0.7 : 1,
                                        }}
                                    >
                                        {nraFiller.status === 'browser'
                                            ? `Браузър (${nraFiller.rowCount} реда)...`
                                            : 'Отвори браузър'}
                                    </button>
                                )}
                            </div>
                            {nraFiller.status === 'error' && (
                                <div style={{ color: '#dc3545', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                    {nraFiller.error}
                                </div>
                            )}
                            {nraFiller.status === 'copied' && (
                                <div style={{ marginTop: '0.75rem' }}>
                                    <div
                                        style={{
                                            fontSize: '0.85rem',
                                            color: 'var(--text-secondary)',
                                            marginBottom: '0.75rem',
                                            padding: '0.75rem',
                                            backgroundColor: 'var(--bg-secondary, #f0f7ff)',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border)',
                                            lineHeight: 1.6,
                                        }}
                                    >
                                        <strong>Вместо ръчно въвеждане на {nraFiller.rowCount} реда дивиденти</strong>, можете да изпълните скрипта по-долу в конзолата на браузъра,
                                        който ще попълни формата автоматично.
                                        <ol style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
                                            <li>
                                                Отворете портала на НАП и навигирайте до <strong>Приложение 8, Част III</strong>
                                            </li>
                                            <li>
                                                Отворете конзолата на браузъра (<strong>Cmd+Option+J</strong> на Mac / <strong>F12</strong> на Windows → таб Console)
                                            </li>
                                            <li>
                                                Ако конзолата покаже съобщение за paste, напишете{' '}
                                                <code style={{ backgroundColor: 'var(--bg-tertiary, #e8e8e8)', padding: '1px 4px', borderRadius: '3px' }}>allow pasting</code>{' '}
                                                и натиснете Enter
                                            </li>
                                            <li>Копирайте скрипта с бутона по-долу и го поставете в конзолата → Enter</li>
                                            <li>Изчакайте попълването — ще видите синя лента с прогреса в горния десен ъгъл</li>
                                        </ol>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <button
                                            onClick={(e) => {
                                                if (!nraFiller.script) {
                                                    return;
                                                }
                                                // Try multiple copy methods
                                                const textarea = document.querySelector('#nra-script-textarea') as HTMLTextAreaElement | null;

                                                if (textarea) {
                                                    textarea.select();
                                                    document.execCommand('copy');
                                                }
                                                try {
                                                    void navigator.clipboard.writeText(nraFiller.script);
                                                } catch { /* clipboard may be unavailable */ }
                                                // Show feedback
                                                const btn = e.currentTarget;

                                                btn.textContent = '\u2713 Копирано!';
                                                btn.style.backgroundColor = '#28a745';
                                                setTimeout(() => {
                                                    btn.textContent = 'Копирай в клипборда';
                                                    btn.style.backgroundColor = '';
                                                }, 2000);
                                            }}
                                            style={{
                                                padding: '0.5rem 1rem',
                                                backgroundColor: 'var(--accent)',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                            }}
                                        >
                                            Копирай в клипборда
                                        </button>
                                    </div>
                                    <textarea
                                        id='nra-script-textarea'
                                        readOnly
                                        value={nraFiller.script || ''}
                                        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                                        style={{
                                            width: '100%',
                                            height: '80px',
                                            fontFamily: 'monospace',
                                            fontSize: '0.75rem',
                                            padding: '0.5rem',
                                            border: '1px solid var(--border)',
                                            borderRadius: '4px',
                                            backgroundColor: 'var(--bg-secondary, #f5f5f5)',
                                            resize: 'vertical',
                                        }}
                                    />
                                </div>
                            )}
                            {nraFiller.status === 'browser' && (
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                                    Влезте в портала на НАП и отидете до Приложение 8, Част III. Скриптът ще открие формата автоматично.
                                </div>
                            )}
                        </div>
                    </>
                ),
            )}

            {/* Част IV — Total tax due */}
            <div
                style={{
                    backgroundColor: 'var(--accent)',
                    color: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '2rem',
                    textAlign: 'center',
                    marginTop: '1rem',
                }}
            >
                <h2 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Част IV — Дължим данък</h2>
                <p style={{ marginTop: 0, marginBottom: '1rem', opacity: 0.9 }}>{t('label.totalTax')}</p>
                <div style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{totalTaxDue.toFixed(2)} {baseCurrency}</div>
            </div>
        </div>
    );
}
