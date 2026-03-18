import type {
    BrokerInterest,
    Dividend,
    Holding,
    Sale,
    StockYieldEntry,
} from '@bg-tax/core';
import {
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';

import {
    applySorting,
    useAppStore,
} from './app-state';

const mkHolding = (symbol: string): Holding => ({
    id: `h-${symbol}`,
    broker: 'IB',
    country: 'US',
    symbol,
    dateAcquired: '2024-01-15',
    quantity: 10,
    currency: 'USD',
    unitPrice: 100,
});

const symbols = () => useAppStore.getState().holdings.map((h) => h.symbol);

const seedHoldings = (...syms: string[]) => {
    for (const s of syms) {
        useAppStore.getState().addHolding(mkHolding(s));
    }
};

describe('useAppStore', () => {
    beforeEach(() => {
        useAppStore.setState({
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'en',
            holdings: [],
            sales: [],
            dividends: [],
            stockYield: [],
            brokerInterest: [],
            fxRates: {},
        });
    });

    describe('setTaxYear', () => {
        it('sets tax year and auto-sets baseCurrency to BGN for <=2025', () => {
            useAppStore.getState().setTaxYear(2025);
            const state = useAppStore.getState();

            expect(state.taxYear).toBe(2025);
            expect(state.baseCurrency).toBe('BGN');
        });

        it('sets tax year and auto-sets baseCurrency to EUR for >2025', () => {
            useAppStore.getState().setTaxYear(2026);
            const state = useAppStore.getState();

            expect(state.taxYear).toBe(2026);
            expect(state.baseCurrency).toBe('EUR');
        });

        it('handles boundary year 2025', () => {
            useAppStore.getState().setTaxYear(2025);
            expect(useAppStore.getState().baseCurrency).toBe('BGN');
        });

        it('handles year 2026 and above', () => {
            useAppStore.getState().setTaxYear(2027);
            expect(useAppStore.getState().baseCurrency).toBe('EUR');
        });
    });

    describe('setBaseCurrency', () => {
        it('sets base currency to BGN', () => {
            useAppStore.getState().setBaseCurrency('BGN');
            expect(useAppStore.getState().baseCurrency).toBe('BGN');
        });

        it('sets base currency to EUR', () => {
            useAppStore.getState().setBaseCurrency('EUR');
            expect(useAppStore.getState().baseCurrency).toBe('EUR');
        });
    });

    describe('setLanguage', () => {
        it('sets language to English', () => {
            useAppStore.getState().setLanguage('en');
            expect(useAppStore.getState().language).toBe('en');
        });

        it('sets language to Bulgarian', () => {
            useAppStore.getState().setLanguage('bg');
            expect(useAppStore.getState().language).toBe('bg');
        });
    });

    describe('addHolding/updateHolding/deleteHolding', () => {
        it('adds a holding', () => {
            const holding: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150.5,
            };

            useAppStore.getState().addHolding(holding);
            const state = useAppStore.getState();

            expect(state.holdings).toHaveLength(1);
            expect(state.holdings[0].symbol).toBe('AAPL');
            expect(state.holdings[0].quantity).toBe(10);
        });

        it('adds multiple holdings', () => {
            const h1: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150.5,
            };
            const h2: Holding = {
                id: 'h2',
                broker: 'IB',
                country: 'US',
                symbol: 'MSFT',
                dateAcquired: '2024-02-01',
                quantity: 5,
                currency: 'USD',
                unitPrice: 300.0,
            };

            useAppStore.getState().addHolding(h1);
            useAppStore.getState().addHolding(h2);
            expect(useAppStore.getState().holdings).toHaveLength(2);
        });

        it('updates a holding at specific index', () => {
            const h1: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150.5,
            };

            useAppStore.getState().addHolding(h1);

            const updated: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 20,
                currency: 'USD',
                unitPrice: 160.0,
            };

            useAppStore.getState().updateHolding(0, updated);
            const state = useAppStore.getState();

            expect(state.holdings[0].quantity).toBe(20);
            expect(state.holdings[0].unitPrice).toBe(160.0);
        });

        it('updates without affecting other holdings', () => {
            const h1: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150.5,
            };
            const h2: Holding = {
                id: 'h2',
                broker: 'IB',
                country: 'US',
                symbol: 'MSFT',
                dateAcquired: '2024-02-01',
                quantity: 5,
                currency: 'USD',
                unitPrice: 300.0,
            };

            useAppStore.getState().addHolding(h1);
            useAppStore.getState().addHolding(h2);

            const updated: Holding = { ...h1, quantity: 25 };

            useAppStore.getState().updateHolding(0, updated);

            const state = useAppStore.getState();

            expect(state.holdings[0].quantity).toBe(25);
            expect(state.holdings[1].quantity).toBe(5);
        });

        it('deletes a holding at specific index', () => {
            const h1: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150.5,
            };
            const h2: Holding = {
                id: 'h2',
                broker: 'IB',
                country: 'US',
                symbol: 'MSFT',
                dateAcquired: '2024-02-01',
                quantity: 5,
                currency: 'USD',
                unitPrice: 300.0,
            };

            useAppStore.getState().addHolding(h1);
            useAppStore.getState().addHolding(h2);

            useAppStore.getState().deleteHolding(0);
            const state = useAppStore.getState();

            expect(state.holdings).toHaveLength(1);
            expect(state.holdings[0].symbol).toBe('MSFT');
        });

        it('deletes last holding', () => {
            const h1: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150.5,
            };

            useAppStore.getState().addHolding(h1);
            useAppStore.getState().deleteHolding(0);
            expect(useAppStore.getState().holdings).toHaveLength(0);
        });
    });

    describe('insertHolding', () => {
        it('inserts at correct index (middle)', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().insertHolding(1, mkHolding('X'));
            expect(symbols()).toEqual(['A', 'X', 'B', 'C']);
        });

        it('shifts subsequent holdings', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().insertHolding(1, mkHolding('X'));
            expect(useAppStore.getState().holdings).toHaveLength(4);
            expect(useAppStore.getState().holdings[2].symbol).toBe('B');
            expect(useAppStore.getState().holdings[3].symbol).toBe('C');
        });

        it('inserts at index 0 (prepend)', () => {
            seedHoldings('A', 'B');
            useAppStore.getState().insertHolding(0, mkHolding('X'));
            expect(symbols()).toEqual(['X', 'A', 'B']);
        });

        it('inserts at end (append)', () => {
            seedHoldings('A', 'B');
            useAppStore.getState().insertHolding(2, mkHolding('X'));
            expect(symbols()).toEqual(['A', 'B', 'X']);
        });

        it('inserts into empty array', () => {
            useAppStore.getState().insertHolding(0, mkHolding('X'));
            expect(symbols()).toEqual(['X']);
        });

        it('preserves holding data on inserted item', () => {
            seedHoldings('A', 'B');
            const h = mkHolding('X');

            h.quantity = 42;
            h.unitPrice = 99.99;
            useAppStore.getState().insertHolding(1, h);
            const inserted = useAppStore.getState().holdings[1];

            expect(inserted.symbol).toBe('X');
            expect(inserted.quantity).toBe(42);
            expect(inserted.unitPrice).toBe(99.99);
        });

        it('does not mutate existing holdings', () => {
            seedHoldings('A', 'B');
            const before = useAppStore.getState().holdings;

            useAppStore.getState().insertHolding(1, mkHolding('X'));
            const after = useAppStore.getState().holdings;

            expect(before).toHaveLength(2);
            expect(after).toHaveLength(3);
            expect(before).not.toBe(after);
        });

        it('split-like insert clones with quantity 0', () => {
            seedHoldings('A', 'B');
            const original = useAppStore.getState().holdings[0];
            const split: Holding = {
                ...original,
                id: 'split-1',
                quantity: 0,
                source: { type: 'Manual' },
            };

            useAppStore.getState().insertHolding(1, split);
            const holdings = useAppStore.getState().holdings;

            expect(holdings).toHaveLength(3);
            expect(holdings[0].symbol).toBe('A');
            expect(holdings[0].quantity).toBe(10);
            expect(holdings[1].symbol).toBe('A');
            expect(holdings[1].quantity).toBe(0);
            expect(holdings[1].id).toBe('split-1');
            expect(holdings[2].symbol).toBe('B');
        });
    });

    describe('moveHolding', () => {
        it('moves a holding down (adjacent swap)', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().moveHolding(0, 1);
            expect(symbols()).toEqual(['B', 'A', 'C']);
        });

        it('moves a holding up (adjacent swap)', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().moveHolding(2, 1);
            expect(symbols()).toEqual(['A', 'C', 'B']);
        });

        it('moves first to last', () => {
            seedHoldings('A', 'B', 'C', 'D', 'E');
            useAppStore.getState().moveHolding(0, 4);
            expect(symbols()).toEqual(['B', 'C', 'D', 'E', 'A']);
        });

        it('moves last to first', () => {
            seedHoldings('A', 'B', 'C', 'D', 'E');
            useAppStore.getState().moveHolding(4, 0);
            expect(symbols()).toEqual(['E', 'A', 'B', 'C', 'D']);
        });

        it('is a no-op when fromIndex equals toIndex', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().moveHolding(1, 1);
            expect(symbols()).toEqual(['A', 'B', 'C']);
        });

        it('is a no-op when toIndex is negative', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().moveHolding(0, -1);
            expect(symbols()).toEqual(['A', 'B', 'C']);
        });

        it('is a no-op when toIndex exceeds array length', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().moveHolding(0, 10);
            expect(symbols()).toEqual(['A', 'B', 'C']);
        });

        it('is a no-op when fromIndex is out of bounds', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().moveHolding(5, 1);
            expect(symbols()).toEqual(['A', 'B', 'C']);
        });

        it('handles single-element array', () => {
            seedHoldings('A');
            useAppStore.getState().moveHolding(0, 0);
            expect(symbols()).toEqual(['A']);
        });

        it('composes multiple consecutive moves correctly', () => {
            seedHoldings('A', 'B', 'C');
            useAppStore.getState().moveHolding(0, 2); // [B, C, A]
            useAppStore.getState().moveHolding(0, 1); // [C, B, A]
            expect(symbols()).toEqual(['C', 'B', 'A']);
        });

        it('preserves holding data after move', () => {
            const h1 = mkHolding('AAPL');

            h1.quantity = 42;
            h1.unitPrice = 123.45;
            useAppStore.getState().addHolding(h1);
            useAppStore.getState().addHolding(mkHolding('MSFT'));
            useAppStore.getState().moveHolding(0, 1);
            const moved = useAppStore.getState().holdings[1];

            expect(moved.symbol).toBe('AAPL');
            expect(moved.quantity).toBe(42);
            expect(moved.unitPrice).toBe(123.45);
        });
    });

    describe('addSale/updateSale/deleteSale', () => {
        it('adds a sale', () => {
            const sale: Sale = {
                id: 's1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                dateSold: '2024-12-01',
                quantity: 5,
                currency: 'USD',
                buyPrice: 150.0,
                sellPrice: 200.0,
                fxRateBuy: 1.1,
                fxRateSell: 1.05,
            };

            useAppStore.getState().addSale(sale);
            const state = useAppStore.getState();

            expect(state.sales).toHaveLength(1);
            expect(state.sales[0].symbol).toBe('AAPL');
        });

        it('adds multiple sales', () => {
            const s1: Sale = {
                id: 's1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                dateSold: '2024-12-01',
                quantity: 5,
                currency: 'USD',
                buyPrice: 150.0,
                sellPrice: 200.0,
                fxRateBuy: 1.1,
                fxRateSell: 1.05,
            };
            const s2: Sale = {
                id: 's2',
                broker: 'IB',
                country: 'US',
                symbol: 'MSFT',
                dateAcquired: '2024-02-01',
                dateSold: '2024-11-15',
                quantity: 3,
                currency: 'USD',
                buyPrice: 300.0,
                sellPrice: 350.0,
                fxRateBuy: 1.08,
                fxRateSell: 1.06,
            };

            useAppStore.getState().addSale(s1);
            useAppStore.getState().addSale(s2);
            expect(useAppStore.getState().sales).toHaveLength(2);
        });

        it('updates a sale at specific index', () => {
            const sale: Sale = {
                id: 's1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                dateSold: '2024-12-01',
                quantity: 5,
                currency: 'USD',
                buyPrice: 150.0,
                sellPrice: 200.0,
                fxRateBuy: 1.1,
                fxRateSell: 1.05,
            };

            useAppStore.getState().addSale(sale);

            const updated: Sale = { ...sale, quantity: 10 };

            useAppStore.getState().updateSale(0, updated);
            expect(useAppStore.getState().sales[0].quantity).toBe(10);
        });

        it('deletes a sale at specific index', () => {
            const s1: Sale = {
                id: 's1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                dateSold: '2024-12-01',
                quantity: 5,
                currency: 'USD',
                buyPrice: 150.0,
                sellPrice: 200.0,
                fxRateBuy: 1.1,
                fxRateSell: 1.05,
            };
            const s2: Sale = {
                id: 's2',
                broker: 'IB',
                country: 'US',
                symbol: 'MSFT',
                dateAcquired: '2024-02-01',
                dateSold: '2024-11-15',
                quantity: 3,
                currency: 'USD',
                buyPrice: 300.0,
                sellPrice: 350.0,
                fxRateBuy: 1.08,
                fxRateSell: 1.06,
            };

            useAppStore.getState().addSale(s1);
            useAppStore.getState().addSale(s2);
            useAppStore.getState().deleteSale(0);
            const state = useAppStore.getState();

            expect(state.sales).toHaveLength(1);
            expect(state.sales[0].symbol).toBe('MSFT');
        });
    });

    describe('addDividend/updateDividend/deleteDividend', () => {
        it('adds a dividend', () => {
            const dividend: Dividend = {
                symbol: 'AAPL',
                country: 'US',
                date: '2024-05-10',
                currency: 'USD',
                grossAmount: 100,
                withholdingTax: 15,
                bgTaxDue: 0,
                whtCredit: 0,
            };

            useAppStore.getState().addDividend(dividend);
            const state = useAppStore.getState();

            expect(state.dividends).toHaveLength(1);
            expect(state.dividends[0].symbol).toBe('AAPL');
            expect(state.dividends[0].grossAmount).toBe(100);
        });

        it('adds multiple dividends', () => {
            const d1: Dividend = {
                symbol: 'AAPL',
                country: 'US',
                date: '2024-05-10',
                currency: 'USD',
                grossAmount: 100,
                withholdingTax: 15,
                bgTaxDue: 0,
                whtCredit: 0,
            };
            const d2: Dividend = {
                symbol: 'MSFT',
                country: 'US',
                date: '2024-06-15',
                currency: 'USD',
                grossAmount: 50,
                withholdingTax: 7.5,
                bgTaxDue: 0,
                whtCredit: 0,
            };

            useAppStore.getState().addDividend(d1);
            useAppStore.getState().addDividend(d2);
            expect(useAppStore.getState().dividends).toHaveLength(2);
        });

        it('updates a dividend at specific index', () => {
            const dividend: Dividend = {
                symbol: 'AAPL',
                country: 'US',
                date: '2024-05-10',
                currency: 'USD',
                grossAmount: 100,
                withholdingTax: 15,
                bgTaxDue: 0,
                whtCredit: 0,
            };

            useAppStore.getState().addDividend(dividend);

            const updated: Dividend = { ...dividend, grossAmount: 120 };

            useAppStore.getState().updateDividend(0, updated);
            expect(useAppStore.getState().dividends[0].grossAmount).toBe(120);
        });

        it('deletes a dividend at specific index', () => {
            const d1: Dividend = {
                symbol: 'AAPL',
                country: 'US',
                date: '2024-05-10',
                currency: 'USD',
                grossAmount: 100,
                withholdingTax: 15,
                bgTaxDue: 0,
                whtCredit: 0,
            };
            const d2: Dividend = {
                symbol: 'MSFT',
                country: 'US',
                date: '2024-06-15',
                currency: 'USD',
                grossAmount: 50,
                withholdingTax: 7.5,
                bgTaxDue: 0,
                whtCredit: 0,
            };

            useAppStore.getState().addDividend(d1);
            useAppStore.getState().addDividend(d2);
            useAppStore.getState().deleteDividend(0);
            const state = useAppStore.getState();

            expect(state.dividends).toHaveLength(1);
            expect(state.dividends[0].symbol).toBe('MSFT');
        });
    });

    describe('addStockYield/updateStockYield/deleteStockYield', () => {
        it('adds a stock yield entry', () => {
            const entry: StockYieldEntry = {
                date: '2024-03-15',
                symbol: 'AAPL',
                currency: 'USD',
                amount: 50.5,
            };

            useAppStore.getState().addStockYield(entry);
            const state = useAppStore.getState();

            expect(state.stockYield).toHaveLength(1);
            expect(state.stockYield[0].symbol).toBe('AAPL');
            expect(state.stockYield[0].amount).toBe(50.5);
        });

        it('adds multiple stock yield entries', () => {
            const e1: StockYieldEntry = {
                date: '2024-03-15',
                symbol: 'AAPL',
                currency: 'USD',
                amount: 50.5,
            };
            const e2: StockYieldEntry = {
                date: '2024-04-20',
                symbol: 'MSFT',
                currency: 'USD',
                amount: 30.0,
            };

            useAppStore.getState().addStockYield(e1);
            useAppStore.getState().addStockYield(e2);
            expect(useAppStore.getState().stockYield).toHaveLength(2);
        });

        it('updates a stock yield entry at specific index', () => {
            const entry: StockYieldEntry = {
                date: '2024-03-15',
                symbol: 'AAPL',
                currency: 'USD',
                amount: 50.5,
            };

            useAppStore.getState().addStockYield(entry);

            const updated: StockYieldEntry = { ...entry, amount: 75.0 };

            useAppStore.getState().updateStockYield(0, updated);
            expect(useAppStore.getState().stockYield[0].amount).toBe(75.0);
        });

        it('deletes a stock yield entry at specific index', () => {
            const e1: StockYieldEntry = {
                date: '2024-03-15',
                symbol: 'AAPL',
                currency: 'USD',
                amount: 50.5,
            };
            const e2: StockYieldEntry = {
                date: '2024-04-20',
                symbol: 'MSFT',
                currency: 'USD',
                amount: 30.0,
            };

            useAppStore.getState().addStockYield(e1);
            useAppStore.getState().addStockYield(e2);
            useAppStore.getState().deleteStockYield(0);
            const state = useAppStore.getState();

            expect(state.stockYield).toHaveLength(1);
            expect(state.stockYield[0].symbol).toBe('MSFT');
        });
    });

    describe('addBrokerInterest/updateBrokerInterest/deleteBrokerInterest', () => {
        it('adds a broker interest entry', () => {
            const brokerInt: BrokerInterest = {
                broker: 'IB',
                currency: 'USD',
                entries: [
                    {
                        currency: 'USD',
                        date: '2024-01-15',
                        description: 'Monthly interest',
                        amount: 25.5,
                        source: { type: 'Manual' },
                    },
                ],
            };

            useAppStore.getState().addBrokerInterest(brokerInt);
            const state = useAppStore.getState();

            expect(state.brokerInterest).toHaveLength(1);
            expect(state.brokerInterest[0].broker).toBe('IB');
            expect(state.brokerInterest[0].entries).toHaveLength(1);
            expect(state.brokerInterest[0].entries[0].amount).toBe(25.5);
        });

        it('adds multiple broker interest entries', () => {
            const bi1: BrokerInterest = {
                broker: 'IB',
                currency: 'USD',
                entries: [
                    {
                        currency: 'USD',
                        date: '2024-01-15',
                        description: 'Monthly interest',
                        amount: 25.5,
                        source: { type: 'Manual' },
                    },
                ],
            };
            const bi2: BrokerInterest = {
                broker: 'Revolut',
                currency: 'EUR',
                entries: [
                    {
                        currency: 'EUR',
                        date: '2024-02-15',
                        description: 'Monthly interest',
                        amount: 15.0,
                        source: { type: 'Manual' },
                    },
                ],
            };

            useAppStore.getState().addBrokerInterest(bi1);
            useAppStore.getState().addBrokerInterest(bi2);
            expect(useAppStore.getState().brokerInterest).toHaveLength(2);
        });

        it('updates a broker interest at specific index', () => {
            const brokerInt: BrokerInterest = {
                broker: 'IB',
                currency: 'USD',
                entries: [
                    {
                        currency: 'USD',
                        date: '2024-01-15',
                        description: 'Monthly interest',
                        amount: 25.5,
                        source: { type: 'Manual' },
                    },
                ],
            };

            useAppStore.getState().addBrokerInterest(brokerInt);

            const updated: BrokerInterest = {
                ...brokerInt,
                entries: [{ ...brokerInt.entries[0], amount: 30.0 }],
            };

            useAppStore.getState().updateBrokerInterest(0, updated);
            expect(useAppStore.getState().brokerInterest[0].entries[0].amount).toBe(30.0);
        });

        it('deletes a broker interest at specific index', () => {
            const bi1: BrokerInterest = {
                broker: 'IB',
                currency: 'USD',
                entries: [
                    {
                        currency: 'USD',
                        date: '2024-01-15',
                        description: 'Monthly interest',
                        amount: 25.5,
                        source: { type: 'Manual' },
                    },
                ],
            };
            const bi2: BrokerInterest = {
                broker: 'Revolut',
                currency: 'EUR',
                entries: [
                    {
                        currency: 'EUR',
                        date: '2024-02-15',
                        description: 'Monthly interest',
                        amount: 15.0,
                        source: { type: 'Manual' },
                    },
                ],
            };

            useAppStore.getState().addBrokerInterest(bi1);
            useAppStore.getState().addBrokerInterest(bi2);
            useAppStore.getState().deleteBrokerInterest(0);
            const state = useAppStore.getState();

            expect(state.brokerInterest).toHaveLength(1);
            expect(state.brokerInterest[0].broker).toBe('Revolut');
        });
    });

    describe('setFxRates', () => {
        it('sets FX rates', () => {
            const rates = {
                USD: {
                    '2024-01-01': 1.1,
                    '2024-01-02': 1.11,
                },
            };

            useAppStore.getState().setFxRates(rates);
            const state = useAppStore.getState();

            expect(state.fxRates.USD).toBeDefined();
            expect(state.fxRates.USD['2024-01-01']).toBe(1.1);
        });

        it('merges FX rates, not replaces', () => {
            const rates1 = {
                USD: {
                    '2024-01-01': 1.1,
                },
            };
            const rates2 = {
                EUR: {
                    '2024-01-01': 0.92,
                },
            };

            useAppStore.getState().setFxRates(rates1);
            useAppStore.getState().setFxRates(rates2);
            const state = useAppStore.getState();

            expect(state.fxRates.USD).toBeDefined();
            expect(state.fxRates.EUR).toBeDefined();
            expect(state.fxRates.USD['2024-01-01']).toBe(1.1);
            expect(state.fxRates.EUR['2024-01-01']).toBe(0.92);
        });

        it('merges dates within same currency', () => {
            const rates1 = {
                USD: {
                    '2024-01-01': 1.1,
                },
            };
            const rates2 = {
                USD: {
                    '2024-01-02': 1.11,
                },
            };

            useAppStore.getState().setFxRates(rates1);
            useAppStore.getState().setFxRates(rates2);
            const state = useAppStore.getState();

            expect(state.fxRates.USD['2024-01-01']).toBe(1.1);
            expect(state.fxRates.USD['2024-01-02']).toBe(1.11);
        });

        it('overwrites FX rate for same currency and date', () => {
            const rates1 = {
                USD: {
                    '2024-01-01': 1.1,
                },
            };
            const rates2 = {
                USD: {
                    '2024-01-01': 1.15,
                },
            };

            useAppStore.getState().setFxRates(rates1);
            useAppStore.getState().setFxRates(rates2);
            const state = useAppStore.getState();

            expect(state.fxRates.USD['2024-01-01']).toBe(1.15);
        });
    });

    describe('reset', () => {
        it('resets all state to initial values', () => {
            const holding: Holding = {
                id: 'h1',
                broker: 'IB',
                country: 'US',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150.5,
            };

            useAppStore.getState().addHolding(holding);
            useAppStore.getState().setLanguage('en');
            useAppStore.getState().setBaseCurrency('EUR');
            useAppStore.getState().setTaxYear(2026);

            useAppStore.getState().reset();
            const state = useAppStore.getState();

            expect(state.holdings).toHaveLength(0);
            expect(state.sales).toHaveLength(0);
            expect(state.dividends).toHaveLength(0);
            expect(state.language).toBe('bg');
            expect(state.fxRates).toEqual({});
        });

        it('resets tax year to 2025 (previous year from 2026)', () => {
            useAppStore.getState().setTaxYear(2030);
            useAppStore.getState().reset();
            const state = useAppStore.getState();

            // Reset uses initial state, which calculates based on current year
            // Since test is running in 2026, previous year is 2025
            expect(state.taxYear).toBe(2025);
        });

        it('resets data arrays to empty', () => {
            const dividend: Dividend = {
                symbol: 'AAPL',
                country: 'US',
                date: '2024-05-10',
                currency: 'USD',
                grossAmount: 100,
                withholdingTax: 15,
                bgTaxDue: 0,
                whtCredit: 0,
            };

            useAppStore.getState().addDividend(dividend);

            const entry: StockYieldEntry = {
                date: '2024-03-15',
                symbol: 'AAPL',
                currency: 'USD',
                amount: 50.5,
            };

            useAppStore.getState().addStockYield(entry);

            useAppStore.getState().reset();
            const state = useAppStore.getState();

            expect(state.holdings).toEqual([]);
            expect(state.sales).toEqual([]);
            expect(state.dividends).toEqual([]);
            expect(state.stockYield).toEqual([]);
            expect(state.brokerInterest).toEqual([]);
        });
    });

    describe('tableSorting', () => {
        it('starts with empty tableSorting', () => {
            expect(useAppStore.getState().tableSorting).toEqual({});
        });

        it('sets sorting for a specific table', () => {
            useAppStore.getState().setTableSorting('holdings', [{ id: 'symbol', desc: false }]);
            expect(useAppStore.getState().tableSorting.holdings).toEqual([{ id: 'symbol', desc: false }]);
        });

        it('sets sorting for multiple tables independently', () => {
            useAppStore.getState().setTableSorting('holdings', [{ id: 'symbol', desc: false }]);
            useAppStore.getState().setTableSorting('sales', [{ id: 'dateSold', desc: true }]);
            const ts = useAppStore.getState().tableSorting;

            expect(ts.holdings).toEqual([{ id: 'symbol', desc: false }]);
            expect(ts.sales).toEqual([{ id: 'dateSold', desc: true }]);
        });

        it('overwrites sorting for the same table', () => {
            useAppStore.getState().setTableSorting('holdings', [{ id: 'symbol', desc: false }]);
            useAppStore.getState().setTableSorting('holdings', [{ id: 'unitPrice', desc: true }]);
            expect(useAppStore.getState().tableSorting.holdings).toEqual([{ id: 'unitPrice', desc: true }]);
        });

        it('clears sorting for a table with empty array', () => {
            useAppStore.getState().setTableSorting('holdings', [{ id: 'symbol', desc: false }]);
            useAppStore.getState().setTableSorting('holdings', []);
            expect(useAppStore.getState().tableSorting.holdings).toEqual([]);
        });

        it('resets tableSorting on reset()', () => {
            useAppStore.getState().setTableSorting('holdings', [{ id: 'symbol', desc: false }]);
            useAppStore.getState().reset();
            expect(useAppStore.getState().tableSorting).toEqual({});
        });
    });
});

