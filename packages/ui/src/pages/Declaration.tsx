import {
    generateExcel,
    mapToDeclaration,
    t,
    TaxCalculator,
} from '@bg-tax/core';
import { useAppStore } from '../store/app-state';
import formConfig2025 from '@bg-tax/core/src/declaration/form-config/2025.json';
import formConfig2026 from '@bg-tax/core/src/declaration/form-config/2026.json';
import type { TaxResults } from '@bg-tax/core';

export function Declaration() {
    const {
        holdings,
        sales,
        dividends,
        stockYield,
        ibInterest,
        revolutInterest,
        fxRates,
        baseCurrency,
        taxYear,
    } = useAppStore();

    // Calculate tax results
    const calculator = new TaxCalculator(baseCurrency);

    const capitalGainsResult = calculator.calcCapitalGains(sales);
    const dividendsTaxResult = calculator.calcDividendsTax(dividends, fxRates);

    // Combine interest from stock yield and Revolut

    // Calculate stock yield tax
    const stockYieldResult = calculator.calcStockYieldTax(stockYield, fxRates);

    // Calculate Revolut interest tax
    let revolutTotalGross = 0;
    let revolutTotalTax = 0;
    for (const revol of revolutInterest) {
        const results = calculator.calcRevolutInterest([revol]);
        if (results.length > 0) {
            revolutTotalGross += results[0].netInterestBaseCcy;
            revolutTotalTax += results[0].taxDue;
        }
    }

    const totalInterestGross = stockYieldResult.totalGross + revolutTotalGross;
    const totalInterestTax = stockYieldResult.totalTax + revolutTotalTax;

    const taxResults: TaxResults = {
        capitalGains: capitalGainsResult,
        dividends: dividendsTaxResult,
        interest: {
            totalGross: totalInterestGross,
            totalTax: totalInterestTax,
        },
    };

    // Get the appropriate form config
    const formConfig = taxYear === 2025 ? formConfig2025 : formConfig2026;

    // Map to declaration sections
    const sections = mapToDeclaration(taxResults, formConfig);

    // Calculate total tax due
    const totalTaxDue = capitalGainsResult.taxDue
        + dividendsTaxResult.totalBgTax
        + totalInterestTax;

    const handleExportExcel = async () => {
        try {
            // Convert state to AppState format expected by generateExcel
            const stateAsAppState = {
                taxYear,
                baseCurrency,
                language: 'en' as const,
                holdings,
                sales,
                dividends,
                stockYield,
                ibInterest,
                revolutInterest,
                fxRates,
                manualEntries: [],
            };

            const buffer = await generateExcel(stateAsAppState);
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Данъчна ${taxYear}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export Excel:', error);
            alert('Failed to export Excel file');
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
                <button
                    onClick={handleExportExcel}
                    style={{
                        padding: '0.75rem 1.5rem',
                        backgroundColor: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        fontWeight: 500,
                    }}
                >
                    {t('button.export')}
                </button>
            </div>

            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Tax year {taxYear} • Base currency {baseCurrency}
            </p>

            <div style={{ display: 'grid', gap: '2rem', marginBottom: '2rem' }}>
                {sections.map((section, sectionIndex) => (
                    <div
                        key={sectionIndex}
                        style={{
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            padding: '1.5rem',
                        }}
                    >
                        <h2
                            style={{
                                marginTop: 0,
                                marginBottom: '1.5rem',
                                fontSize: '1.2rem',
                                color: 'var(--text)',
                            }}
                        >
                            {section.title}
                        </h2>

                        <div style={{ display: 'grid', gap: '1rem' }}>
                            {section.fields.map((field, fieldIndex) => (
                                <div
                                    key={fieldIndex}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 2fr 1fr',
                                        gap: '1rem',
                                        alignItems: 'center',
                                        paddingBottom: '1rem',
                                        borderBottom: fieldIndex < section.fields.length - 1
                                            ? '1px solid var(--border)'
                                            : 'none',
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: '0.85rem',
                                            color: 'var(--text-secondary)',
                                        }}
                                    >
                                        {field.ref}
                                    </div>
                                    <div
                                        style={{
                                            color: 'var(--text)',
                                        }}
                                    >
                                        {field.label}
                                    </div>
                                    <div
                                        style={{
                                            textAlign: 'right',
                                            fontWeight: 'bold',
                                            fontSize: '1.1rem',
                                            color: 'var(--accent)',
                                        }}
                                    >
                                        {field.value.toFixed(2)} {baseCurrency}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Total tax due summary card */}
            <div
                style={{
                    backgroundColor: 'var(--accent)',
                    color: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '2rem',
                    textAlign: 'center',
                }}
            >
                <h2 style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                    Част IV - Дължим данък
                </h2>
                <p style={{ marginTop: 0, marginBottom: '1rem', opacity: 0.9 }}>
                    {t('label.totalTax')}
                </p>
                <div
                    style={{
                        fontSize: '2.5rem',
                        fontWeight: 'bold',
                    }}
                >
                    {totalTaxDue.toFixed(2)} {baseCurrency}
                </div>
            </div>
        </div>
    );
}
