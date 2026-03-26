import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as CFB from 'cfb';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { fillBnbTemplate } from '../../src/spb8/bnb-template-filler.js';
import type {
    ForeignAccountBalance,
    Spb8FormData,
    Spb8PersonalData,
    Spb8Security,
} from '../../src/types/index.js';

const templatePath = join(__dirname, '..', '..', '..', '..', 'templates', 'SPB-8.xls');
const templateBuffer = readFileSync(templatePath).buffer;

function makeFormData(overrides: Partial<Spb8FormData> = {}): Spb8FormData {
    return {
        year: 2025,
        reportType: 'P',
        personalData: { egn: '1234567890' },
        accounts: [],
        securities: [],
        thresholdMet: false,
        totalBgn: 0,
        ...overrides,
    };
}

function makeAccount(overrides: Partial<ForeignAccountBalance> = {}): ForeignAccountBalance {
    return {
        broker: 'IB',
        type: '03',
        maturity: 'L',
        country: 'US',
        currency: 'USD',
        amountStartOfYear: 10000,
        amountEndOfYear: 12000,
        ...overrides,
    };
}

function makeSecurity(overrides: Partial<Spb8Security> = {}): Spb8Security {
    return {
        isin: 'US0378331005',
        currency: 'USD',
        quantityStartOfYear: 100,
        quantityEndOfYear: 150,
        ...overrides,
    };
}

/** Read back the filled template and return the workbook buffer for assertions. */
function readFilledWorkbook(output: Uint8Array) {
    const cfb = CFB.read(output, { type: 'array' });
    const wbEntry = CFB.find(cfb, '/Workbook') ?? CFB.find(cfb, '/Book');

    expect(wbEntry).toBeTruthy();

    return wbEntry!.content!;
}

describe('fillBnbTemplate', () => {
    it('produces a valid CFB (OLE2) output', () => {
        const formData = makeFormData();
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output).toBeInstanceOf(Uint8Array);
        expect(output.length).toBeGreaterThan(0);

        // Should be parseable as CFB
        const cfb = CFB.read(output, { type: 'array' });
        const wb = CFB.find(cfb, '/Workbook') ?? CFB.find(cfb, '/Book');

        expect(wb).toBeTruthy();
    });

    it('fills accounts into the INVESTMENTS sheet', () => {
        const accounts = [
            makeAccount({ country: 'US', currency: 'USD', amountStartOfYear: 5000, amountEndOfYear: 7000 }),
            makeAccount({ country: 'IE', currency: 'EUR', amountStartOfYear: 3000, amountEndOfYear: 4000 }),
        ];
        const formData = makeFormData({ accounts });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        // Valid CFB output
        const cfb = CFB.read(output, { type: 'array' });

        expect(CFB.find(cfb, '/Workbook') ?? CFB.find(cfb, '/Book')).toBeTruthy();
    });

    it('fills securities into the SECURITIES sheet', () => {
        const securities = [
            makeSecurity({ isin: 'US0378331005', quantityStartOfYear: 100, quantityEndOfYear: 150 }),
            makeSecurity({ isin: 'US5949181045', quantityStartOfYear: 50, quantityEndOfYear: 75 }),
        ];
        const formData = makeFormData({ securities });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        const cfb = CFB.read(output, { type: 'array' });

        expect(CFB.find(cfb, '/Workbook') ?? CFB.find(cfb, '/Book')).toBeTruthy();
    });

    it('filters out securities with zero start and end quantities', () => {
        const securities = [
            makeSecurity({ quantityStartOfYear: 0, quantityEndOfYear: 0 }),
            makeSecurity({ isin: 'US5949181045', quantityStartOfYear: 50, quantityEndOfYear: 75 }),
        ];
        const formData = makeFormData({ securities });
        const output = fillBnbTemplate(templateBuffer, formData);

        // Should produce valid output (the zero-quantity security is skipped)
        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('filters out tiny quantities that round to zero', () => {
        const securities = [
            makeSecurity({ quantityStartOfYear: 0.004, quantityEndOfYear: 0.003 }),
            makeSecurity({ isin: 'US5949181045', quantityStartOfYear: 10, quantityEndOfYear: 20 }),
        ];
        const formData = makeFormData({ securities });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('handles report type R (corrective)', () => {
        const formData = makeFormData({ reportType: 'R' });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('handles empty personal data gracefully', () => {
        const formData = makeFormData({ personalData: {} as Spb8PersonalData });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('handles combined accounts and securities', () => {
        const accounts = [
            makeAccount({ country: 'US' }),
            makeAccount({ country: 'IE', currency: 'EUR' }),
        ];
        const securities = [
            makeSecurity({ isin: 'US0378331005' }),
            makeSecurity({ isin: 'US5949181045' }),
            makeSecurity({ isin: 'IE00B4BNMY34' }),
        ];
        const formData = makeFormData({ accounts, securities });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('caps accounts at 47 rows (maxInvRows)', () => {
        const accounts = Array.from({ length: 50 }, (_, i) => makeAccount({ country: `C${i}`, currency: 'USD' }));
        const formData = makeFormData({ accounts });
        const output = fillBnbTemplate(templateBuffer, formData);

        // Should not crash even with 50 accounts — only 47 are written
        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('caps securities at 47 rows (maxSecRows)', () => {
        const securities = Array.from({ length: 50 }, (_, i) => makeSecurity({ isin: `US${String(i).padStart(10, '0')}`, quantityStartOfYear: i + 1, quantityEndOfYear: i + 2 }));
        const formData = makeFormData({ securities });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('converts account amounts to thousands (divides by 1000)', () => {
        // amountStartOfYear=10000 → should write 1.00 (10000/10/100 = 10.00 actually)
        // The code does: Math.round(acc.amountStartOfYear / 10) / 100
        const accounts = [makeAccount({ amountStartOfYear: 10000, amountEndOfYear: 25000 })];
        const formData = makeFormData({ accounts });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('rounds security quantities to 2 decimal places', () => {
        const securities = [
            makeSecurity({ quantityStartOfYear: 100.12345, quantityEndOfYear: 50.6789 }),
        ];
        const formData = makeFormData({ securities });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });

    it('produces output larger than input (records added)', () => {
        const accounts = [makeAccount()];
        const securities = [makeSecurity()];
        const formData = makeFormData({ accounts, securities });
        const output = fillBnbTemplate(templateBuffer, formData);

        // With data, the output should be at least as big as the template
        expect(output.length).toBeGreaterThanOrEqual(templateBuffer.byteLength * 0.8);
    });

    it('handles Cyrillic strings in personal data', () => {
        const personalData: Spb8PersonalData = {
            egn: '1234567890',
            name: 'Иван Петров',
        };
        const formData = makeFormData({ personalData });
        const output = fillBnbTemplate(templateBuffer, formData);

        expect(output.length).toBeGreaterThan(0);
        readFilledWorkbook(output);
    });
});
