import {
    describe,
    expect,
    it,
} from 'vitest';

import { buildNraFormRows } from '../../src/nra/form-data.js';
import type { Dividend } from '../../src/types/index.js';

const mkDiv = (symbol: string, overrides?: Partial<Dividend>): Dividend => ({
    symbol,
    country: 'САЩ',
    date: '2025-06-15',
    currency: 'USD',
    grossAmount: 100,
    withholdingTax: 10,
    bgTaxDue: 0,
    whtCredit: 0,
    ...overrides,
});

const fxRates: Record<string, Record<string, number>> = {
    USD: { '2025-06-15': 1.80, '2025-03-10': 1.82 },
};

describe('buildNraFormRows', () => {
    it('transforms dividends into NRA form rows', () => {
        const rows = buildNraFormRows([mkDiv('AAPL')], fxRates, 'BGN');

        expect(rows).toHaveLength(1);
        expect(rows[0].rowLabel).toBe('1.1');
        expect(rows[0].name).toBe('AAPL');
        expect(rows[0].country).toBe('САЩ');
        expect(rows[0].incomeCode).toBe(8141);
        expect(rows[0].methodCode).toBe(1);
        expect(rows[0].acquisitionCost).toBe(0);
        expect(rows[0].difference).toBe(0);
        // grossAmount=100 USD, USD rate=1.80, EUR rate=1.95583 (fixed)
        // 100 USD = 100/1.80 * 1.95583 = 108.657 BGN
        expect(rows[0].grossAmount).toBeCloseTo(108.66, 1);
        // wht=10 USD, same conversion = 10.866 BGN
        expect(rows[0].foreignTax).toBeCloseTo(10.87, 1);
        // 5% of 108.657 = 5.433 BGN
        expect(rows[0].allowedCredit).toBeCloseTo(5.43, 1);
        // min(10.866, 5.433) = 5.433 BGN
        expect(rows[0].recognizedCredit).toBeCloseTo(5.43, 1);
        // max(0, 5.433 - 10.866) = 0 BGN
        expect(rows[0].taxDue).toBeCloseTo(0, 1);
    });

    it('filters out dividends with zero or negative grossAmount', () => {
        const divs = [mkDiv('AAPL'), mkDiv('BAD', { grossAmount: 0 }), mkDiv('UGLY', { grossAmount: -5 })];
        const rows = buildNraFormRows(divs, fxRates, 'BGN');

        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('AAPL');
    });

    it('filters out dividends with empty symbol', () => {
        const rows = buildNraFormRows([mkDiv('')], fxRates, 'BGN');

        expect(rows).toHaveLength(0);
    });

    it('sorts by symbol then date', () => {
        const divs = [
            mkDiv('MSFT', { date: '2025-06-15' }),
            mkDiv('AAPL', { date: '2025-06-15' }),
            mkDiv('AAPL', { date: '2025-03-10' }),
        ];
        const rows = buildNraFormRows(divs, fxRates, 'BGN');

        expect(rows.map(r => r.name)).toEqual(['AAPL', 'AAPL', 'MSFT']);
        expect(rows.map(r => r.rowLabel)).toEqual(['1.1', '2.1', '3.1']);
    });

    it('returns empty array for empty dividends', () => {
        expect(buildNraFormRows([], fxRates, 'BGN')).toEqual([]);
    });

    it('handles Irish ETF with 0% WHT (full tax due)', () => {
        const divs = [mkDiv('CSPX', { country: 'Ирландия', withholdingTax: 0 })];
        const rows = buildNraFormRows(divs, fxRates, 'BGN');

        // 5% of gross, no WHT credit
        expect(rows[0].taxDue).toBeCloseTo(rows[0].allowedCredit, 2);
        expect(rows[0].recognizedCredit).toBe(0);
    });

    it('assigns continuous row labels for multiple dividends of same symbol', () => {
        const divs = [
            mkDiv('AAPL', { date: '2025-03-10' }),
            mkDiv('AAPL', { date: '2025-06-15' }),
            mkDiv('AAPL', { date: '2025-06-15', grossAmount: 50 }),
        ];
        const rows = buildNraFormRows(divs, fxRates, 'BGN');

        expect(rows).toHaveLength(3);
        expect(rows.map(r => r.rowLabel)).toEqual(['1.1', '2.1', '3.1']);
        // All same symbol
        expect(rows.every(r => r.name === 'AAPL')).toBe(true);
    });
});
