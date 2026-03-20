import { readFileSync } from 'fs';
import { join } from 'path';

import { PDFParse } from 'pdf-parse';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseEtradePdf } from '../../src/parsers/etrade-pdf.js';
import { etradeProvider } from '../../src/providers/etrade.js';
import { isBinaryHandler } from '../../src/providers/types.js';
import type {
    Dividend,
    InterestEntry,
} from '../../src/types/index.js';

const SAMPLES = join(import.meta.dirname, '../../../../samples');

const QUARTER_FILES = [
    'ClientStatements_9999_033125.pdf',
    'ClientStatements_9999_063025.pdf',
    'ClientStatements_9999_093025.pdf',
    'ClientStatements_9999_123125.pdf',
];

const MERGED_FILE = 'ClientStatements_9999_2025.pdf';

async function extractPdfText(filename: string): Promise<string> {
    const buf = readFileSync(join(SAMPLES, filename));
    const parser = new PDFParse({ data: new Uint8Array(buf) });

    await parser.load();
    const result = await parser.getText();

    return result.pages.map((p: { text: string }) => p.text).join('\n');
}

// === Expected values (shared between quarterly and merged tests) ===

const EXPECTED_START_OF_YEAR_CASH = 5812.30;
const EXPECTED_END_OF_YEAR_CASH = 6633.54;
const EXPECTED_INTEREST_ENTRIES = [
    { date: '2025-01-02', amount: 20.12 },
    { date: '2025-02-03', amount: 19.45 },
    { date: '2025-03-03', amount: 18.77 },
    { date: '2025-04-01', amount: 16.30 },
    { date: '2025-05-01', amount: 16.10 },
    { date: '2025-06-02', amount: 16.40 },
    { date: '2025-07-01', amount: 15.90 },
    { date: '2025-08-01', amount: 15.80 },
    { date: '2025-09-02', amount: 15.70 },
    { date: '2025-10-01', amount: 15.40 },
    { date: '2025-11-03', amount: 15.20 },
    { date: '2025-12-01', amount: 15.10 },
];
const EXPECTED_TOTAL_INTEREST = EXPECTED_INTEREST_ENTRIES.reduce((sum, e) => sum + e.amount, 0);
const EXPECTED_DIVIDENDS = [
    { date: '2025-03-15', symbol: 'AAPL', grossAmount: 172.50, withholdingTax: 17.25 },
    { date: '2025-06-15', symbol: 'AAPL', grossAmount: 172.50, withholdingTax: 17.25 },
    { date: '2025-09-15', symbol: 'AAPL', grossAmount: 172.50, withholdingTax: 17.25 },
    { date: '2025-12-15', symbol: 'AAPL', grossAmount: 172.50, withholdingTax: 17.25 },
];

// === Quarterly PDF tests ===

