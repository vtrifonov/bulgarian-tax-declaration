import {
    describe,
    expect,
    it,
} from 'vitest';
import { validate } from '../../src/validation/validator.js';
import type {
    AppState,
    Holding,
} from '../../src/types/index.js';

function makeState(holdings: Partial<Holding>[]): AppState {
    return {
        taxYear: 2025,
        baseCurrency: 'BGN',
        language: 'en',
        holdings: holdings.map((h, i) => ({
            id: `h${i}`,
            broker: 'IB',
            country: 'US',
            symbol: '',
            dateAcquired: '',
            quantity: 0,
            currency: 'USD',
            unitPrice: 0,
            ...h,
        })),
        sales: [],
        dividends: [],
        stockYield: [],
        ibInterest: [],
        revolutInterest: [],
        fxRates: {},
        manualEntries: [],
    };
}

describe('checkDuplicateHoldings', () => {
    it('flags holdings with same symbol, qty, date from different sources', () => {
        const warnings = validate(makeState([
            { symbol: 'AAPL', quantity: 100, dateAcquired: '2024-01-15', source: { type: 'Initial import' } },
            { symbol: 'AAPL', quantity: 100, dateAcquired: '2024-01-15', source: { type: 'IB' } },
        ]));
        const dupes = warnings.filter(w => w.type === 'duplicate-holding');
        expect(dupes).toHaveLength(2);
        expect(dupes[0].message).toContain('same date');
    });

    it('does NOT flag same symbol with different quantities', () => {
        const warnings = validate(makeState([
            { symbol: 'AAPL', quantity: 100, dateAcquired: '2024-01-15', source: { type: 'Initial import' } },
            { symbol: 'AAPL', quantity: 50, dateAcquired: '2024-01-15', source: { type: 'IB' } },
        ]));
        const dupes = warnings.filter(w => w.type === 'duplicate-holding');
        expect(dupes).toHaveLength(0);
    });

    it('flags when IB side has missing date (transfer case)', () => {
        const warnings = validate(makeState([
            { symbol: 'AAPL', quantity: 50, dateAcquired: '2024-06-10', unitPrice: 150, source: { type: 'Initial import' } },
            { symbol: 'AAPL', quantity: 50, dateAcquired: '', unitPrice: 0, source: { type: 'IB' } },
        ]));
        const dupes = warnings.filter(w => w.type === 'duplicate-holding');
        expect(dupes).toHaveLength(2);
        expect(dupes[0].message).toContain('missing date/price');
    });

    it('does NOT flag same source even with matching data', () => {
        const warnings = validate(makeState([
            { symbol: 'AAPL', quantity: 100, dateAcquired: '2024-01-15', source: { type: 'Manual' } },
            { symbol: 'AAPL', quantity: 100, dateAcquired: '2024-01-15', source: { type: 'Manual' } },
        ]));
        const dupes = warnings.filter(w => w.type === 'duplicate-holding');
        expect(dupes).toHaveLength(0);
    });

    it('does NOT flag different dates with both having complete data', () => {
        const warnings = validate(makeState([
            { symbol: 'AAPL', quantity: 100, dateAcquired: '2024-01-15', unitPrice: 150, source: { type: 'Initial import' } },
            { symbol: 'AAPL', quantity: 100, dateAcquired: '2024-06-20', unitPrice: 200, source: { type: 'IB' } },
        ]));
        const dupes = warnings.filter(w => w.type === 'duplicate-holding');
        expect(dupes).toHaveLength(0);
    });
});
