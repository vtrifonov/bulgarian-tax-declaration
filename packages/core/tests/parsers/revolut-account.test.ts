import { readFileSync } from 'fs';
import { join } from 'path';

import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseRevolutAccountStatement } from '../../src/parsers/revolut-account.js';

const fixture = readFileSync(
    join(__dirname, '../fixtures/revolut-account-eur.csv'),
    'utf-8',
);

describe('parseRevolutAccountStatement', () => {
    const result = parseRevolutAccountStatement(fixture);

    it('detects currency', () => {
        expect(result.currency).toBe('EUR');
    });

    it('sets type to 03 (foreign account)', () => {
        expect(result.type).toBe('03');
    });

    it('sets country to LT (Revolut Bank UAB)', () => {
        expect(result.country).toBe('LT');
    });

    it('sets maturity to S (short-term)', () => {
        expect(result.maturity).toBe('S');
    });

    it('computes start-of-year balance', () => {
        // First Current+COMPLETED row: balance=47.37, amount=-2.99
        // Pre-transaction balance: 47.37 - (-2.99) = 50.36
        expect(result.amountStartOfYear).toBeCloseTo(50.36, 2);
    });

    it('computes end-of-year balance from last Current COMPLETED row', () => {
        // Last Current+COMPLETED row: balance=529.88
        expect(result.amountEndOfYear).toBeCloseTo(529.88, 2);
    });

    it('ignores Savings product rows', () => {
        // Savings row with -2000 should not affect result
        expect(result.amountEndOfYear).toBeCloseTo(529.88, 2);
    });

    it('ignores REVERTED rows', () => {
        // REVERTED row should not be the "last" row
        expect(result.amountEndOfYear).toBeCloseTo(529.88, 2);
    });
});
