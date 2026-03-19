import {
    describe,
    expect,
    it,
} from 'vitest';

import { assembleSpb8 } from '../../src/spb8/assemble.js';
import type {
    AppState,
    Spb8PersonalData,
} from '../../src/types/index.js';

const baseState: AppState = {
    taxYear: 2025,
    baseCurrency: 'BGN',
    language: 'bg',
    holdings: [
        {
            id: '1',
            broker: 'Interactive Brokers',
            country: 'САЩ',
            symbol: 'AAPL',
            dateAcquired: '2024-06-15',
            quantity: 100,
            currency: 'USD',
            unitPrice: 150,
            isin: 'US0378331005',
        },
        {
            id: '2',
            broker: 'Interactive Brokers',
            country: 'САЩ',
            symbol: 'AAPL',
            dateAcquired: '2025-03-10',
            quantity: 50,
            currency: 'USD',
            unitPrice: 170,
            isin: 'US0378331005',
        },
        {
            id: '3',
            broker: 'Interactive Brokers',
            country: 'Ирландия',
            symbol: 'VWCE',
            dateAcquired: '2024-01-20',
            quantity: 30,
            currency: 'EUR',
            unitPrice: 100,
            isin: 'IE00BK5BQT80',
        },
    ],
    sales: [
        {
            id: 's1',
            broker: 'Interactive Brokers',
            country: 'САЩ',
            symbol: 'AAPL',
            dateAcquired: '2024-06-15',
            dateSold: '2025-09-01',
            quantity: 20,
            currency: 'USD',
            buyPrice: 150,
            sellPrice: 200,
            fxRateBuy: 0.56,
            fxRateSell: 0.55,
        },
    ],
    dividends: [],
    stockYield: [],
    brokerInterest: [],
    fxRates: { USD: { '2025-12-31': 0.55 }, EUR: { '2025-12-31': 1 / 1.95583 } },
    manualEntries: [],
    foreignAccounts: [
        {
            broker: 'Interactive Brokers',
            type: '03',
            maturity: 'L',
            country: 'IE',
            currency: 'EUR',
            amountStartOfYear: 200,
            amountEndOfYear: 373.51,
        },
        {
            broker: 'Interactive Brokers',
            type: '03',
            maturity: 'L',
            country: 'IE',
            currency: 'USD',
            amountStartOfYear: 9696.60,
            amountEndOfYear: 3358.57,
        },
    ],
};

const personalData: Spb8PersonalData = { name: 'Test Person', egn: '1234567890' };

describe('assembleSpb8', () => {
    const result = assembleSpb8(baseState, personalData, 'P');

    it('sets year and report type', () => {
        expect(result.year).toBe(2025);
        expect(result.reportType).toBe('P');
    });

    it('includes personal data', () => {
        expect(result.personalData.name).toBe('Test Person');
    });

    it('groups securities by ISIN', () => {
        // AAPL: 2 lots → 1 row with combined quantity
        const aapl = result.securities.find(s => s.isin === 'US0378331005');

        expect(aapl).toBeDefined();
        // End of year: 100 + 50 = 150 (both lots still held)
        expect(aapl!.quantityEndOfYear).toBe(150);
    });

    it('reconstructs start-of-year from trades', () => {
        const aapl = result.securities.find(s => s.isin === 'US0378331005');

        // End: 150, sold during year: 20, bought during year: 50 (lot id=2 acquired 2025-03-10)
        // Start = 150 + 20 - 50 = 120
        expect(aapl!.quantityStartOfYear).toBe(120);
    });

    it('uses previous year data when provided', () => {
        const withPrev = assembleSpb8(baseState, personalData, 'P', [
            { isin: 'US0378331005', currency: 'USD', quantityStartOfYear: 0, quantityEndOfYear: 100 },
        ]);
        const aapl = withPrev.securities.find(s => s.isin === 'US0378331005');

        expect(aapl!.quantityStartOfYear).toBe(100);
    });

    it('includes accounts grouped by country+currency+maturity', () => {
        expect(result.accounts).toHaveLength(2);
        const eur = result.accounts.find(a => a.currency === 'EUR');

        expect(eur!.amountEndOfYear).toBeCloseTo(373.51, 2);
    });

    it('computes threshold', () => {
        expect(typeof result.thresholdMet).toBe('boolean');
        expect(typeof result.totalBgn).toBe('number');
        expect(result.totalBgn).toBeGreaterThan(0);
    });
});
