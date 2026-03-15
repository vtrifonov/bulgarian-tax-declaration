import { describe, it, expect } from 'vitest';
import { FifoEngine } from '../../src/fifo/engine.js';
import type { Holding, Sale, IBTrade } from '../../src/types/index.js';

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
      expect.objectContaining({ type: 'negative-holdings', message: expect.stringContaining('GHOST') })
    );
  });
});
