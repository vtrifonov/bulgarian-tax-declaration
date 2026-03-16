import type {
    AppState,
    ValidationWarning,
} from '../types/index.js';

export function validate(state: AppState): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    warnings.push(...checkUnmatchedWht(state));
    warnings.push(...checkMissingFx(state));
    warnings.push(...checkYearMismatch(state));
    return warnings;
}

function checkUnmatchedWht(state: AppState): ValidationWarning[] {
    return (state.dividends ?? [])
        .map((d, idx) => ({ d, idx }))
        .filter(({ d }) => d.grossAmount === 0 && d.withholdingTax !== 0)
        .map(({ d, idx }) => ({
            type: 'unmatched-wht' as const,
            message: `Unmatched WHT for ${d.symbol} on ${d.date}: ${d.withholdingTax}`,
            tab: 'Dividends',
            rowId: `dividend-${idx}`,
            rowIndex: idx,
        }));
}

function checkMissingFx(state: AppState): ValidationWarning[] {
    if (state.baseCurrency === 'EUR') return [];
    const warnings: ValidationWarning[] = [];
    for (let i = 0; i < (state.dividends ?? []).length; i++) {
        const d = state.dividends[i];
        if (d.currency !== state.baseCurrency && d.currency !== 'EUR') {
            const rate = state.fxRates?.[d.currency]?.[d.date];
            if (rate === undefined) {
                warnings.push({
                    type: 'missing-fx',
                    message: `Missing FX rate for ${d.currency} on ${d.date}`,
                    tab: 'Dividends',
                    rowId: `dividend-${i}`,
                    rowIndex: i,
                });
            }
        }
    }
    return warnings;
}

function checkYearMismatch(state: AppState): ValidationWarning[] {
    const year = String(state.taxYear);
    return (state.dividends ?? [])
        .map((d, idx) => ({ d, idx }))
        .filter(({ d }) => !d.date.startsWith(year))
        .map(({ d, idx }) => ({
            type: 'year-mismatch' as const,
            message: `${d.symbol} dividend on ${d.date} is outside tax year ${state.taxYear}`,
            tab: 'Dividends',
            rowId: `dividend-${idx}`,
            rowIndex: idx,
        }));
}
