import { describe, it, expect } from 'vitest';
import { TaxCalculator } from '../../src/tax/calculator.js';
import type { Sale, Dividend, StockYieldEntry, RevolutInterest } from '../../src/types/index.js';

describe('TaxCalculator', () => {
  const fxRates = { USD: { '2025-03-13': 1.0353, '2025-06-15': 1.08 } };

  it('calculates capital gains tax from sales', () => {
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
      dateAcquired: '2024-01-01', dateSold: '2025-06-15',
      quantity: 10, currency: 'USD',
      buyPrice: 170, sellPrice: 250,
      fxRateBuy: 1.889, fxRateSell: 1.811,
    }];
    const calc = new TaxCalculator('BGN');
    const result = calc.calcCapitalGains(sales);
    // Proceeds: 10 × 250 × 1.811 = 4527.5 BGN
    // Cost: 10 × 170 × 1.889 = 3211.3 BGN
    // Profit: 1316.2 BGN → Tax: 131.62 BGN
    expect(result.totalProceeds).toBeCloseTo(4527.5, 0);
    expect(result.totalCost).toBeCloseTo(3211.3, 0);
    expect(result.taxDue).toBeCloseTo(131.62, 0);
  });

  it('calculates Revolut interest tax', () => {
    const revolut: RevolutInterest[] = [{
      currency: 'EUR',
      entries: [
        { date: '2025-01-01', description: 'Interest PAID', amount: 100 },
        { date: '2025-01-01', description: 'Service Fee Charged', amount: -10 },
      ],
    }];
    const calc = new TaxCalculator('BGN');
    const result = calc.calcRevolutInterest(revolut);
    // Net EUR = 90, BGN = 90 × 1.95583 = 176.0247
    expect(result[0].netInterestBaseCcy).toBeCloseTo(176.02, 0);
    expect(result[0].taxDue).toBeCloseTo(17.60, 0);
  });

  it('handles capital gains with losses (negative profit returns zero tax)', () => {
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'САЩ', symbol: 'TEST',
      dateAcquired: '2025-01-01', dateSold: '2025-06-15',
      quantity: 10, currency: 'USD',
      buyPrice: 250, sellPrice: 200,
      fxRateBuy: 1.889, fxRateSell: 1.811,
    }];
    const calc = new TaxCalculator('BGN');
    const result = calc.calcCapitalGains(sales);
    // Proceeds: 10 × 200 × 1.811 = 3622 BGN
    // Cost: 10 × 250 × 1.889 = 4722.5 BGN
    // Profit: -1100.5 BGN → Tax: 0 (losses don't generate tax)
    expect(result.profit).toBeLessThan(0);
    expect(result.taxDue).toBe(0);
  });

  it('handles mixed profits and losses across multiple sales', () => {
    const sales: Sale[] = [
      {
        id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
        dateAcquired: '2024-01-01', dateSold: '2025-06-15',
        quantity: 10, currency: 'USD',
        buyPrice: 170, sellPrice: 250,
        fxRateBuy: 1.889, fxRateSell: 1.811,
      },
      {
        id: '2', broker: 'IB', country: 'САЩ', symbol: 'MSFT',
        dateAcquired: '2024-06-01', dateSold: '2025-08-01',
        quantity: 5, currency: 'USD',
        buyPrice: 300, sellPrice: 280,
        fxRateBuy: 1.900, fxRateSell: 1.850,
      },
    ];
    const calc = new TaxCalculator('BGN');
    const result = calc.calcCapitalGains(sales);
    // Sale 1 profit: (10 × 250 × 1.811) - (10 × 170 × 1.889) = 4527.5 - 3211.3 = 1316.2
    // Sale 2 loss: (5 × 280 × 1.850) - (5 × 300 × 1.900) = 2590 - 2850 = -260
    // Total profit: 1316.2 - 260 = 1056.2 → Tax: 105.62
    expect(result.profit).toBeCloseTo(1056.2, 0);
    expect(result.taxDue).toBeCloseTo(105.62, 0);
  });

  it('calculates dividend tax with WHT credits', () => {
    const dividends: Dividend[] = [
      {
        symbol: 'AAPL',
        country: 'САЩ',
        date: '2025-03-15',
        currency: 'USD',
        grossAmount: 100,
        withholdingTax: -10,
        bgTaxDue: 0,
        whtCredit: 0,
      },
      {
        symbol: 'MSFT',
        country: 'САЩ',
        date: '2025-04-20',
        currency: 'USD',
        grossAmount: 200,
        withholdingTax: -15,
        bgTaxDue: 0,
        whtCredit: 0,
      },
    ];
    const fxRates = { USD: { '2025-03-15': 1.0353, '2025-04-20': 1.08 } };
    const calc = new TaxCalculator('BGN');
    const result = calc.calcDividendsTax(dividends, fxRates);
    // Assumes 1.95583 / 1.0353 = 1.8883 and 1.95583 / 1.08 = 1.8110 BGN/USD
    // Gross total = 100 × 1.8883 + 200 × 1.8110 ≈ 188.83 + 362.2 ≈ 551.03
    // WHT total = 10 × 1.8883 + 15 × 1.8110 ≈ 18.88 + 27.17 ≈ 46.05
    // BG tax (5%) = 551.03 × 0.05 ≈ 27.55, WHT credit = min(46.05, 27.55) = 27.55
    // BG tax due = max(0, 27.55 - 46.05) = 0
    expect(result.totalGross).toBeCloseTo(551, 0);
    expect(result.totalWht).toBeCloseTo(46, 0);
    expect(result.totalBgTax).toBe(0);
    expect(result.totalWhtCredit).toBeCloseTo(27.55, 0);
  });

  it('calculates stock yield interest tax', () => {
    const entries: StockYieldEntry[] = [
      {
        symbol: 'XYZ',
        country: 'САЩ',
        date: '2025-02-15',
        currency: 'USD',
        amount: 50,
      },
      {
        symbol: 'XYZ',
        country: 'САЩ',
        date: '2025-05-20',
        currency: 'USD',
        amount: 75,
      },
    ];
    const fxRates = { USD: { '2025-02-15': 1.05, '2025-05-20': 1.1 } };
    const calc = new TaxCalculator('BGN');
    const result = calc.calcStockYieldTax(entries, fxRates);
    // 50 × (1.95583/1.05) + 75 × (1.95583/1.1) = 50 × 1.8627 + 75 × 1.7780 ≈ 93.14 + 133.35 ≈ 226.49
    // Tax (10%) = 226.49 × 0.10 ≈ 22.65
    expect(result.totalGross).toBeCloseTo(226.5, 0);
    expect(result.totalTax).toBeCloseTo(22.65, 0);
  });

  it('returns zero totals for empty sales array', () => {
    const calc = new TaxCalculator('BGN');
    const result = calc.calcCapitalGains([]);
    expect(result.totalProceeds).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.profit).toBe(0);
    expect(result.taxDue).toBe(0);
  });

  it('returns zero totals for empty dividend array', () => {
    const calc = new TaxCalculator('BGN');
    const result = calc.calcDividendsTax([], {});
    expect(result.totalGross).toBe(0);
    expect(result.totalWht).toBe(0);
    expect(result.totalBgTax).toBe(0);
    expect(result.totalWhtCredit).toBe(0);
  });

  it('returns zero totals for empty stock yield entries', () => {
    const calc = new TaxCalculator('BGN');
    const result = calc.calcStockYieldTax([], {});
    expect(result.totalGross).toBe(0);
    expect(result.totalTax).toBe(0);
  });

  it('returns zero totals for empty Revolut interest array', () => {
    const calc = new TaxCalculator('BGN');
    const result = calc.calcRevolutInterest([]);
    expect(result).toHaveLength(0);
  });
});
