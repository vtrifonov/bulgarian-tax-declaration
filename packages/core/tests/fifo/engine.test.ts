import {
    describe,
    expect,
    it,
} from 'vitest';
import { FifoEngine } from '../../src/fifo/engine.js';
import type {
    Holding,
    IBTrade,
    Sale,
} from '../../src/types/index.js';

describe('FifoEngine', () => {
    it('matches sells against oldest lots first', () => {
        const existingHoldings: Holding[] = [
            { id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL', dateAcquired: '2023-01-15', quantity: 20, currency: 'USD', unitPrice: 150.00 },
            { id: '2', broker: 'IB', country: 'САЩ', symbol: 'AAPL', dateAcquired: '2024-06-10', quantity: 30, currency: 'USD', unitPrice: 200.00 },
        ];
        const trades: IBTrade[] = [
            { currency: 'USD', symbol: 'AAPL', dateTime: '2025-09-15, 10:00:00', quantity: -25, price: 250.00, proceeds: 6250, commission: -1 },
        ];

        const engine = new FifoEngine(existingHoldings);
        const { holdings, sales } = engine.processTrades(trades, 'IB', { AAPL: 'САЩ' });

        expect(sales).toHaveLength(2); // Consumes all 20 from lot 1, then 5 from lot 2
        expect(sales[0].quantity).toBe(20);
        expect(sales[0].buyPrice).toBe(150.00);
        expect(sales[1].quantity).toBe(5);
        expect(sales[1].buyPrice).toBe(200.00);

        // Remaining holdings: lot 2 with 25 shares
        const aaplHoldings = holdings.filter(h => h.symbol === 'AAPL');
        expect(aaplHoldings).toHaveLength(1);
        expect(aaplHoldings[0].quantity).toBe(25);
    });

    it('handles partial lot consumption', () => {
        const holdings: Holding[] = [
            { id: '1', broker: 'IB', country: 'САЩ', symbol: 'MSFT', dateAcquired: '2024-01-01', quantity: 100, currency: 'USD', unitPrice: 300.00 },
        ];
        const trades: IBTrade[] = [
            { currency: 'USD', symbol: 'MSFT', dateTime: '2025-06-01, 10:00:00', quantity: -30, price: 400.00, proceeds: 12000, commission: -1 },
        ];

        const engine = new FifoEngine(holdings);
        const result = engine.processTrades(trades, 'IB', { MSFT: 'САЩ' });

        expect(result.sales).toHaveLength(1);
        expect(result.sales[0].quantity).toBe(30);
        expect(result.holdings.find(h => h.symbol === 'MSFT')?.quantity).toBe(70);
    });

    it('adds buys as new holdings', () => {
        const engine = new FifoEngine([]);
        const trades: IBTrade[] = [
            { currency: 'EUR', symbol: 'CSPX', dateTime: '2025-01-21, 10:26:07', quantity: 1, price: 614.28, proceeds: -614.28, commission: -1.25 },
        ];

        const result = engine.processTrades(trades, 'IB', { CSPX: 'Ирландия' });

        expect(result.holdings).toHaveLength(1);
        expect(result.holdings[0].symbol).toBe('CSPX');
        expect(result.holdings[0].unitPrice).toBe(614.28);
        expect(result.sales).toHaveLength(0);
    });

    it('sorts trades by datetime before processing (buy before sell on same day)', () => {
        const engine = new FifoEngine([]);
        const trades: IBTrade[] = [
            // Sell listed first in CSV, but buy happened earlier
            { currency: 'USD', symbol: 'TEST', dateTime: '2025-03-15, 14:00:00', quantity: -5, price: 110.00, proceeds: 550, commission: -1 },
            { currency: 'USD', symbol: 'TEST', dateTime: '2025-03-15, 09:00:00', quantity: 10, price: 100.00, proceeds: -1000, commission: -1 },
        ];

        const result = engine.processTrades(trades, 'IB', { TEST: 'САЩ' });

        expect(result.sales).toHaveLength(1);
        expect(result.sales[0].buyPrice).toBe(100.00);
        expect(result.holdings.find(h => h.symbol === 'TEST')?.quantity).toBe(5);
    });

    it('generates validation warning for sell without sufficient holdings', () => {
        const engine = new FifoEngine([]);
        const trades: IBTrade[] = [
            { currency: 'USD', symbol: 'GHOST', dateTime: '2025-06-01, 10:00:00', quantity: -10, price: 50.00, proceeds: 500, commission: -1 },
        ];

        const result = engine.processTrades(trades, 'IB', { GHOST: 'САЩ' });
        expect(result.warnings).toContainEqual(
            expect.objectContaining({ type: 'negative-holdings', message: expect.stringContaining('GHOST') }),
        );
    });

    it('handles multiple buys then multiple sells consuming across lots', () => {
        const existingHoldings: Holding[] = [
            { id: '1', broker: 'IB', country: 'САЩ', symbol: 'STOCK', dateAcquired: '2024-01-01', quantity: 10, currency: 'USD', unitPrice: 100.00 },
            { id: '2', broker: 'IB', country: 'САЩ', symbol: 'STOCK', dateAcquired: '2024-06-01', quantity: 15, currency: 'USD', unitPrice: 120.00 },
            { id: '3', broker: 'IB', country: 'САЩ', symbol: 'STOCK', dateAcquired: '2024-12-01', quantity: 20, currency: 'USD', unitPrice: 150.00 },
        ];
        const trades: IBTrade[] = [
            { currency: 'USD', symbol: 'STOCK', dateTime: '2025-03-01, 10:00:00', quantity: -25, price: 160.00, proceeds: 4000, commission: -1 },
            { currency: 'USD', symbol: 'STOCK', dateTime: '2025-06-01, 14:00:00', quantity: -10, price: 170.00, proceeds: 1700, commission: -1 },
        ];

        const engine = new FifoEngine(existingHoldings);
        const result = engine.processTrades(trades, 'IB', { STOCK: 'САЩ' });

        expect(result.sales).toHaveLength(3);
        expect(result.sales[0].quantity).toBe(10);
        expect(result.sales[0].buyPrice).toBe(100.00);
        expect(result.sales[1].quantity).toBe(15);
        expect(result.sales[1].buyPrice).toBe(120.00);
        expect(result.sales[2].quantity).toBe(10);
        expect(result.sales[2].buyPrice).toBe(150.00);

        // Remaining holdings
        const remaining = result.holdings.filter(h => h.symbol === 'STOCK');
        expect(remaining).toHaveLength(1);
        expect(remaining[0].quantity).toBe(10);
        expect(remaining[0].unitPrice).toBe(150.00);
    });

    it('sells entire position (all lots consumed, holdings empty for that symbol)', () => {
        const existingHoldings: Holding[] = [
            { id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL', dateAcquired: '2023-01-15', quantity: 20, currency: 'USD', unitPrice: 150.00 },
            { id: '2', broker: 'IB', country: 'САЩ', symbol: 'MSFT', dateAcquired: '2024-01-01', quantity: 30, currency: 'USD', unitPrice: 300.00 },
        ];
        const trades: IBTrade[] = [
            { currency: 'USD', symbol: 'AAPL', dateTime: '2025-09-15, 10:00:00', quantity: -20, price: 250.00, proceeds: 5000, commission: -1 },
        ];

        const engine = new FifoEngine(existingHoldings);
        const result = engine.processTrades(trades, 'IB', { AAPL: 'САЩ', MSFT: 'САЩ' });

        expect(result.sales).toHaveLength(1);
        expect(result.sales[0].quantity).toBe(20);

        // AAPL should be gone, MSFT should remain
        const aaplHoldings = result.holdings.filter(h => h.symbol === 'AAPL');
        expect(aaplHoldings).toHaveLength(0);
        const msftHoldings = result.holdings.filter(h => h.symbol === 'MSFT');
        expect(msftHoldings).toHaveLength(1);
        expect(msftHoldings[0].quantity).toBe(30);
    });

    it('preserves other symbols when selling one symbol', () => {
        const existingHoldings: Holding[] = [
            { id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL', dateAcquired: '2023-01-15', quantity: 20, currency: 'USD', unitPrice: 150.00 },
            { id: '2', broker: 'IB', country: 'САЩ', symbol: 'MSFT', dateAcquired: '2024-01-01', quantity: 30, currency: 'USD', unitPrice: 300.00 },
            { id: '3', broker: 'IB', country: 'САЩ', symbol: 'GOOGL', dateAcquired: '2024-06-01', quantity: 15, currency: 'USD', unitPrice: 2000.00 },
        ];
        const trades: IBTrade[] = [
            { currency: 'USD', symbol: 'MSFT', dateTime: '2025-06-01, 10:00:00', quantity: -15, price: 400.00, proceeds: 6000, commission: -1 },
        ];

        const engine = new FifoEngine(existingHoldings);
        const result = engine.processTrades(trades, 'IB', { AAPL: 'САЩ', MSFT: 'САЩ', GOOGL: 'САЩ' });

        // Only MSFT is sold
        expect(result.sales).toHaveLength(1);
        expect(result.sales[0].symbol).toBe('MSFT');

        // All three symbols should be in holdings (MSFT with reduced quantity)
        const allHoldings = result.holdings;
        const aaplHoldings = allHoldings.filter(h => h.symbol === 'AAPL');
        const msftHoldings = allHoldings.filter(h => h.symbol === 'MSFT');
        const googlHoldings = allHoldings.filter(h => h.symbol === 'GOOGL');

        expect(aaplHoldings).toHaveLength(1);
        expect(aaplHoldings[0].quantity).toBe(20);
        expect(msftHoldings).toHaveLength(1);
        expect(msftHoldings[0].quantity).toBe(15);
        expect(googlHoldings).toHaveLength(1);
        expect(googlHoldings[0].quantity).toBe(15);
    });

    it('handles multiple symbols interleaved in trades', () => {
        const engine = new FifoEngine([]);
        const trades: IBTrade[] = [
            { currency: 'USD', symbol: 'AAPL', dateTime: '2025-01-01, 10:00:00', quantity: 5, price: 100.00, proceeds: -500, commission: -1 },
            { currency: 'USD', symbol: 'MSFT', dateTime: '2025-01-02, 10:00:00', quantity: 3, price: 200.00, proceeds: -600, commission: -1 },
            { currency: 'USD', symbol: 'AAPL', dateTime: '2025-01-03, 10:00:00', quantity: -2, price: 120.00, proceeds: 240, commission: -1 },
            { currency: 'USD', symbol: 'MSFT', dateTime: '2025-01-04, 10:00:00', quantity: 2, price: 220.00, proceeds: -440, commission: -1 },
            { currency: 'USD', symbol: 'AAPL', dateTime: '2025-01-05, 10:00:00', quantity: -3, price: 130.00, proceeds: 390, commission: -1 },
        ];

        const result = engine.processTrades(trades, 'IB', { AAPL: 'САЩ', MSFT: 'САЩ' });

        // Should have 2 sales from AAPL, 0 sales from MSFT
        expect(result.sales).toHaveLength(2);
        expect(result.sales[0].symbol).toBe('AAPL');
        expect(result.sales[0].quantity).toBe(2);
        expect(result.sales[1].symbol).toBe('AAPL');
        expect(result.sales[1].quantity).toBe(3);

        // Holdings: AAPL with 0 left (5-2-3), MSFT with 5 across 2 lots (3 at 200, 2 at 220)
        const aaplHoldings = result.holdings.filter(h => h.symbol === 'AAPL');
        const msftHoldings = result.holdings.filter(h => h.symbol === 'MSFT');
        expect(aaplHoldings).toHaveLength(0);
        expect(msftHoldings).toHaveLength(2);
        const totalMsftQty = msftHoldings.reduce((sum, h) => sum + h.quantity, 0);
        expect(totalMsftQty).toBe(5);
    });
});
