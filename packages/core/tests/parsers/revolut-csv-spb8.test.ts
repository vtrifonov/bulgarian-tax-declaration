import { readFileSync } from 'fs';
import { join } from 'path';

import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseRevolutSavingsPositions } from '../../src/parsers/revolut-csv.js';

const fixture = readFileSync(
    join(__dirname, '../fixtures/revolut-savings-eur.csv'),
    'utf-8',
);

describe('parseRevolutSavingsPositions', () => {
    const result = parseRevolutSavingsPositions(fixture);

    it('extracts ISIN from description', () => {
        expect(result.isin).toBe('IE000AZVL3K0');
    });

    it('detects currency', () => {
        expect(result.currency).toBe('EUR');
    });

    it('computes net quantity from BUY/SELL', () => {
        // BUY: 11.07 + 200 + 500 = 711.07
        // SELL: 150
        // Net: 561.07
        expect(result.quantityEndOfYear).toBeCloseTo(561.07, 2);
    });

    it('returns 0 for start-of-year when no prior data', () => {
        // All transactions are within 2025, start-of-year is computed
        // from transactions before Jan 1 — none exist → 0
        expect(result.quantityStartOfYear).toBe(0);
    });
});