describe('E*TRADE quarterly PDFs', () => {
    describe('Q1 statement', () => {
        it('parses holdings, interest, dividends, and cash balance', async () => {
            const text = await extractPdfText(QUARTER_FILES[0]);
            const result = parseEtradePdf(text);

            // Holdings
            expect(result.openPositions).toHaveLength(1);
            expect(result.openPositions![0].symbol).toBe('AAPL');
            expect(result.openPositions![0].quantity).toBe(1150);
            expect(result.openPositions![0].currency).toBe('USD');
            expect(result.openPositions![0].costPrice).toBeCloseTo(21.40, 1);

            // Interest (3 MMF entries)
            expect(result.interest).toHaveLength(3);
            expect(result.interest![0]).toMatchObject(EXPECTED_INTEREST_ENTRIES[0]);
            expect(result.interest![1]).toMatchObject(EXPECTED_INTEREST_ENTRIES[1]);
            expect(result.interest![2]).toMatchObject(EXPECTED_INTEREST_ENTRIES[2]);

            // Dividends (1 equity dividend with WHT)
            expect(result.dividends).toHaveLength(1);
            expect(result.dividends![0]).toMatchObject(EXPECTED_DIVIDENDS[0]);

            // Cash balance
            expect(result.foreignAccounts).toHaveLength(1);
            expect(result.foreignAccounts![0].broker).toBe('E*TRADE');
            expect(result.foreignAccounts![0].type).toBe('03');
            expect(result.foreignAccounts![0].country).toBe('US');
            expect(result.foreignAccounts![0].amountStartOfYear).toBe(EXPECTED_START_OF_YEAR_CASH);
            expect(result.foreignAccounts![0].amountEndOfYear).toBe(6025.89);
        });
    });

    describe('Q4 statement', () => {
        it('parses holdings, interest, dividends, and cash balance', async () => {
            const text = await extractPdfText(QUARTER_FILES[3]);
            const result = parseEtradePdf(text);

            expect(result.openPositions).toHaveLength(1);
            expect(result.openPositions![0].symbol).toBe('AAPL');

            // Interest (3 entries)
            expect(result.interest).toHaveLength(3);
            expect(result.interest![0]).toMatchObject(EXPECTED_INTEREST_ENTRIES[9]);
            expect(result.interest![1]).toMatchObject(EXPECTED_INTEREST_ENTRIES[10]);
            expect(result.interest![2]).toMatchObject(EXPECTED_INTEREST_ENTRIES[11]);

            // Dividends (1 equity dividend with WHT)
            expect(result.dividends).toHaveLength(1);
            expect(result.dividends![0]).toMatchObject(EXPECTED_DIVIDENDS[3]);

            // Cash balance
            expect(result.foreignAccounts![0].amountStartOfYear).toBe(6432.59);
            expect(result.foreignAccounts![0].amountEndOfYear).toBe(EXPECTED_END_OF_YEAR_CASH);
        });
    });

    describe('All 4 quarters combined', () => {
        it('extracts 12 interest entries and 4 dividends across all quarters', async () => {
            const allInterest: InterestEntry[] = [];
            const allDividends: Dividend[] = [];

            for (const file of QUARTER_FILES) {
                const text = await extractPdfText(file);
                const result = parseEtradePdf(text);

                expect(result.interest).toHaveLength(3);
                allInterest.push(...result.interest!);
                expect(result.dividends).toHaveLength(1);
                allDividends.push(...result.dividends!);
            }

            expect(allInterest).toHaveLength(12);
            expect(allDividends).toHaveLength(4);

            // All 12 months of interest
            const months = allInterest.map(e => e.date.slice(5, 7));

            expect(months).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);

            // 4 quarterly dividends
            const divDates = allDividends.map(d => d.date);

            expect(divDates).toEqual(['2025-03-15', '2025-06-15', '2025-09-15', '2025-12-15']);
        });

        it('Q1 start-of-year and Q4 end-of-year cash match expected values', async () => {
            const q1 = parseEtradePdf(await extractPdfText(QUARTER_FILES[0]));
            const q4 = parseEtradePdf(await extractPdfText(QUARTER_FILES[3]));

            expect(q1.foreignAccounts![0].amountStartOfYear).toBe(EXPECTED_START_OF_YEAR_CASH);
            expect(q4.foreignAccounts![0].amountEndOfYear).toBe(EXPECTED_END_OF_YEAR_CASH);
        });

        it('quarter-to-quarter cash balances are continuous', async () => {
            const q1 = parseEtradePdf(await extractPdfText(QUARTER_FILES[0]));
            const q2 = parseEtradePdf(await extractPdfText(QUARTER_FILES[1]));
            const q3 = parseEtradePdf(await extractPdfText(QUARTER_FILES[2]));
            const q4 = parseEtradePdf(await extractPdfText(QUARTER_FILES[3]));

            expect(q1.foreignAccounts![0].amountEndOfYear).toBe(q2.foreignAccounts![0].amountStartOfYear);
            expect(q2.foreignAccounts![0].amountEndOfYear).toBe(q3.foreignAccounts![0].amountStartOfYear);
            expect(q3.foreignAccounts![0].amountEndOfYear).toBe(q4.foreignAccounts![0].amountStartOfYear);
        });

        it('total interest and dividends across all quarters sum correctly', async () => {
            let totalInterest = 0;
            let totalDividends = 0;

            for (const file of QUARTER_FILES) {
                const result = parseEtradePdf(await extractPdfText(file));

                for (const entry of result.interest!) {
                    totalInterest += entry.amount;
                }

                for (const div of result.dividends!) {
                    totalDividends += div.grossAmount;
                }
            }

            expect(totalInterest).toBeCloseTo(EXPECTED_TOTAL_INTEREST, 2);
            expect(totalDividends).toBeCloseTo(172.50 * 4, 2);
        });
    });
});

