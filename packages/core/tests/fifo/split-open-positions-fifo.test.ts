import {
    describe,
    expect,
    it,
} from 'vitest';

import { splitOpenPositions } from '../../src/fifo/split-open-positions.js';
import type {
    IBOpenPosition,
    Trade,
} from '../../src/types/index.js';

const baseOpts = {
    broker: 'IB',
    countryMap: { AAPL: 'US', MSFT: 'US' } as Record<string, string>,
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

const mkTrade = (symbol: string, dateTime: string, quantity: number, price: number): Trade => ({
    symbol,
    dateTime,
    quantity,
    price,
    proceeds: quantity < 0 ? Math.abs(quantity) * price : 0,
    commission: 0,
    currency: 'USD',
});

describe('splitOpenPositions — FIFO sell matching', () => {
    it('handles multiple buys with partial sell (covers lines 95-103)', () => {
        // 3 buys of 100 each, 150 sold → first buy fully consumed, second partially
        const trades: Trade[] = [
            mkTrade('AAPL', '2025-01-10', 100, 150),
            mkTrade('AAPL', '2025-02-10', 100, 160),
            mkTrade('AAPL', '2025-03-10', 100, 170),
            mkTrade('AAPL', '2025-03-15', -150, 180), // sell 150
        ];

        // Final position: 300 bought - 150 sold = 150 remaining. No pre-existing.
        const positions = [mkPosition('AAPL', 150, 165)]; // avg cost
        const result = splitOpenPositions(positions, trades, { ...baseOpts, skipPreExisting: false });

        // Pre-existing qty = 150 + 150 - 300 = 0, so no pre-existing lot
        // Surviving this-year buys: 150 shares
        // FIFO sells: first buy (100) fully consumed, second buy (50) consumed, 50 survives
        const quantities = result.map(h => h.quantity);
        const totalQty = quantities.reduce((s, q) => s + q, 0);

        expect(totalQty).toBe(150);
    });

    it('handles sell consuming earliest buys in FIFO order (lines 128-130)', () => {
        // 3 buys of 30 each = 90 total, sell 60 → FIFO consumes first two buys
        const trades: Trade[] = [
            mkTrade('AAPL', '2025-01-10', 30, 150),
            mkTrade('AAPL', '2025-02-10', 30, 160),
            mkTrade('AAPL', '2025-03-10', 30, 170),
            mkTrade('AAPL', '2025-03-20', -60, 180), // sell 60
        ];

        // No pre-existing: pos.quantity(30) + sellQty(60) - totalBought(90) = 0
        // sellsFromPreExisting = min(60, max(0, 0)) = 0
        // sellsFromThisYear = 60
        // survivedThisYearQty = 90 - 60 = 30
        const positions = [mkPosition('AAPL', 30, 170)];
        const result = splitOpenPositions(positions, trades, { ...baseOpts, skipPreExisting: false });

        // Only the third buy survives (30 shares @ 170)
        expect(result).toHaveLength(1);
        expect(result[0].quantity).toBe(30);
        expect(result[0].unitPrice).toBe(170);
        expect(result[0].dateAcquired).toBe('2025-03-10');
    });

    it('preserves individual buy lot dates', () => {
        const trades: Trade[] = [
            mkTrade('AAPL', '2025-01-10,10:30:00', 100, 150),
            mkTrade('AAPL', '2025-02-15,14:00:00', 50, 160),
        ];

        const positions = [mkPosition('AAPL', 150, 153.33)];
        const result = splitOpenPositions(positions, trades, { ...baseOpts, skipPreExisting: false });

        // No pre-existing (150 + 0 - 150 = 0)
        // Two individual lots
        expect(result).toHaveLength(2);
        expect(result[0].dateAcquired).toBe('2025-01-10');
        expect(result[0].quantity).toBe(100);
        expect(result[1].dateAcquired).toBe('2025-02-15');
        expect(result[1].quantity).toBe(50);
    });

    it('resolves symbol aliases', () => {
        const trades: Trade[] = [
            mkTrade('AAPL_OLD', '2025-02-01', 50, 150),
        ];

        const positions = [mkPosition('AAPL', 100, 140)];
        const result = splitOpenPositions(positions, trades, {
            ...baseOpts,
            skipPreExisting: false,
            symbolAliases: { AAPL_OLD: 'AAPL' },
        });

        // Pre-existing: 100 + 0 - 50 = 50
        // This year: 50
        const totalQty = result.reduce((s, h) => s + h.quantity, 0);

        expect(totalQty).toBe(100);
    });

    it('skips non-tax-year trades', () => {
        const trades: Trade[] = [
            mkTrade('AAPL', '2024-12-15', 100, 140), // Previous year — ignored
            mkTrade('AAPL', '2025-03-10', 50, 160), // This year
        ];

        const positions = [mkPosition('AAPL', 200, 145)];
        const result = splitOpenPositions(positions, trades, { ...baseOpts, skipPreExisting: false });

        // Only 50 bought this year (2024 trade ignored)
        // Pre-existing: 200 + 0 - 50 = 150
        const preExisting = result.find(h => h.dateAcquired === '');
        const thisYear = result.find(h => h.dateAcquired !== '');

        expect(preExisting?.quantity).toBe(150);
        expect(thisYear?.quantity).toBe(50);
    });

    it('handles no trades (entire position is pre-existing)', () => {
        const positions = [mkPosition('AAPL', 100, 150)];
        const result = splitOpenPositions(positions, [], { ...baseOpts, skipPreExisting: false });

        expect(result).toHaveLength(1);
        expect(result[0].quantity).toBe(100);
        expect(result[0].dateAcquired).toBe('');
        expect(result[0].unitPrice).toBe(150);
    });

    it('back-calculates pre-existing cost correctly', () => {
        // Position: 200 shares @ $140 avg = $28000 total cost
        // This year: bought 100 @ $160 = $16000
        // Pre-existing cost: $28000 - $16000 = $12000, so $120/share
        const trades: Trade[] = [
            mkTrade('AAPL', '2025-01-10', 100, 160),
        ];

        const positions = [mkPosition('AAPL', 200, 140)];
        const result = splitOpenPositions(positions, trades, { ...baseOpts, skipPreExisting: false });

        const preExisting = result.find(h => h.dateAcquired === '');

        expect(preExisting?.quantity).toBe(100);
        expect(preExisting?.unitPrice).toBeCloseTo(120, 2);
    });

    it('uses country map for holdings', () => {
        const positions = [mkPosition('AAPL', 50, 150)];
        const result = splitOpenPositions(positions, [], { ...baseOpts, skipPreExisting: false });

        expect(result[0].country).toBe('US');
    });

    it('falls back to empty string for unknown country', () => {
        const positions: IBOpenPosition[] = [{ symbol: 'UNKNOWN', currency: 'USD', quantity: 50, costPrice: 100 }];
        const result = splitOpenPositions(positions, [], { ...baseOpts, skipPreExisting: false });

        expect(result[0].country).toBe('');
    });
});
