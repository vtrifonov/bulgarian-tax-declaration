import { describe, it, expect } from 'vitest';
import { populateSaleFxRates, populateDividendFxRates } from '../../src/fifo/populate-fx.js';
import type { Sale, Dividend } from '../../src/types/index.js';

describe('populateSaleFxRates', () => {
  const fxRates = { USD: { '2024-03-15': 1.0900, '2025-09-15': 1.0800 } };

  const getRate = (currency: string, date: string): number | undefined => {
    return fxRates[currency]?.[date];
  };

  it('fills fxRateBuy and fxRateSell from FX rates', () => {
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
      dateAcquired: '2024-03-15', dateSold: '2025-09-15',
      quantity: 5, currency: 'USD', buyPrice: 170, sellPrice: 250,
      fxRateBuy: 0, fxRateSell: 0,
    }];
    const filled = populateSaleFxRates(sales, getRate);
    expect(filled[0].fxRateBuy).toBeCloseTo(1.95583 / 1.09, 3);
    expect(filled[0].fxRateSell).toBeCloseTo(1.95583 / 1.08, 3);
  });

  it('leaves fxRate as 0 when rate is missing (validation will warn)', () => {
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
      dateAcquired: '2024-03-15', dateSold: '2025-12-25', // no rate for this date
      quantity: 5, currency: 'USD', buyPrice: 170, sellPrice: 250,
      fxRateBuy: 0, fxRateSell: 0,
    }];
    const filled = populateSaleFxRates(sales, getRate);
    expect(filled[0].fxRateBuy).toBeGreaterThan(0); // buy date has rate
    expect(filled[0].fxRateSell).toBe(0); // sell date missing
  });
});

describe('populateDividendFxRates', () => {
  const getRate = (currency: string, date: string): number | undefined => {
    return undefined;
  };

  it('returns dividends unchanged (FX conversion happens in tax calculator)', () => {
    const dividends: Dividend[] = [{
      symbol: 'AAPL', country: 'САЩ', date: '2025-03-15',
      currency: 'USD', grossAmount: 100, withholdingTax: -10,
      bgTaxDue: 0, whtCredit: 0,
    }];
    const result = populateDividendFxRates(dividends, getRate);
    expect(result).toEqual(dividends);
  });
});
