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
});
