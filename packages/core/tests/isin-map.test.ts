import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    resolveIsinSync,
    validateIsin,
} from '../src/isin-map.js';

describe('resolveIsinSync', () => {
    it('resolves known symbol', () => {
        expect(resolveIsinSync('AAPL')).toBe('US0378331005');
    });

    it('returns empty string for unknown symbol', () => {
        expect(resolveIsinSync('UNKNOWN_TICKER')).toBe('');
    });

    it('resolves ETF symbols', () => {
        expect(resolveIsinSync('CSPX')).toBe('IE00B5BMR087');
        expect(resolveIsinSync('SXR8')).toBe('IE00B5BMR087');
    });
});

describe('validateIsin', () => {
    it('accepts valid ISIN', () => {
        expect(validateIsin('US0378331005')).toBe(true);
    });

    it('rejects too short', () => {
        expect(validateIsin('US037833')).toBe(false);
    });

    it('rejects empty', () => {
        expect(validateIsin('')).toBe(false);
    });

    it('rejects lowercase', () => {
        expect(validateIsin('us0378331005')).toBe(false);
    });
});
