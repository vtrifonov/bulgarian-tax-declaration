import type {
    AppState,
    ForeignAccountBalance,
    Spb8FormData,
    Spb8PersonalData,
    Spb8Security,
} from '../types/index.js';

const EUR_BGN = 1.95583;

/**
 * Convert 1 unit of `currency` to the base currency using year-end FX rates.
 * For taxYear ≤ 2025 base is BGN, for ≥ 2026 base is EUR.
 * ECB rates are EUR-native: 1 EUR = X currency.
 */
export function fxToBaseCurrency(
    currency: string,
    taxYear: number,
    fxRates: Record<string, Record<string, number>>,
): number {
    const baseIsEur = taxYear >= 2026;

    if (currency === 'EUR') {
        return baseIsEur ? 1 : EUR_BGN;
    }

    if (currency === 'BGN') {
        return baseIsEur ? 1 / EUR_BGN : 1;
    }

    const yearEnd = `${taxYear}-12-31`;
    const rate = fxRates[currency]?.[yearEnd];

    if (!rate) {
        return 0;
    }

    // ECB: 1 EUR = rate units of currency → 1 currency = 1/rate EUR
    return baseIsEur ? 1 / rate : EUR_BGN / rate;
}

export function assembleSpb8(
    state: AppState,
    personalData: Spb8PersonalData,
    reportType: 'P' | 'R',
    previousYearSecurities?: Spb8Security[],
): Spb8FormData {
    const securities = assembleSecurities(state, previousYearSecurities);
    const accounts = assembleAccounts(state);
    const toBase = (ccy: string) => fxToBaseCurrency(ccy, state.taxYear, state.fxRates);
    const thresholdBgn = state.taxYear >= 2026 ? 50_000 / EUR_BGN : 50_000;

    // Compute per-account value in base currency (for threshold display)
    const accountsWithBase = accounts.map(a => ({
        ...a,
        amountEndOfYearBgn: a.amountEndOfYear * toBase(a.currency),
    }));

    // Compute per-security value in base currency (for threshold display)
    // Uses priceEndOfYear (user-provided market price) if available, else cost basis
    const securitiesWithBase = securities.map(s => {
        const holding = state.holdings.find(h => h.isin === s.isin);
        const price = s.priceEndOfYear ?? holding?.unitPrice ?? 0;

        return {
            ...s,
            amountEndOfYearBgn: s.quantityEndOfYear * price * toBase(s.currency),
        };
    });

    const totalBase = accountsWithBase.reduce((sum, a) => sum + (a.amountEndOfYearBgn ?? 0), 0)
        + securitiesWithBase.reduce((sum, s) => sum + (s.amountEndOfYearBgn ?? 0), 0);

    return {
        year: state.taxYear,
        reportType,
        personalData,
        accounts: accountsWithBase,
        securities: securitiesWithBase,
        thresholdMet: totalBase >= thresholdBgn,
        totalBgn: totalBase,
    };
}

function assembleSecurities(
    state: AppState,
    previousYear?: Spb8Security[],
): Spb8Security[] {
    // Group active holdings by ISIN
    const byIsin = new Map<string, { currency: string; endQty: number }>();

    for (const h of state.holdings) {
        if (h.consumedByFifo || !h.isin) {
            continue;
        }
        const existing = byIsin.get(h.isin);

        if (existing) {
            existing.endQty += h.quantity;
        } else {
            byIsin.set(h.isin, { currency: h.currency, endQty: h.quantity });
        }
    }

    const result: Spb8Security[] = [];
    const year = state.taxYear;

    for (const [isin, data] of byIsin) {
        let startQty: number;

        if (previousYear) {
            const prev = previousYear.find(p => p.isin === isin);

            startQty = prev?.quantityEndOfYear ?? 0;
        } else {
            // Reconstruct: start = end + sold - bought (during tax year)
            const soldQty = state.sales
                .filter(s => {
                    const saleYear = parseInt(s.dateSold.substring(0, 4), 10);

                    return saleYear === year && resolveHoldingIsin(s, state) === isin;
                })
                .reduce((sum, s) => sum + s.quantity, 0);

            const boughtQty = state.holdings
                .filter(h => {
                    const acqYear = parseInt(h.dateAcquired.substring(0, 4), 10);

                    return acqYear === year && h.isin === isin;
                })
                .reduce((sum, h) => sum + h.quantity, 0);

            startQty = data.endQty + soldQty - boughtQty;
        }

        result.push({
            isin,
            currency: data.currency,
            quantityStartOfYear: Math.max(0, startQty),
            quantityEndOfYear: data.endQty,
        });
    }

    return result;
}

/** Try to match a sale to an ISIN via the holdings that were consumed */
function resolveHoldingIsin(
    sale: { symbol: string },
    state: AppState,
): string {
    const holding = state.holdings.find(h => h.symbol === sale.symbol && h.isin);

    return holding?.isin ?? '';
}

function assembleAccounts(state: AppState): ForeignAccountBalance[] {
    return state.foreignAccounts ?? [];
}
