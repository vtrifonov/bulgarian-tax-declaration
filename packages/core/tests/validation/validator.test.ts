import { describe, it, expect } from 'vitest';
import { validate } from '../../src/validation/validator.js';
import type { AppState } from '../../src/types/index.js';

describe('validate', () => {
  it('warns on unmatched WHT', () => {
    const state: Partial<AppState> = {
      taxYear: 2025,
      dividends: [
        { symbol: 'AAPL', country: 'САЩ', date: '2025-02-13', currency: 'USD', grossAmount: 0, withholdingTax: -1.25, bgTaxDue: 0, whtCredit: 0, notes: 'Unmatched WHT' },
      ],
    };
    const warnings = validate(state as AppState);
    expect(warnings.some(w => w.type === 'unmatched-wht')).toBe(true);
  });

  it('warns on missing FX rates', () => {
    const state: Partial<AppState> = {
      taxYear: 2025,
      baseCurrency: 'BGN',
      dividends: [
        { symbol: 'MSFT', country: 'САЩ', date: '2025-03-13', currency: 'USD', grossAmount: 166, withholdingTax: -16.6, bgTaxDue: 0, whtCredit: 0 },
      ],
      fxRates: {}, // No rates
    };
    const warnings = validate(state as AppState);
    expect(warnings.some(w => w.type === 'missing-fx')).toBe(true);
  });

  it('warns on year mismatch', () => {
    const state: Partial<AppState> = {
      taxYear: 2025,
      dividends: [
        { symbol: 'X', country: 'САЩ', date: '2024-12-15', currency: 'USD', grossAmount: 10, withholdingTax: 0, bgTaxDue: 0, whtCredit: 0 },
      ],
    };
    const warnings = validate(state as AppState);
    expect(warnings.some(w => w.type === 'year-mismatch')).toBe(true);
  });
});