// === Merged (annual) PDF tests ===

describe('E*TRADE merged annual PDF', () => {
    it('parses all data from single merged PDF', async () => {
        const text = await extractPdfText(MERGED_FILE);
        const result = parseEtradePdf(text);

        // Holdings: deduplicated to 1 entry
        expect(result.openPositions).toHaveLength(1);
        expect(result.openPositions![0].symbol).toBe('AAPL');
        expect(result.openPositions![0].quantity).toBe(1150);

        // Interest: all 12 entries
        expect(result.interest).toHaveLength(12);

        // Dividends: all 4 quarterly dividends
        expect(result.dividends).toHaveLength(4);

        for (const div of result.dividends!) {
            expect(div.symbol).toBe('AAPL');
            expect(div.grossAmount).toBe(172.50);
            expect(div.withholdingTax).toBe(17.25);
        }

        // Cash: start of year from Q1, end of year from Q4
        expect(result.foreignAccounts).toHaveLength(1);
        expect(result.foreignAccounts![0].amountStartOfYear).toBe(EXPECTED_START_OF_YEAR_CASH);
        expect(result.foreignAccounts![0].amountEndOfYear).toBe(EXPECTED_END_OF_YEAR_CASH);
    });

    it('interest and dividends match quarterly imports exactly', async () => {
        const mergedResult = parseEtradePdf(await extractPdfText(MERGED_FILE));

        // Collect all quarterly data
        const quarterlyInterest: InterestEntry[] = [];
        const quarterlyDividends: Dividend[] = [];

        for (const file of QUARTER_FILES) {
            const result = parseEtradePdf(await extractPdfText(file));

            quarterlyInterest.push(...result.interest!);
            quarterlyDividends.push(...result.dividends!);
        }

        // Interest: same count and values
        expect(mergedResult.interest).toHaveLength(quarterlyInterest.length);

        for (let i = 0; i < quarterlyInterest.length; i++) {
            expect(mergedResult.interest![i].date).toBe(quarterlyInterest[i].date);
            expect(mergedResult.interest![i].amount).toBe(quarterlyInterest[i].amount);
        }

        // Dividends: same count and values
        expect(mergedResult.dividends).toHaveLength(quarterlyDividends.length);

        for (let i = 0; i < quarterlyDividends.length; i++) {
            expect(mergedResult.dividends![i].date).toBe(quarterlyDividends[i].date);
            expect(mergedResult.dividends![i].grossAmount).toBe(quarterlyDividends[i].grossAmount);
            expect(mergedResult.dividends![i].withholdingTax).toBe(quarterlyDividends[i].withholdingTax);
        }
    });

    it('cash balance matches quarterly Q1 start and Q4 end', async () => {
        const merged = parseEtradePdf(await extractPdfText(MERGED_FILE));
        const q1 = parseEtradePdf(await extractPdfText(QUARTER_FILES[0]));
        const q4 = parseEtradePdf(await extractPdfText(QUARTER_FILES[3]));

        expect(merged.foreignAccounts![0].amountStartOfYear).toBe(q1.foreignAccounts![0].amountStartOfYear);
        expect(merged.foreignAccounts![0].amountEndOfYear).toBe(q4.foreignAccounts![0].amountEndOfYear);
    });
});

// === Provider handler test ===

describe('E*TRADE provider parseBinary', () => {
    it('extracts data from PDF binary via provider handler', async () => {
        const buf = readFileSync(join(SAMPLES, QUARTER_FILES[0]));
        const handler = etradeProvider.fileHandlers[0];

        expect(isBinaryHandler(handler)).toBe(true);

        if (!isBinaryHandler(handler)) {
            return;
        }

        const result = await handler.parseBinary(buf.buffer);

        expect(result.openPositions).toHaveLength(1);
        expect(result.openPositions![0].symbol).toBe('AAPL');
        expect(result.interest).toHaveLength(3);
        expect(result.dividends).toHaveLength(1);
        expect(result.dividends![0].grossAmount).toBe(172.50);
        expect(result.dividends![0].withholdingTax).toBe(17.25);
        expect(result.foreignAccounts).toHaveLength(1);
    });
});
