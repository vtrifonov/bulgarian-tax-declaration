import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseRevolutInvestmentsCsv } from '../../src/parsers/revolut-investments.js';

const header = 'Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate';

function csv(...rows: string[]): string {
    return [header, ...rows].join('\n');
}

describe('parseRevolutInvestmentsCsv', () => {
    it('returns empty for header-only CSV', () => {
        const result = parseRevolutInvestmentsCsv(header);

        expect(result.trades).toHaveLength(0);
        expect(result.holdings).toHaveLength(0);
    });

    it('returns empty for empty string', () => {
        const result = parseRevolutInvestmentsCsv('');

        expect(result.trades).toHaveLength(0);
        expect(result.holdings).toHaveLength(0);
    });

    it('skips promo and top-up rows (no ticker)', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-15T08:00:00Z,,STOCKS PROMOTION REWARD,,,USD 6,USD,1.08',
            '2025-01-15T09:00:00Z,,CASH TOP-UP,,,USD 100,USD,1.08',
        ));

        expect(result.trades).toHaveLength(0);
        expect(result.holdings).toHaveLength(0);
    });

    it('parses single BUY trade into holding', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-15T14:30:00Z,AAPL,BUY - MARKET,10,USD 150.00,USD 1500.00,USD,1.08',
        ));

        expect(result.trades).toHaveLength(1);
        expect(result.trades[0].ticker).toBe('AAPL');
        expect(result.trades[0].quantity).toBe(10);
        expect(result.trades[0].pricePerShare).toBe(150);
        expect(result.trades[0].totalAmount).toBe(1500);

        expect(result.holdings).toHaveLength(1);
        expect(result.holdings[0].symbol).toBe('AAPL');
        expect(result.holdings[0].quantity).toBe(10);
        expect(result.holdings[0].unitPrice).toBe(150);
        expect(result.holdings[0].currency).toBe('USD');
        expect(result.holdings[0].dateAcquired).toBe('2025-01-15');
    });

    it('aggregates multiple BUY trades by ticker with weighted average', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-10T14:30:00Z,AAPL,BUY - MARKET,10,USD 100.00,USD 1000.00,USD,1.08',
            '2025-01-20T14:30:00Z,AAPL,BUY - MARKET,5,USD 200.00,USD 1000.00,USD,1.08',
        ));

        expect(result.holdings).toHaveLength(1);
        const h = result.holdings[0];

        expect(h.symbol).toBe('AAPL');
        expect(h.quantity).toBe(15);
        // Weighted avg: (1000 + 1000) / 15 = 133.33
        expect(h.unitPrice).toBeCloseTo(133.33, 1);
        expect(h.dateAcquired).toBe('2025-01-10'); // earliest date
    });

    it('subtracts SELL quantities using proportional cost reduction', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-10T14:30:00Z,AAPL,BUY - MARKET,10,USD 100.00,USD 1000.00,USD,1.08',
            '2025-01-20T14:30:00Z,AAPL,BUY - MARKET,10,USD 200.00,USD 2000.00,USD,1.08',
            '2025-02-01T14:30:00Z,AAPL,SELL - MARKET,5,USD 250.00,USD 1250.00,USD,1.08',
        ));

        expect(result.holdings).toHaveLength(1);
        const h = result.holdings[0];

        expect(h.quantity).toBe(15); // 20 - 5
        // Avg cost was (1000+2000)/20 = 150, remaining cost = 15 * 150 = 2250
        expect(h.unitPrice).toBeCloseTo(150, 1);
    });

    it('removes holding entirely when all shares sold', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-10T14:30:00Z,AAPL,BUY - MARKET,10,USD 100.00,USD 1000.00,USD,1.08',
            '2025-02-01T14:30:00Z,AAPL,SELL - MARKET,10,USD 150.00,USD 1500.00,USD,1.08',
        ));

        expect(result.holdings).toHaveLength(0);
    });

    it('handles fractional share quantities', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-15T14:30:00Z,GOOG,BUY - MARKET,0.00623014,USD 321.02,USD 2,USD,1.08',
        ));

        expect(result.holdings).toHaveLength(1);
        expect(result.holdings[0].quantity).toBeCloseTo(0.00623014, 8);
        expect(result.holdings[0].unitPrice).toBeCloseTo(321.02, 2);
    });

    it('parses currency-prefixed amounts correctly', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-15T14:30:00Z,MSFT,BUY - MARKET,1,USD 321.02,USD 321.02,USD,1.08',
        ));

        expect(result.trades[0].pricePerShare).toBe(321.02);
        expect(result.trades[0].totalAmount).toBe(321.02);
    });

    it('handles multiple tickers independently', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-10T14:30:00Z,AAPL,BUY - MARKET,10,USD 150.00,USD 1500.00,USD,1.08',
            '2025-01-10T14:30:00Z,GOOG,BUY - MARKET,5,USD 100.00,USD 500.00,USD,1.08',
            '2025-02-01T14:30:00Z,AAPL,SELL - MARKET,3,USD 160.00,USD 480.00,USD,1.08',
        ));

        expect(result.holdings).toHaveLength(2);
        const aapl = result.holdings.find(h => h.symbol === 'AAPL')!;
        const goog = result.holdings.find(h => h.symbol === 'GOOG')!;

        expect(aapl.quantity).toBe(7);
        expect(goog.quantity).toBe(5);
    });

    it('sets country from sync resolveCountry (may be empty if not in map)', () => {
        const result = parseRevolutInvestmentsCsv(csv(
            '2025-01-15T14:30:00Z,AAPL,BUY - MARKET,1,USD 150.00,USD 150.00,USD,1.08',
        ));

        // Country resolved async later via OpenFIGI; sync may return empty
        expect(typeof result.holdings[0].country).toBe('string');
    });
});
