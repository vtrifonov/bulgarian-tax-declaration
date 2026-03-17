import {
    calcCapitalGainsTax,
    calcDividendTax,
    calcInterestTax,
} from './rules.js';
import type {
    BrokerInterest,
    Dividend,
    Sale,
    StockYieldEntry,
} from '../types/index.js';

export interface CapitalGainsResult {
    totalProceeds: number;
    totalCost: number;
    profit: number;
    taxDue: number;
}

export interface DividendsTaxResult {
    totalGross: number;
    totalWht: number;
    totalBgTax: number;
    totalWhtCredit: number;
}

export interface RevolutInterestResult {
    currency: string;
    netInterestInCurrency: number;
    netInterestBaseCcy: number;
    taxDue: number;
}

export interface StockYieldResult {
    totalGross: number;
    totalTax: number;
}

// ECB cross-rate conversion for dividends
const BGN_TO_EUR = 1.95583;

export class TaxCalculator {
    constructor(private baseCurrency: 'BGN' | 'EUR') {}

    calcCapitalGains(sales: Sale[]): CapitalGainsResult {
        let totalProceeds = 0;
        let totalCost = 0;

        for (const sale of sales) {
            const proceeds = sale.quantity * sale.sellPrice * sale.fxRateSell;
            const cost = sale.quantity * sale.buyPrice * sale.fxRateBuy;

            totalProceeds += proceeds;
            totalCost += cost;
        }

        const profit = totalProceeds - totalCost;
        const taxDue = calcCapitalGainsTax(profit);

        return {
            totalProceeds,
            totalCost,
            profit,
            taxDue,
        };
    }

    calcDividendsTax(
        dividends: Dividend[],
        fxRates: Record<string, Record<string, number>>,
    ): DividendsTaxResult {
        let totalGross = 0;
        let totalWht = 0;
        let totalBgTax = 0;
        let totalWhtCredit = 0;

        for (const div of dividends) {
            // Convert gross and WHT to base currency if needed
            let grossInBaseCcy = div.grossAmount;
            let whtInBaseCcy = Math.abs(div.withholdingTax);

            if (div.currency !== this.baseCurrency) {
                if (div.currency === 'EUR' && this.baseCurrency === 'BGN') {
                    // Convert EUR to BGN using fixed rate
                    grossInBaseCcy = div.grossAmount * BGN_TO_EUR;
                    whtInBaseCcy = Math.abs(div.withholdingTax) * BGN_TO_EUR;
                } else if (div.currency !== 'EUR') {
                    // Convert other currencies using ECB rates
                    const rate = fxRates[div.currency]?.[div.date];

                    if (rate !== undefined) {
                        const fxRate = this.baseCurrency === 'BGN' ? BGN_TO_EUR / rate : 1 / rate;

                        grossInBaseCcy = div.grossAmount * fxRate;
                        whtInBaseCcy = Math.abs(div.withholdingTax) * fxRate;
                    }
                }
            }

            const { bgTaxDue, whtCredit } = calcDividendTax(grossInBaseCcy, whtInBaseCcy);

            totalGross += grossInBaseCcy;
            totalWht += whtInBaseCcy;
            totalBgTax += bgTaxDue;
            totalWhtCredit += whtCredit;
        }

        return {
            totalGross,
            totalWht,
            totalBgTax,
            totalWhtCredit,
        };
    }

    calcStockYieldTax(
        entries: StockYieldEntry[],
        fxRates: Record<string, Record<string, number>>,
    ): StockYieldResult {
        let totalGross = 0;

        for (const entry of entries) {
            let amountInBaseCcy = entry.amount;

            if (entry.currency !== this.baseCurrency) {
                if (entry.currency === 'EUR' && this.baseCurrency === 'BGN') {
                    // Convert EUR to BGN using fixed rate
                    amountInBaseCcy = entry.amount * BGN_TO_EUR;
                } else if (entry.currency !== 'EUR') {
                    // Convert other currencies using ECB rates
                    const rate = fxRates[entry.currency]?.[entry.date];

                    if (rate !== undefined) {
                        const fxRate = this.baseCurrency === 'BGN' ? BGN_TO_EUR / rate : 1 / rate;

                        amountInBaseCcy = entry.amount * fxRate;
                    }
                }
            }

            totalGross += amountInBaseCcy;
        }

        const totalTax = calcInterestTax(totalGross);

        return {
            totalGross,
            totalTax,
        };
    }

    calcRevolutInterest(revolut: BrokerInterest[]): RevolutInterestResult[] {
        const results: RevolutInterestResult[] = [];

        for (const rev of revolut) {
            const netInterestInCurrency = rev.entries.reduce((sum: number, e) => sum + e.amount, 0);

            // Convert to base currency (assuming 1:1 for EUR in BGN context)
            let netInterestBaseCcy = netInterestInCurrency;

            if (rev.currency === 'EUR' && this.baseCurrency === 'BGN') {
                netInterestBaseCcy = netInterestInCurrency * BGN_TO_EUR;
            }

            const taxDue = calcInterestTax(netInterestBaseCcy);

            results.push({
                currency: rev.currency,
                netInterestInCurrency,
                netInterestBaseCcy,
                taxDue,
            });
        }

        return results;
    }
}
