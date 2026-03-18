import { readFileSync } from 'fs';
import { join } from 'path';

import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseRevolutCsv } from '../../src/parsers/revolut-csv.js';

const eurFixture = readFileSync(join(__dirname, '../fixtures/revolut-eur.csv'), 'utf-8');
const usdFixture = readFileSync(join(__dirname, '../fixtures/revolut-usd.csv'), 'utf-8');

describe('parseRevolutCsv', () => {
    it('parses EUR savings (5-column format)', () => {
        const result = parseRevolutCsv(eurFixture);

        expect(result.currency).toBe('EUR');
        // Should only have Interest PAID and Service Fee Charged — no BUY, no Reinvested
        const descriptions = result.entries.map(e => e.description);

        expect(descriptions.every(d => d === 'Interest PAID' || d === 'Service Fee Charged')).toBe(true);
    });

    it('excludes BUY/SELL/Reinvested rows', () => {
        const result = parseRevolutCsv(eurFixture);
        const buyRows = result.entries.filter(e => e.description.includes('BUY'));

        expect(buyRows).toHaveLength(0);
        const reinvested = result.entries.filter(e => e.description.includes('Reinvested'));

        expect(reinvested).toHaveLength(0);
    });

    it('parses USD savings (7-column format)', () => {
        const result = parseRevolutCsv(usdFixture);

        expect(result.currency).toBe('USD');
        expect(result.entries.length).toBeGreaterThan(0);
    });

    it('strips time from dates', () => {
        const result = parseRevolutCsv(eurFixture);

        for (const entry of result.entries) {
            expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('parses amounts correctly', () => {
        const result = parseRevolutCsv(eurFixture);
        const interest = result.entries.find(e => e.description === 'Interest PAID');

        expect(interest).toBeDefined();
        expect(interest!.amount).toBeCloseTo(0.2973);
        const fee = result.entries.find(e => e.description === 'Service Fee Charged');

        expect(fee!.amount).toBeLessThan(0);
    });

    it('empty CSV throws', () => {
        const emptyCSV = '';

        expect(() => parseRevolutCsv(emptyCSV)).toThrow('Empty CSV');
    });

    it('single row CSV works', () => {
        // Only header, no data
        const singleRowCSV = 'Date,Description,"Value, EUR",Price per share,Quantity of shares';
        const result = parseRevolutCsv(singleRowCSV);

        expect(result.currency).toBe('EUR');
        expect(result.entries).toHaveLength(0);
    });

    it('GBP 7-column format (same as USD)', () => {
        const gbpFixture = `Date,Description,"Value, GBP","Value, EUR",FX Rate,Price per share,Quantity of shares
"Jan 3, 2025, 2:42:40 AM",Service Fee Charged GBP Class IE000H9J0QX4,-0.0566,-0.0482,0.8518,,
"Jan 3, 2025, 2:42:40 AM",Interest PAID GBP Class R IE000H9J0QX4,0.1466,0.1249,0.8518,,
"Jan 2, 2025, 2:33:08 AM",BUY GBP Class R IE000H9J0QX4,-50.00,-42.59,0.8518,,50.00`;

        const result = parseRevolutCsv(gbpFixture);

        expect(result.currency).toBe('GBP');
        expect(result.entries.length).toBeGreaterThan(0);

        // Should only have Interest PAID and Service Fee Charged, not BUY
        const descriptions = result.entries.map(e => e.description);

        expect(descriptions.every(d => d === 'Interest PAID' || d === 'Service Fee Charged')).toBe(true);
        expect(descriptions).not.toContain('BUY');
    });
});
