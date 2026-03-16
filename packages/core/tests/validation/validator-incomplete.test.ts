import {
    describe,
    expect,
    it,
} from 'vitest';
import { validate } from '../../src/validation/validator';
import type { AppState } from '../../src/types/index';

describe('checkIncompleteRows', () => {
    const createBaseState = (): AppState => ({
        taxYear: 2024,
        baseCurrency: 'BGN',
        language: 'en',
        holdings: [],
        sales: [],
        dividends: [],
        stockYield: [],
        ibInterest: [],
        revolutInterest: [],
        fxRates: {},
        manualEntries: [],
    });

    describe('Holdings', () => {
        it('warns on missing symbol', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: '', // missing
                    dateAcquired: '2024-01-15',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('symbol'),
                tab: 'Holdings',
                rowIndex: 0,
            }));
        });

        it('warns on missing date', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '', // missing
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('date'),
                tab: 'Holdings',
                rowIndex: 0,
            }));
        });

        it('warns on missing currency', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    quantity: 10,
                    currency: '', // missing
                    unitPrice: 150.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('currency'),
                tab: 'Holdings',
                rowIndex: 0,
            }));
        });

        it('warns on zero quantity and zero unitPrice', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    quantity: 0, // zero
                    currency: 'USD',
                    unitPrice: 0, // zero
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('quantity/price'),
                tab: 'Holdings',
                rowIndex: 0,
            }));
        });

        it('does not warn when quantity is zero but unitPrice is set', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    quantity: 0,
                    currency: 'USD',
                    unitPrice: 150.5, // has price
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'Holdings');
            expect(warnings).toHaveLength(0);
        });

        it('does not warn when complete', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.5,
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'Holdings');
            expect(warnings).toHaveLength(0);
        });
    });

    describe('Sales', () => {
        it('warns on missing symbol', () => {
            const state = createBaseState();
            state.sales = [
                {
                    id: 's1',
                    broker: 'IB',
                    country: 'US',
                    symbol: '', // missing
                    dateAcquired: '2024-01-15',
                    dateSold: '2024-12-01',
                    quantity: 5,
                    currency: 'USD',
                    buyPrice: 150.0,
                    sellPrice: 200.0,
                    fxRateBuy: 1.1,
                    fxRateSell: 1.05,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('symbol'),
                tab: 'Sales',
                rowIndex: 0,
            }));
        });

        it('warns on missing dateAcquired', () => {
            const state = createBaseState();
            state.sales = [
                {
                    id: 's1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '', // missing
                    dateSold: '2024-12-01',
                    quantity: 5,
                    currency: 'USD',
                    buyPrice: 150.0,
                    sellPrice: 200.0,
                    fxRateBuy: 1.1,
                    fxRateSell: 1.05,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('date acquired'),
                tab: 'Sales',
                rowIndex: 0,
            }));
        });

        it('warns on missing dateSold', () => {
            const state = createBaseState();
            state.sales = [
                {
                    id: 's1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    dateSold: '', // missing
                    quantity: 5,
                    currency: 'USD',
                    buyPrice: 150.0,
                    sellPrice: 200.0,
                    fxRateBuy: 1.1,
                    fxRateSell: 1.05,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('date sold'),
                tab: 'Sales',
                rowIndex: 0,
            }));
        });

        it('warns on missing currency', () => {
            const state = createBaseState();
            state.sales = [
                {
                    id: 's1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    dateSold: '2024-12-01',
                    quantity: 5,
                    currency: '', // missing
                    buyPrice: 150.0,
                    sellPrice: 200.0,
                    fxRateBuy: 1.1,
                    fxRateSell: 1.05,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('currency'),
                tab: 'Sales',
                rowIndex: 0,
            }));
        });

        it('warns on zero quantity', () => {
            const state = createBaseState();
            state.sales = [
                {
                    id: 's1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    dateSold: '2024-12-01',
                    quantity: 0, // zero
                    currency: 'USD',
                    buyPrice: 150.0,
                    sellPrice: 200.0,
                    fxRateBuy: 1.1,
                    fxRateSell: 1.05,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('quantity'),
                tab: 'Sales',
                rowIndex: 0,
            }));
        });

        it('does not warn when complete', () => {
            const state = createBaseState();
            state.sales = [
                {
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
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'Sales');
            expect(warnings).toHaveLength(0);
        });
    });

    describe('Dividends', () => {
        it('warns on missing symbol', () => {
            const state = createBaseState();
            state.dividends = [
                {
                    symbol: '', // missing
                    country: 'US',
                    date: '2024-05-10',
                    currency: 'USD',
                    grossAmount: 100,
                    withholdingTax: 15,
                    bgTaxDue: 0,
                    whtCredit: 0,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('symbol'),
                tab: 'Dividends',
                rowIndex: 0,
            }));
        });

        it('warns on missing date', () => {
            const state = createBaseState();
            state.dividends = [
                {
                    symbol: 'AAPL',
                    country: 'US',
                    date: '', // missing
                    currency: 'USD',
                    grossAmount: 100,
                    withholdingTax: 15,
                    bgTaxDue: 0,
                    whtCredit: 0,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('date'),
                tab: 'Dividends',
                rowIndex: 0,
            }));
        });

        it('warns on missing currency', () => {
            const state = createBaseState();
            state.dividends = [
                {
                    symbol: 'AAPL',
                    country: 'US',
                    date: '2024-05-10',
                    currency: '', // missing
                    grossAmount: 100,
                    withholdingTax: 15,
                    bgTaxDue: 0,
                    whtCredit: 0,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('currency'),
                tab: 'Dividends',
                rowIndex: 0,
            }));
        });

        it('warns on zero grossAmount and zero withholdingTax', () => {
            const state = createBaseState();
            state.dividends = [
                {
                    symbol: 'AAPL',
                    country: 'US',
                    date: '2024-05-10',
                    currency: 'USD',
                    grossAmount: 0, // zero
                    withholdingTax: 0, // zero
                    bgTaxDue: 0,
                    whtCredit: 0,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('amounts'),
                tab: 'Dividends',
                rowIndex: 0,
            }));
        });

        it('does not warn when grossAmount is zero but withholdingTax is set', () => {
            const state = createBaseState();
            state.dividends = [
                {
                    symbol: 'AAPL',
                    country: 'US',
                    date: '2024-05-10',
                    currency: 'USD',
                    grossAmount: 0,
                    withholdingTax: 15, // has tax
                    bgTaxDue: 0,
                    whtCredit: 0,
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'Dividends');
            expect(warnings).toHaveLength(0);
        });

        it('does not warn when complete', () => {
            const state = createBaseState();
            state.dividends = [
                {
                    symbol: 'AAPL',
                    country: 'US',
                    date: '2024-05-10',
                    currency: 'USD',
                    grossAmount: 100,
                    withholdingTax: 15,
                    bgTaxDue: 0,
                    whtCredit: 0,
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'Dividends');
            expect(warnings).toHaveLength(0);
        });
    });

    describe('IB Interest', () => {
        it('warns on missing date', () => {
            const state = createBaseState();
            state.ibInterest = [
                {
                    currency: 'USD',
                    date: '', // missing
                    description: 'Monthly interest',
                    amount: 25.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('date'),
                tab: 'IB Interest',
                rowIndex: 0,
            }));
        });

        it('warns on missing currency', () => {
            const state = createBaseState();
            state.ibInterest = [
                {
                    currency: '', // missing
                    date: '2024-01-15',
                    description: 'Monthly interest',
                    amount: 25.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('currency'),
                tab: 'IB Interest',
                rowIndex: 0,
            }));
        });

        it('warns on zero amount', () => {
            const state = createBaseState();
            state.ibInterest = [
                {
                    currency: 'USD',
                    date: '2024-01-15',
                    description: 'Monthly interest',
                    amount: 0, // zero
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('amount'),
                tab: 'IB Interest',
                rowIndex: 0,
            }));
        });

        it('does not warn when complete', () => {
            const state = createBaseState();
            state.ibInterest = [
                {
                    currency: 'USD',
                    date: '2024-01-15',
                    description: 'Monthly interest',
                    amount: 25.5,
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'IB Interest');
            expect(warnings).toHaveLength(0);
        });
    });

    describe('Stock Yield', () => {
        it('warns on missing date', () => {
            const state = createBaseState();
            state.stockYield = [
                {
                    date: '', // missing
                    symbol: 'AAPL',
                    currency: 'USD',
                    amount: 50.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('date'),
                tab: 'Stock Yield',
                rowIndex: 0,
            }));
        });

        it('warns on missing symbol', () => {
            const state = createBaseState();
            state.stockYield = [
                {
                    date: '2024-03-15',
                    symbol: '', // missing
                    currency: 'USD',
                    amount: 50.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('symbol'),
                tab: 'Stock Yield',
                rowIndex: 0,
            }));
        });

        it('warns on missing currency', () => {
            const state = createBaseState();
            state.stockYield = [
                {
                    date: '2024-03-15',
                    symbol: 'AAPL',
                    currency: '', // missing
                    amount: 50.5,
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('currency'),
                tab: 'Stock Yield',
                rowIndex: 0,
            }));
        });

        it('warns on zero amount', () => {
            const state = createBaseState();
            state.stockYield = [
                {
                    date: '2024-03-15',
                    symbol: 'AAPL',
                    currency: 'USD',
                    amount: 0, // zero
                },
            ];
            const warnings = validate(state);
            expect(warnings).toContainEqual(expect.objectContaining({
                type: 'incomplete-row',
                message: expect.stringContaining('amount'),
                tab: 'Stock Yield',
                rowIndex: 0,
            }));
        });

        it('does not warn when complete', () => {
            const state = createBaseState();
            state.stockYield = [
                {
                    date: '2024-03-15',
                    symbol: 'AAPL',
                    currency: 'USD',
                    amount: 50.5,
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'Stock Yield');
            expect(warnings).toHaveLength(0);
        });
    });

    describe('Multiple incomplete rows', () => {
        it('reports all incomplete rows across different types', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: '', // missing symbol
                    dateAcquired: '2024-01-15',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.5,
                },
            ];
            state.sales = [
                {
                    id: 's1',
                    broker: 'IB',
                    country: 'US',
                    symbol: 'AAPL',
                    dateAcquired: '', // missing date
                    dateSold: '2024-12-01',
                    quantity: 5,
                    currency: 'USD',
                    buyPrice: 150.0,
                    sellPrice: 200.0,
                    fxRateBuy: 1.1,
                    fxRateSell: 1.05,
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row');
            expect(warnings.length).toBeGreaterThanOrEqual(2);
            expect(warnings).toContainEqual(expect.objectContaining({ tab: 'Holdings' }));
            expect(warnings).toContainEqual(expect.objectContaining({ tab: 'Sales' }));
        });

        it('reports multiple incomplete fields in single row', () => {
            const state = createBaseState();
            state.holdings = [
                {
                    id: 'h1',
                    broker: 'IB',
                    country: 'US',
                    symbol: '', // missing
                    dateAcquired: '', // missing
                    quantity: 0,
                    currency: '', // missing
                    unitPrice: 0,
                },
            ];
            const warnings = validate(state).filter(w => w.type === 'incomplete-row' && w.tab === 'Holdings');
            expect(warnings).toHaveLength(1);
            const msg = warnings[0].message;
            expect(msg).toContain('symbol');
            expect(msg).toContain('date');
            expect(msg).toContain('currency');
        });
    });
});
