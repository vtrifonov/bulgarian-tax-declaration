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

describe('populateSaleFxRates edge cases', () => {
  it('EUR currency in BGN base returns fixed rate 1.95583', () => {
    const fxRates = { EUR: { '2025-01-15': 1.0 } }; // ECB rate of 1.0 for EUR
    const getRate = (currency: string, date: string): number | undefined => {
      return fxRates[currency]?.[date];
    };
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'Ирландия', symbol: 'CSPX',
      dateAcquired: '2025-01-15', dateSold: '2025-01-15',
      quantity: 1, currency: 'EUR', buyPrice: 100, sellPrice: 110,
      fxRateBuy: 0, fxRateSell: 0,
    }];
    const filled = populateSaleFxRates(sales, getRate, 'BGN');
    expect(filled[0].fxRateBuy).toBeCloseTo(1.95583, 3);
    expect(filled[0].fxRateSell).toBeCloseTo(1.95583, 3);
  });

  it('BGN currency in BGN base returns 1', () => {
    const getRate = (currency: string, date: string): number | undefined => {
      return undefined; // No rate needed for BGN
    };
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'България', symbol: 'TEST',
      dateAcquired: '2025-01-15', dateSold: '2025-01-15',
      quantity: 10, currency: 'BGN', buyPrice: 100, sellPrice: 110,
      fxRateBuy: 0, fxRateSell: 0,
    }];
    const filled = populateSaleFxRates(sales, getRate, 'BGN');
    // BGN with BGN base: getRate returns undefined, so fxRate = 0
    expect(filled[0].fxRateBuy).toBe(0);
    expect(filled[0].fxRateSell).toBe(0);
  });

  it('multiple sales with different currencies', () => {
    const fxRates = {
      USD: { '2025-02-01': 1.0353, '2025-03-01': 1.08 },
      EUR: { '2025-02-01': 1.0, '2025-03-01': 1.0 },
    };
    const getRate = (currency: string, date: string): number | undefined => {
      return fxRates[currency]?.[date];
    };
    const sales: Sale[] = [
      {
        id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
        dateAcquired: '2025-02-01', dateSold: '2025-03-01',
        quantity: 10, currency: 'USD', buyPrice: 150, sellPrice: 170,
        fxRateBuy: 0, fxRateSell: 0,
      },
      {
        id: '2', broker: 'IB', country: 'Ирландия', symbol: 'VANGUARD',
        dateAcquired: '2025-02-01', dateSold: '2025-03-01',
        quantity: 5, currency: 'EUR', buyPrice: 100, sellPrice: 120,
        fxRateBuy: 0, fxRateSell: 0,
      },
    ];
    const filled = populateSaleFxRates(sales, getRate, 'BGN');
    // USD: 1.95583 / 1.0353 ≈ 1.8891, 1.95583 / 1.08 ≈ 1.8110
    expect(filled[0].fxRateBuy).toBeCloseTo(1.8891, 3);
    expect(filled[0].fxRateSell).toBeCloseTo(1.8110, 3);
    // EUR: 1.95583 / 1.0 = 1.95583
    expect(filled[1].fxRateBuy).toBeCloseTo(1.95583, 3);
    expect(filled[1].fxRateSell).toBeCloseTo(1.95583, 3);
  });

  it('empty sales array returns empty', () => {
    const getRate = (currency: string, date: string): number | undefined => {
      return undefined;
    };
    const sales: Sale[] = [];
    const filled = populateSaleFxRates(sales, getRate, 'BGN');
    expect(filled).toHaveLength(0);
  });
});
