/** Fixed EUR/BGN rate per Bulgarian Currency Board */
export const BGN_EUR_RATE = 1.95583;

export type BaseCurrency = 'BGN' | 'EUR';

/**
 * Convert an amount from one currency to the base currency.
 * Returns the converted amount, or NaN if FX rate is missing.
 */
export function toBaseCurrency(
    amount: number,
    currency: string,
    date: string,
    baseCurrency: BaseCurrency,
    fxRates: Record<string, Record<string, number>>,
): number {
    if (currency === baseCurrency) return amount;
    if (currency === 'EUR' && baseCurrency === 'BGN') return amount * BGN_EUR_RATE;
    if (currency === 'BGN' && baseCurrency === 'EUR') return amount / BGN_EUR_RATE;
    const ecbRate = fxRates[currency]?.[date];
    if (!ecbRate) return NaN;
    if (baseCurrency === 'EUR') return amount / ecbRate;
    return amount * BGN_EUR_RATE / ecbRate;
}

/**
 * Convert and format, returning '—' if FX rate is missing.
 */
export function toBaseCurrencyStr(
    amount: number,
    currency: string,
    date: string,
    baseCurrency: BaseCurrency,
    fxRates: Record<string, Record<string, number>>,
): string {
    const result = toBaseCurrency(amount, currency, date, baseCurrency, fxRates);
    return isNaN(result) ? '—' : result.toFixed(2);
}

/**
 * Get the FX rate display string for a currency on a date.
 */
export function getFxRate(
    currency: string,
    date: string,
    baseCurrency: BaseCurrency,
    fxRates: Record<string, Record<string, number>>,
): string {
    if (currency === baseCurrency) return '1';
    if (currency === 'EUR' && baseCurrency === 'BGN') return '1.95583';
    if (currency === 'BGN' && baseCurrency === 'EUR') return (1 / BGN_EUR_RATE).toFixed(6);
    const ecbRate = fxRates[currency]?.[date];
    if (!ecbRate) return '—';
    if (baseCurrency === 'EUR') return (1 / ecbRate).toFixed(6);
    return (BGN_EUR_RATE / ecbRate).toFixed(6);
}

/**
 * Compute per-dividend tax in base currency.
 */
export function calcDividendRowTax(
    grossAmount: number,
    withholdingTax: number,
    currency: string,
    date: string,
    baseCurrency: BaseCurrency,
    fxRates: Record<string, Record<string, number>>,
): { grossBase: number; whtBase: number; tax5pct: number; bgTaxDue: number } {
    const grossBase = toBaseCurrency(grossAmount, currency, date, baseCurrency, fxRates);
    const whtBase = toBaseCurrency(withholdingTax, currency, date, baseCurrency, fxRates);
    const gBase = isNaN(grossBase) ? 0 : grossBase;
    const wBase = isNaN(whtBase) ? 0 : whtBase;
    const tax5pct = gBase * 0.05;
    const bgTaxDue = Math.max(0, tax5pct - wBase);
    return { grossBase: gBase, whtBase: wBase, tax5pct, bgTaxDue };
}