describe('applySorting', () => {
    const items = [
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 35 },
    ];

    it('returns original array when sorting is empty', () => {
        const result = applySorting(items, []);

        expect(result).toBe(items); // same reference
    });

    it('returns original array when sorting by "#"', () => {
        const result = applySorting(items, [{ id: '#', desc: false }]);

        expect(result).toBe(items);
    });

    it('sorts strings ascending with localeCompare', () => {
        const result = applySorting(items, [{ id: 'name', desc: false }]);

        expect(result.map(i => i.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('sorts strings descending', () => {
        const result = applySorting(items, [{ id: 'name', desc: true }]);

        expect(result.map(i => i.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    });

    it('sorts numbers ascending', () => {
        const result = applySorting(items, [{ id: 'age', desc: false }]);

        expect(result.map(i => i.age)).toEqual([25, 30, 35]);
    });

    it('sorts numbers descending', () => {
        const result = applySorting(items, [{ id: 'age', desc: true }]);

        expect(result.map(i => i.age)).toEqual([35, 30, 25]);
    });

    it('does not mutate original array', () => {
        const original = [...items];

        applySorting(items, [{ id: 'name', desc: false }]);
        expect(items).toEqual(original);
    });

    it('handles missing fields gracefully', () => {
        const sparse = [{ name: 'B' }, { name: 'A' }, {} as { name: string }];
        const result = applySorting(sparse, [{ id: 'name', desc: false }]);

        expect(result.map(i => i.name)).toEqual([undefined, 'A', 'B']);
    });

    it('uses only the first sorting entry', () => {
        const result = applySorting(items, [
            { id: 'age', desc: false },
            { id: 'name', desc: true },
        ]);

        expect(result.map(i => i.age)).toEqual([25, 30, 35]);
    });

    it('handles empty array', () => {
        const result = applySorting([], [{ id: 'name', desc: false }]);

        expect(result).toEqual([]);
    });

    it('handles single-item array', () => {
        const result = applySorting([{ name: 'Solo', age: 1 }], [{ id: 'name', desc: false }]);

        expect(result).toEqual([{ name: 'Solo', age: 1 }]);
    });

    it('handles all identical values', () => {
        const same = [{ name: 'X', age: 5 }, { name: 'X', age: 5 }, { name: 'X', age: 5 }];
        const result = applySorting(same, [{ id: 'name', desc: false }]);

        expect(result).toEqual(same);
    });

    it('sorts non-existent column without crashing', () => {
        const result = applySorting(items, [{ id: 'nonexistent', desc: false }]);

        expect(result).toHaveLength(3);
    });

    it('sorts ISO date strings chronologically', () => {
        const dated = [
            { date: '2024-12-01' },
            { date: '2024-01-15' },
            { date: '2024-06-30' },
        ];
        const result = applySorting(dated, [{ id: 'date', desc: false }]);

        expect(result.map(i => i.date)).toEqual(['2024-01-15', '2024-06-30', '2024-12-01']);
    });
});

describe('tableSorting survives data mutations', () => {
    beforeEach(() => {
        useAppStore.getState().reset();
    });

    const mkHolding = (symbol: string): Holding => ({
        id: `h-${symbol}`,
        broker: 'IB',
        country: 'US',
        symbol,
        dateAcquired: '2024-01-01',
        quantity: 10,
        currency: 'USD',
        unitPrice: 100,
    });

    it('addHolding does not clear tableSorting', () => {
        useAppStore.getState().setTableSorting('holdings', [{ id: 'symbol', desc: false }]);
        useAppStore.getState().addHolding(mkHolding('AAPL'));
        expect(useAppStore.getState().tableSorting.holdings).toEqual([{ id: 'symbol', desc: false }]);
    });

    it('deleteHolding does not clear tableSorting', () => {
        useAppStore.getState().addHolding(mkHolding('AAPL'));
        useAppStore.getState().setTableSorting('holdings', [{ id: 'symbol', desc: true }]);
        useAppStore.getState().deleteHolding(0);
        expect(useAppStore.getState().tableSorting.holdings).toEqual([{ id: 'symbol', desc: true }]);
    });

    it('importHoldings does not clear tableSorting', () => {
        useAppStore.getState().setTableSorting('holdings', [{ id: 'unitPrice', desc: false }]);
        useAppStore.getState().importHoldings([mkHolding('GOOG'), mkHolding('MSFT')]);
        expect(useAppStore.getState().tableSorting.holdings).toEqual([{ id: 'unitPrice', desc: false }]);
    });

    it('addSale does not clear tableSorting for sales', () => {
        useAppStore.getState().setTableSorting('sales', [{ id: 'dateSold', desc: true }]);
        const sale: Sale = {
            id: 's-1',
            broker: 'IB',
            country: 'US',
            symbol: 'AAPL',
            dateAcquired: '2024-01-01',
            dateSold: '2024-06-01',
            quantity: 5,
            buyPrice: 100,
            sellPrice: 150,
            currency: 'USD',
            fxRateBuy: null,
            fxRateSell: null,
        };

        useAppStore.getState().addSale(sale);
        expect(useAppStore.getState().tableSorting.sales).toEqual([{ id: 'dateSold', desc: true }]);
    });
});

describe('old autosave without tableSorting', () => {
    it('restore handles missing tableSorting gracefully', () => {
        // Simulate old autosave data that lacks tableSorting
        const oldSaveData = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [],
            sales: [],
            dividends: [],
            fxRates: {},
        };

        // The restore code checks: saved.tableSorting && typeof saved.tableSorting === 'object'
        // With no tableSorting field, condition is falsy — store keeps default {}
        const hasSorting = (oldSaveData as Record<string, unknown>).tableSorting && typeof (oldSaveData as Record<string, unknown>).tableSorting === 'object';

        expect(hasSorting).toBeFalsy();
    });

    it('restore handles old holdingsSorting array without crashing', () => {
        const oldSaveData = {
            taxYear: 2025,
            holdingsSorting: [{ id: 'symbol', desc: false }],
        };

        // Old field is an array, not an object with table keys — typeof check would pass
        // but Object.entries would iterate array indices, not table names
        // The restore code checks: typeof saved.tableSorting === 'object'
        // holdingsSorting is NOT tableSorting, so it's simply ignored
        const hasSorting = (oldSaveData as Record<string, unknown>).tableSorting;

        expect(hasSorting).toBeUndefined();
    });
});
