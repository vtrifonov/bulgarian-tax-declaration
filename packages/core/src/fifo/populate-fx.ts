import type {
    Dividend,
    Sale,
} from '../types/index.js';

// ECB cross-rate conversion factors
const BGN_TO_EUR = 1.95583; // 1 BGN = 1.95583 EUR (inverse)
const ECB_CONVERSION: Record<string, number> = {
    USD: 1.0, // baseline
};

/**
 * Populate FX rates for sales using a rate lookup function.
 * For BGN base: rate = 1.95583 / ecbRate
 * For EUR base: rate = 1 / ecbRate
 */
export function populateSaleFxRates(
    sales: Sale[],
    getRate: (currency: string, date: string) => number | undefined,
    baseCurrency: 'BGN' | 'EUR' = 'BGN',
): Sale[] {
    return sales.map(s => {
        const buyEcbRate = getRate(s.currency, s.dateAcquired);
        const sellEcbRate = getRate(s.currency, s.dateSold);

        const fxRateBuy = buyEcbRate !== undefined
            ? baseCurrency === 'BGN'
                ? BGN_TO_EUR / buyEcbRate
                : 1 / buyEcbRate
            : 0;

        const fxRateSell = sellEcbRate !== undefined
            ? baseCurrency === 'BGN'
                ? BGN_TO_EUR / sellEcbRate
                : 1 / sellEcbRate
            : 0;

        return {
            ...s,
            fxRateBuy,
            fxRateSell,
        };
    });
}

/**
 * FX conversion for dividends happens in the tax calculator,
 * so this function just returns dividends as-is.
 */
export function populateDividendFxRates(
    dividends: Dividend[],
    getRate: (currency: string, date: string) => number | undefined,
): Dividend[] {
    return dividends.map(d => ({ ...d })); // FX conversion happens in tax calculator
}
