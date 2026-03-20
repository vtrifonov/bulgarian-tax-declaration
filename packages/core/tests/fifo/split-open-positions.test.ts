import {
    describe,
    expect,
    it,
} from 'vitest';

import { splitOpenPositions } from '../../src/fifo/split-open-positions.js';
import type { IBOpenPosition } from '../../src/types/index.js';

const baseOpts = {
    broker: 'IB',
    countryMap: { AAPL: 'US', MSFT: 'US', GOOG: 'US' } as Record<string, string>,
    source: { type: 'IB', file: 'test.csv' },
    taxYear: 2025,
    symbolAliases: {} as Record<string, string>,
};

const mkPosition = (symbol: string, quantity: number, costPrice: number): IBOpenPosition => ({
    symbol,
    currency: 'USD',
    quantity,
    costPrice,
});

describe('splitOpenPositions — skipPreExisting with existingHoldings', () => {
    const positions: IBOpenPosition[] = [
        mkPosition('AAPL', 100, 150),
        mkPosition('MSFT', 50, 300),
        mkPosition('GOOG', 25, 2800),
    ];

    it('with skipPreExisting=false, all pre-existing positions are added', () => {
        const result = splitOpenPositions(positions, [], {
            ...baseOpts,
            skipPreExisting: false,
        });

        const symbols = result.map(h => h.symbol);

        expect(symbols).toContain('AAPL');
        expect(symbols).toContain('MSFT');
        expect(symbols).toContain('GOOG');
    });

    it('with skipPreExisting=true and NO existingHoldings, all are skipped (backward compat)', () => {
        const result = splitOpenPositions(positions, [], {
            ...baseOpts,
            skipPreExisting: true,
        });

        expect(result).toHaveLength(0);
    });

    it('with skipPreExisting=true and existingHoldings, skips only matching symbols+broker', () => {
        const result = splitOpenPositions(positions, [], {
            ...baseOpts,
            skipPreExisting: true,
            existingHoldings: [
                { symbol: 'AAPL', broker: 'IB' },
                { symbol: 'MSFT', broker: 'IB' },
            ],
        });

        // AAPL and MSFT exist for IB → skipped
        // GOOG does NOT exist for IB → added
        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('GOOG');
        expect(result[0].quantity).toBe(25);
    });

    it('does not skip symbols that exist for a different broker', () => {
        const result = splitOpenPositions(positions, [], {
            ...baseOpts,
            skipPreExisting: true,
            existingHoldings: [
                { symbol: 'AAPL', broker: 'Revolut' }, // different broker
                { symbol: 'MSFT', broker: 'IB' },
            ],
        });

        // AAPL exists for Revolut (not IB) → added
        // MSFT exists for IB → skipped
        // GOOG doesn't exist → added
        const symbols = result.map(h => h.symbol);

        expect(symbols).toContain('AAPL');
        expect(symbols).not.toContain('MSFT');
        expect(symbols).toContain('GOOG');
    });

    it('with empty existingHoldings array, all pre-existing are added', () => {
        const result = splitOpenPositions(positions, [], {
            ...baseOpts,
            skipPreExisting: true,
            existingHoldings: [],
        });

        // No existing holdings → none match → all are added
        expect(result).toHaveLength(3);
    });
});
