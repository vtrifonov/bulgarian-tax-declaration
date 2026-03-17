import type {
    AppState,
    ValidationWarning,
} from '../types/index.js';

export function validate(state: AppState): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    warnings.push(...checkUnmatchedWht(state));
    warnings.push(...checkMissingFx(state));
    warnings.push(...checkYearMismatch(state));
    warnings.push(...checkIncompleteRows(state));
    warnings.push(...checkDuplicateHoldings(state));

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
    if (state.baseCurrency === 'EUR') {
        return [];
    }
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

function checkIncompleteRows(state: AppState): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Holdings: need symbol, dateAcquired, quantity > 0, currency
    for (let i = 0; i < (state.holdings ?? []).length; i++) {
        const h = state.holdings[i];
        const missing: string[] = [];

        if (!h.symbol) {
            missing.push('symbol');
        }

        if (!h.dateAcquired) {
            missing.push('date');
        }

        if (!h.currency) {
            missing.push('currency');
        }

        if (h.quantity === 0 && h.unitPrice === 0) {
            missing.push('quantity/price');
        }

        if (missing.length > 0) {
            warnings.push({
                type: 'incomplete-row',
                message: `Incomplete holding row ${i + 1}: missing ${missing.join(', ')}`,
                tab: 'Holdings',
                rowIndex: i,
            });
        }
    }

    // Sales: need symbol, dateAcquired, dateSold, quantity > 0, currency
    for (let i = 0; i < (state.sales ?? []).length; i++) {
        const s = state.sales[i];
        const missing: string[] = [];

        if (!s.symbol) {
            missing.push('symbol');
        }

        if (!s.dateAcquired) {
            missing.push('date acquired');
        }

        if (!s.dateSold) {
            missing.push('date sold');
        }

        if (!s.currency) {
            missing.push('currency');
        }

        if (s.quantity === 0) {
            missing.push('quantity');
        }

        if (missing.length > 0) {
            warnings.push({
                type: 'incomplete-row',
                message: `Incomplete sale row ${i + 1}: missing ${missing.join(', ')}`,
                tab: 'Sales',
                rowIndex: i,
            });
        }
    }

    // Dividends: need symbol, date, currency, grossAmount > 0
    for (let i = 0; i < (state.dividends ?? []).length; i++) {
        const d = state.dividends[i];
        const missing: string[] = [];

        if (!d.symbol) {
            missing.push('symbol');
        }

        if (!d.date) {
            missing.push('date');
        }

        if (!d.currency) {
            missing.push('currency');
        }

        if (d.grossAmount === 0 && d.withholdingTax === 0) {
            missing.push('amounts');
        }

        if (missing.length > 0) {
            warnings.push({
                type: 'incomplete-row',
                message: `Incomplete dividend row ${i + 1}: missing ${missing.join(', ')}`,
                tab: 'Dividends',
                rowIndex: i,
            });
        }
    }

    // Broker Interest: need date, currency, amount != 0
    for (const bi of (state.brokerInterest ?? [])) {
        for (let i = 0; i < bi.entries.length; i++) {
            const e = bi.entries[i];
            const missing: string[] = [];

            if (!e.date) {
                missing.push('date');
            }

            if (!e.currency) {
                missing.push('currency');
            }

            if (e.amount === 0) {
                missing.push('amount');
            }

            if (missing.length > 0) {
                warnings.push({
                    type: 'incomplete-row',
                    message: `Incomplete ${bi.broker} interest row ${i + 1}: missing ${missing.join(', ')}`,
                    tab: `${bi.broker} Interest`,
                    rowIndex: i,
                });
            }
        }
    }

    // Stock Yield: need date, symbol, currency, amount != 0
    for (let i = 0; i < (state.stockYield ?? []).length; i++) {
        const sy = state.stockYield[i];
        const missing: string[] = [];

        if (!sy.date) {
            missing.push('date');
        }

        if (!sy.symbol) {
            missing.push('symbol');
        }

        if (!sy.currency) {
            missing.push('currency');
        }

        if (sy.amount === 0) {
            missing.push('amount');
        }

        if (missing.length > 0) {
            warnings.push({
                type: 'incomplete-row',
                message: `Incomplete stock yield row ${i + 1}: missing ${missing.join(', ')}`,
                tab: 'Stock Yield',
                rowIndex: i,
            });
        }
    }

    return warnings;
}

function checkDuplicateHoldings(state: AppState): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const holdings = state.holdings ?? [];
    const flagged = new Set<number>();

    for (let i = 0; i < holdings.length; i++) {
        if (!holdings[i].symbol) {
            continue;
        }

        for (let j = i + 1; j < holdings.length; j++) {
            const a = holdings[i];
            const b = holdings[j];

            if (a.symbol !== b.symbol || a.currency !== b.currency) {
                continue;
            }
            // Different sources required
            const srcA = a.source?.type ?? 'unknown';
            const srcB = b.source?.type ?? 'unknown';

            if (srcA === srcB) {
                continue;
            }

            // Same quantity required
            if (a.quantity !== b.quantity) {
                continue;
            }
            // Flag if: same date, OR one side is missing date/price (from IB transfer)
            const sameDate = a.dateAcquired && b.dateAcquired && a.dateAcquired === b.dateAcquired;
            const aMissingInfo = !a.dateAcquired || a.unitPrice === 0;
            const bMissingInfo = !b.dateAcquired || b.unitPrice === 0;

            if (!sameDate && !aMissingInfo && !bMissingInfo) {
                continue;
            }

            const reason = sameDate ? 'same date' : 'missing date/price';

            if (!flagged.has(i)) {
                flagged.add(i);
                warnings.push({
                    type: 'duplicate-holding',
                    message: `${a.symbol} (${a.quantity}) likely duplicated (${reason}) — also in ${srcB} source`,
                    tab: 'Holdings',
                    rowIndex: i,
                });
            }

            if (!flagged.has(j)) {
                flagged.add(j);
                warnings.push({
                    type: 'duplicate-holding',
                    message: `${b.symbol} (${b.quantity}) likely duplicated (${reason}) — also in ${srcA} source`,
                    tab: 'Holdings',
                    rowIndex: j,
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
