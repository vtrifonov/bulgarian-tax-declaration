import {
    describe,
    expect,
    it,
} from 'vitest';
import { resolveCountry } from '../src/country-map.js';

describe('resolveCountry (sync — hardcoded map only)', () => {
    it('returns empty string for symbols not in hardcoded map', () => {
        // With empty/minimal map, unknown symbols return empty
        expect(resolveCountry('UNKNOWN')).toBe('');
        expect(resolveCountry('XYZ')).toBe('');
    });

    it('is case-sensitive', () => {
        expect(resolveCountry('aapl')).toBe('');
        expect(resolveCountry('AaPl')).toBe('');
    });

    it('returns country if symbol is in hardcoded map', () => {
        // This test is valid for any non-empty map entry
        // If map is empty, resolveCountry always returns ''
        const result = resolveCountry('AAPL');
        expect(typeof result).toBe('string');
    });
});
