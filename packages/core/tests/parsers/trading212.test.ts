import { readFileSync } from 'fs';
import { join } from 'path';

import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseTrading212Csv } from '../../src/parsers/trading212.js';

const fixture = readFileSync(join(__dirname, '../fixtures/trading212-minimal.csv'), 'utf-8');

describe('parseTrading212Csv', () => {
    it('returns empty collections for empty input', () => {
        const result = parseTrading212Csv('');

        expect(result.trades).toHaveLength(0);
        expect(result.dividends).toHaveLength(0);
        expect(result.interest).toHaveLength(0);
        expect(result.isinMap).toEqual({});
        expect(result.cashAccountCurrencies).toEqual([]);
    });

    it('parses market buys and sells into trade rows', () => {
        const result = parseTrading212Csv(fixture);

        expect(result.trades).toHaveLength(3);
        expect(result.trades[0]).toMatchObject({
            symbol: 'AAPL',
            currency: 'USD',
            quantity: 2,
            price: 200,
            proceeds: 0,
            commission: 0,
            dateTime: '2025-01-03, 09:15:00',
        });
        expect(result.trades[2]).toMatchObject({
            symbol: 'AAPL',
            quantity: -1,
            price: 215,
            proceeds: 215,
            currency: 'USD',
        });
    });

    it('keeps sell proceeds in trade currency when statement total is in settlement currency', () => {
        const result = parseTrading212Csv(fixture);

        expect(result.trades[2]).toMatchObject({
            currency: 'USD',
            proceeds: 215,
        });
    });

    it('parses dividends using gross amount in source currency and positive withholding tax', () => {
        const result = parseTrading212Csv(fixture);

        expect(result.dividends).toHaveLength(2);
        expect(result.dividends[0]).toMatchObject({
            symbol: 'SAP',
            date: '2025-03-10',
            currency: 'USD',
            grossAmount: 7.5,
            withholdingTax: 1.13,
        });
        expect(result.dividends[1]).toMatchObject({
            symbol: 'AAPL',
            grossAmount: 0.25,
            withholdingTax: 0,
        });
    });

    it('parses cash interest and ignores deposits and withdrawals', () => {
        const result = parseTrading212Csv(fixture);

        expect(result.interest).toEqual([
            {
                date: '2025-01-02',
                currency: 'EUR',
                description: 'Interest on cash',
                amount: 0.52,
            },
        ]);
    });

    it('collects cash account currencies from cash rows for manual SPB-8 entry', () => {
        const result = parseTrading212Csv(fixture);

        expect(result.cashAccountCurrencies).toEqual(['EUR']);
    });

    it('extracts ISINs by ticker', () => {
        const result = parseTrading212Csv(fixture);

        expect(result.isinMap).toEqual({
            AAPL: 'US0378331005',
            SAP: 'DE0007164600',
        });
    });

    it('skips malformed rows without failing the whole parse', () => {
        const csv = `${fixture}\nMarket buy,2025-04-01 10:00:00,US0000000000,BAD,"Bad",,bad-id,NaN,12,USD,1,,,,USD,,,`;
        const result = parseTrading212Csv(csv);

        expect(result.trades).toHaveLength(3);
        expect(result.dividends).toHaveLength(2);
        expect(result.interest).toHaveLength(1);
    });
});
