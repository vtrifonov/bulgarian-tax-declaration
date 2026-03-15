import { describe, it, expect } from 'vitest';
import { calcCapitalGainsTax, calcDividendTax, calcInterestTax } from '../../src/tax/rules.js';

describe('Bulgarian tax rules', () => {
  describe('calcCapitalGainsTax (10%)', () => {
    it('calculates 10% on profit', () => {
      expect(calcCapitalGainsTax(1000)).toBeCloseTo(100);
    });

    it('returns 0 for losses', () => {
      expect(calcCapitalGainsTax(-500)).toBe(0);
    });
  });

  describe('calcDividendTax (5% with WHT credit)', () => {
    it('US dividend (10% WHT > 5% BG rate) → no additional tax', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 100); // gross=1000 BGN, WHT=100 BGN (10%)
      expect(bgTaxDue).toBe(0);
      expect(whtCredit).toBe(50); // min(100, 5% × 1000) = 50
    });

    it('Irish ETF (0% WHT) → full 5% tax', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 0);
      expect(bgTaxDue).toBe(50);
      expect(whtCredit).toBe(0);
    });

    it('Dutch dividend (15% WHT) → no additional tax', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 150);
      expect(bgTaxDue).toBe(0);
      expect(whtCredit).toBe(50); // capped at BG tax amount
    });

    it('partial WHT credit (3% WHT < 5% BG rate)', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 30);
      expect(bgTaxDue).toBe(20); // 50 - 30
      expect(whtCredit).toBe(30);
    });
  });

  describe('calcInterestTax (10%)', () => {
    it('calculates 10% on gross interest', () => {
      expect(calcInterestTax(500)).toBe(50);
    });
  });
});
