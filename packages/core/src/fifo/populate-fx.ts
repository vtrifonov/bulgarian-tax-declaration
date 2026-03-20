import type {
    Dividend,
    Sale,
} from '../types/index.js';

// ECB cross-rate conversion factor
const BGN_TO_EUR = 1.95583;

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
        // Same currency as base → rate is 1
        if (s.currency === baseCurrency) {
            return { ...s, fxRateBuy: 1, fxRateSell: 1 };
        }

        // EUR↔BGN uses fixed rate
        if (s.currency === 'EUR' && baseCurrency === 'BGN') {
            return { ...s, fxRateBuy: BGN_TO_EUR, fxRateSell: BGN_TO_EUR };
        }

        if (s.currency === 'BGN' && baseCurrency === 'EUR') {
            const rate = 1 / BGN_TO_EUR;

            return { ...s, fxRateBuy: rate, fxRateSell: rate };
        }

        const buyEcbRate = getRate(s.currency, s.dateAcquired);
        const sellEcbRate = getRate(s.currency, s.dateSold);

        const fxRateBuy = buyEcbRate !== undefined
            ? baseCurrency === 'BGN'
                ? BGN_TO_EUR / buyEcbRate
                : 1 / buyEcbRate
            : null;

        const fxRateSell = sellEcbRate !== undefined
            ? baseCurrency === 'BGN'
                ? BGN_TO_EUR / sellEcbRate
                : 1 / sellEcbRate
            : null;

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
    _getRate: (currency: string, date: string) => number | undefined,
): Dividend[] {
    return dividends.map(d => ({ ...d })); // FX conversion happens in tax calculator
}
