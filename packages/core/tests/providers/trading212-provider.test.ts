import { readFileSync } from 'fs';
import { join } from 'path';

import {
    describe,
    expect,
    it,
} from 'vitest';

import { trading212Provider } from '../../src/providers/trading212.js';
import { isTextHandler } from '../../src/providers/types.js';

const fixture = readFileSync(join(__dirname, '../fixtures/trading212-minimal.csv'), 'utf-8');

describe('Trading 212 provider', () => {
    const handler = trading212Provider.fileHandlers[0];

    if (!isTextHandler(handler)) {
        throw new Error('Expected text handler');
    }

    it('detects Trading 212 annual statement CSV by header', () => {
        expect(handler.detectFile(fixture, 'statement.csv')).toBe(true);
    });

    it('rejects unrelated CSV safely', () => {
        expect(handler.detectFile('Date,Amount\n2025-01-01,10', 'test.csv')).toBe(false);
        expect(handler.detectFile('', 'empty.csv')).toBe(false);
    });

    it('converts dividends to tax-ready rows and returns interest and trades', () => {
        const result = handler.parseFile(fixture);

        expect(result.trades).toHaveLength(3);
        expect(result.interest).toHaveLength(1);
        expect(result.dividends).toHaveLength(2);
        expect(result.isinMap).toEqual({
            AAPL: 'US0378331005',
            SAP: 'DE0007164600',
        });
        expect(result.dividends![0]).toMatchObject({
            symbol: 'SAP',
            grossAmount: 7.5,
            withholdingTax: 1.13,
            bgTaxDue: 0,
            whtCredit: 0.375,
        });
    });
});
