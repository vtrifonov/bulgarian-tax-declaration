import {
    describe,
    expect,
    it,
} from 'vitest';

import { gapFillRates } from '../../src/fx/gap-fill.js';

describe('gapFillRates', () => {
    it('carries forward Friday rate to Saturday and Sunday', () => {
        const rates: Record<string, number> = {
            '2025-01-03': 1.0353, // Friday
            '2025-01-06': 1.0400, // Monday
        };
        const filled = gapFillRates(rates, '2025-01-03', '2025-01-06');

        expect(filled['2025-01-04']).toBe(1.0353); // Saturday
        expect(filled['2025-01-05']).toBe(1.0353); // Sunday
    });

    it('fills holiday gaps', () => {
        const rates: Record<string, number> = {
            '2025-12-24': 1.04,
            '2025-12-29': 1.05,
        };
        const filled = gapFillRates(rates, '2025-12-24', '2025-12-29');

        expect(filled['2025-12-25']).toBe(1.04);
        expect(filled['2025-12-26']).toBe(1.04);
        expect(filled['2025-12-27']).toBe(1.04);
        expect(filled['2025-12-28']).toBe(1.04);
    });

    it('returns existing rates unchanged', () => {
        const rates: Record<string, number> = {
            '2025-01-02': 1.0300,
            '2025-01-03': 1.0350,
        };
        const filled = gapFillRates(rates, '2025-01-02', '2025-01-03');

        expect(filled['2025-01-02']).toBe(1.0300);
        expect(filled['2025-01-03']).toBe(1.0350);
    });

    it('handles gap at end of range', () => {
        const rates: Record<string, number> = {
            '2025-01-02': 1.05,
        };
        const filled = gapFillRates(rates, '2025-01-02', '2025-01-04');

        expect(filled['2025-01-02']).toBe(1.05);
        expect(filled['2025-01-03']).toBe(1.05);
        expect(filled['2025-01-04']).toBe(1.05);
    });

    it('backfills before first known rate with earliest available rate', () => {
        const rates: Record<string, number> = {
            '2025-01-03': 1.0400,
        };
        const filled = gapFillRates(rates, '2025-01-01', '2025-01-03');

        expect(filled['2025-01-01']).toBe(1.0400);
        expect(filled['2025-01-02']).toBe(1.0400);
        expect(filled['2025-01-03']).toBe(1.0400);
    });
});
