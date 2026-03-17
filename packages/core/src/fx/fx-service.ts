import { fetchYearRates } from './ecb-api.js';
import type { FxCache } from './fx-cache.js';
import { gapFillRates } from './gap-fill.js';
import type { BaseCurrency } from '../types/index.js';

const EUR_BGN_FIXED = 1.95583;

/**
 * FX Service orchestrates FX rate fetching, caching, gap-filling, and base currency conversion.
 * Handles:
 * - Fetching rates from ECB API (with 3-month chunking)
 * - Caching rates to avoid repeated API calls
 * - Gap-filling rates for weekends and holidays
 * - Converting rates to the desired base currency
 */
export class FxService {
    constructor(
        private cache: FxCache,
        private baseCurrency: BaseCurrency,
    ) {}

    /**
     * Get the exchange rate for converting a currency to the base currency on a given date.
     * @param currency - ISO 4217 currency code
     * @param date - Date in YYYY-MM-DD format
     * @param rates - Map of currency → (date → rate), from fetchRates()
     * @returns Exchange rate (units of base currency per 1 unit of input currency), or null if not found
     */
    getRate(
        currency: string,
        date: string,
        rates: Record<string, Record<string, number>>,
    ): number | null {
        if (currency === this.baseCurrency) {
            return 1;
        }

        if (currency === 'EUR' && this.baseCurrency === 'BGN') {
            return EUR_BGN_FIXED;
        }

        if (currency === 'BGN' && this.baseCurrency === 'EUR') {
            return 1 / EUR_BGN_FIXED;
        }

        const currencyRates = rates[currency];

        if (!currencyRates) {
            return null;
        }

        const ecbRate = currencyRates[date];

        if (ecbRate === undefined) {
            return null;
        }

        // ECB rates are EUR-native: 1 EUR = X currency
        // We need: 1 unit of currency = ? base currency
        // For EUR base: 1 USD = 1/ecbRate EUR
        if (this.baseCurrency === 'EUR') {
            return 1 / ecbRate;
        }

        // For BGN base: 1 USD = (1/ecbRate) × EUR_BGN_FIXED BGN
        return EUR_BGN_FIXED / ecbRate;
    }

    /**
     * Fetch and cache FX rates for all needed currencies for a year.
     * Fills gaps (weekends/holidays), filters to non-built-in currencies.
     * @param currencies - Array of ISO 4217 currency codes
     * @param year - Tax year
     * @returns Map of currency → (date → rate) for all dates in the year
     */
    async fetchRates(
        currencies: string[],
        year: number,
    ): Promise<Record<string, Record<string, number>>> {
        const result: Record<string, Record<string, number>> = {};
        const uniqueCurrencies = [...new Set(currencies.filter(c => c !== 'EUR' && c !== 'BGN'))];

        // Fetch all currencies in parallel
        await Promise.all(uniqueCurrencies.map(async (ccy) => {
            let rates = await this.cache.get(ccy, year);

            if (!rates) {
                try {
                    rates = await fetchYearRates(ccy, year);
                    await this.cache.set(ccy, year, rates);
                } catch {
                    rates = {};
                }
            }
            result[ccy] = gapFillRates(rates, `${year}-01-01`, `${year}-12-31`);
        }));

        return result;
    }
}
