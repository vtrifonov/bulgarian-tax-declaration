import { describe, it, expect } from 'vitest';
import { matchWhtToDividends } from '../../src/parsers/wht-matcher.js';
import type { IBDividend, IBWithholdingTax } from '../../src/types/index.js';

describe('matchWhtToDividends', () => {
  it('matches WHT to dividend by symbol+date+currency', () => {
    const dividends: IBDividend[] = [
      { currency: 'USD', date: '2025-02-13', symbol: 'AAPL', description: '', amount: 12.50 },
    ];
    const whts: IBWithholdingTax[] = [
      { currency: 'USD', date: '2025-02-13', symbol: 'AAPL', description: '', amount: -1.25 },
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].grossAmount).toBe(12.50);
    expect(result.matched[0].withholdingTax).toBe(1.25); // Normalized to positive
    expect(result.unmatched).toHaveLength(0);
  });

  it('combines multiple WHT entries for same symbol+date+currency before matching', () => {
    // ET has two WHT lines: -6.50 and -24.05 on same date
    const dividends: IBDividend[] = [
      { currency: 'USD', date: '2025-02-19', symbol: 'ET', description: '', amount: 65.00 },
    ];
    const whts: IBWithholdingTax[] = [
      { currency: 'USD', date: '2025-02-19', symbol: 'ET', description: '', amount: -6.50 },
      { currency: 'USD', date: '2025-02-19', symbol: 'ET', description: '', amount: -24.05 },
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].withholdingTax).toBeCloseTo(30.55); // |(-6.50) + (-24.05)|
  });

  it('handles BABA same-day ordinary + bonus (already combined by parser)', () => {
    const dividends: IBDividend[] = [
      { currency: 'USD', date: '2025-07-10', symbol: 'BABA', description: '', amount: 20.00 }, // combined: 10.50 + 9.50
    ];
    const whts: IBWithholdingTax[] = []; // BABA has 0% WHT
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].withholdingTax).toBe(0);
  });

  it('handles ASML reversal+re-entry (net positive) with WHT', () => {
    const dividends: IBDividend[] = [
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: 10.64 }, // already netted by parser
    ];
    const whts: IBWithholdingTax[] = [
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: -1.60 },
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: 1.60 },  // reversal
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: -1.60 },
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].withholdingTax).toBeCloseTo(1.60); // net: |-1.60 + 1.60 + -1.60| = 1.60
  });

  it('creates unmatched WHT as standalone dividend row with gross=0', () => {
    const dividends: IBDividend[] = [];
    const whts: IBWithholdingTax[] = [
      { currency: 'USD', date: '2024-12-04', symbol: 'VCLT', description: 'prior year adj', amount: 0.95 }, // net of +1.05 and -0.10
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].grossAmount).toBe(0);
    expect(result.unmatched[0].withholdingTax).toBeCloseTo(0.95);
    expect(result.unmatched[0].notes).toContain('Unmatched WHT');
  });
});
