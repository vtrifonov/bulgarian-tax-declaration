import { calcDividendRowTax } from '../fx/convert.js';
import type {
    BaseCurrency,
    Dividend,
} from '../types/index.js';

export interface NraFormRow {
    rowLabel: string;
    name: string;
    country: string;
    incomeCode: number;
    methodCode: number;
    grossAmount: number;
    acquisitionCost: number;
    difference: number;
    foreignTax: number;
    allowedCredit: number;
    recognizedCredit: number;
    taxDue: number;
}

export function buildNraFormRows(
    dividends: Dividend[],
    fxRates: Record<string, Record<string, number>>,
    baseCurrency: BaseCurrency,
): NraFormRow[] {
    const sorted = dividends
        .filter(d => d.symbol && d.grossAmount > 0)
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));

    return sorted.map((d, i) => {
        const { grossBase, whtBase, tax5pct, bgTaxDue } = calcDividendRowTax(
            d.grossAmount,
            d.withholdingTax,
            d.currency,
            d.date,
            baseCurrency,
            fxRates,
        );

        return {
            rowLabel: `${i + 1}.1`,
            name: d.symbol,
            country: d.country,
            incomeCode: 8141,
            methodCode: 1,
            grossAmount: Math.round(grossBase * 100) / 100,
            acquisitionCost: 0,
            difference: 0,
            foreignTax: Math.round(whtBase * 100) / 100,
            allowedCredit: Math.round(tax5pct * 100) / 100,
            recognizedCredit: Math.round(Math.min(whtBase, tax5pct) * 100) / 100,
            taxDue: Math.round(bgTaxDue * 100) / 100,
        };
    });
}
