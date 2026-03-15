import {
    describe,
    expect,
    it,
} from 'vitest';
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

    it('returns no warnings for valid state', () => {
        const state: Partial<AppState> = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            dividends: [
                { symbol: 'AAPL', country: 'САЩ', date: '2025-03-15', currency: 'USD', grossAmount: 100, withholdingTax: -10, bgTaxDue: 0, whtCredit: 0 },
            ],
            fxRates: { USD: { '2025-03-15': 1.0353 } },
        };
        const warnings = validate(state as AppState);
        expect(warnings).toHaveLength(0);
    });

    it('returns multiple warnings of different types', () => {
        const state: Partial<AppState> = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            dividends: [
                { symbol: 'AAPL', country: 'САЩ', date: '2024-12-15', currency: 'USD', grossAmount: 100, withholdingTax: -10, bgTaxDue: 0, whtCredit: 0 },
                { symbol: 'MSFT', country: 'САЩ', date: '2025-03-20', currency: 'JPY', grossAmount: 50, withholdingTax: -5, bgTaxDue: 0, whtCredit: 0 },
            ],
            fxRates: {}, // Missing JPY rate
        };
        const warnings = validate(state as AppState);
        expect(warnings.length).toBeGreaterThanOrEqual(2);
        expect(warnings.some(w => w.type === 'year-mismatch')).toBe(true);
        expect(warnings.some(w => w.type === 'missing-fx')).toBe(true);
    });

    it('EUR in BGN base does not need FX check', () => {
        const state: Partial<AppState> = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            dividends: [
                { symbol: 'VANGUARD', country: 'Ирландия', date: '2025-06-15', currency: 'EUR', grossAmount: 500, withholdingTax: -15, bgTaxDue: 0, whtCredit: 0 },
            ],
            fxRates: {}, // Empty, but EUR should not require a rate check
        };
        const warnings = validate(state as AppState);
        expect(warnings.some(w => w.type === 'missing-fx')).toBe(false);
    });

    it('returns no warnings for empty state', () => {
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [],
            dividends: [],
            sales: [],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [],
            manualEntries: [],
            fxRates: {},
        };
        const warnings = validate(state);
        expect(warnings).toHaveLength(0);
    });
});
