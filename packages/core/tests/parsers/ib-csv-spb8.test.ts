import { readFileSync } from 'fs';
import { join } from 'path';

import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseIBCsv } from '../../src/parsers/ib-csv.js';

const cashReportFixture = readFileSync(
    join(__dirname, '../fixtures/ib-cash-report.csv'),
    'utf-8',
);

const instrumentInfoFixture = readFileSync(
    join(__dirname, '../fixtures/ib-instrument-info.csv'),
    'utf-8',
);

describe('IB CSV — Cash Report parsing', () => {
    const result = parseIBCsv(cashReportFixture);

    it('extracts broker name from statement', () => {
        expect(result.brokerName).toBe('Interactive Brokers Ireland Limited');
    });

    it('extracts cash balances per currency', () => {
        expect(result.cashBalances).toBeDefined();
        expect(result.cashBalances).toHaveLength(2);
    });

    it('extracts EUR starting and ending cash', () => {
        const eur = result.cashBalances!.find(b => b.currency === 'EUR');

        expect(eur).toBeDefined();
        expect(eur!.amountStartOfYear).toBeCloseTo(200, 2);
        expect(eur!.amountEndOfYear).toBeCloseTo(373.51, 2);
    });

    it('extracts USD starting and ending cash', () => {
        const usd = result.cashBalances!.find(b => b.currency === 'USD');

        expect(usd).toBeDefined();
        expect(usd!.amountStartOfYear).toBeCloseTo(9696.60, 2);
        expect(usd!.amountEndOfYear).toBeCloseTo(3358.57, 2);
    });

    it('skips Base Currency Summary rows', () => {
        const summary = result.cashBalances!.find(b => b.currency === 'Base Currency Summary');

        expect(summary).toBeUndefined();
    });
});

describe('IB CSV — Financial Instrument Information parsing', () => {
    const result = parseIBCsv(instrumentInfoFixture);

    it('extracts ISIN map', () => {
        expect(result.isinMap).toBeDefined();
        expect(Object.keys(result.isinMap!).length).toBeGreaterThanOrEqual(4);
    });

    it('maps AAPL to correct ISIN', () => {
        expect(result.isinMap!['AAPL']).toBe('US0378331005');
    });

    it('maps ASML to correct ISIN', () => {
        expect(result.isinMap!['ASML']).toBe('NL0010273215');
    });

    it('handles comma-separated symbol aliases (ISPAd, ISPA)', () => {
        expect(
            result.isinMap!['ISPA'] ?? result.isinMap!['ISPAd'],
        ).toBe('DE000A0F5UH1');
    });

    it('maps ADR with correct ISIN', () => {
        expect(result.isinMap!['BABA']).toBe('US01609W1027');
    });
});
