import {
    describe,
    expect,
    it,
} from 'vitest';

import { ibProvider } from '../../src/providers/ib.js';
import { revolutProvider } from '../../src/providers/revolut.js';
import {
    isBinaryHandler,
    isTextHandler,
} from '../../src/providers/types.js';

describe('isTextHandler / isBinaryHandler type guards', () => {
    it('identifies text handlers', () => {
        const handler = ibProvider.fileHandlers[0];

        expect(isTextHandler(handler)).toBe(true);
        expect(isBinaryHandler(handler)).toBe(false);
    });

    it('identifies revolut text handlers', () => {
        for (const handler of revolutProvider.fileHandlers) {
            expect(isTextHandler(handler)).toBe(true);
            expect(isBinaryHandler(handler)).toBe(false);
        }
    });
});

describe('IB provider — detectFile', () => {
    const handler = ibProvider.fileHandlers[0];

    if (!isTextHandler(handler)) {
        throw new Error('Expected text handler');
    }

    it('detects valid IB CSV header', () => {
        expect(handler.detectFile('Statement,Header,Field Name\nfoo', 'test.csv')).toBe(true);
    });

    it('rejects non-IB CSV', () => {
        expect(handler.detectFile('Date,Ticker,Type\nfoo', 'test.csv')).toBe(false);
    });

    it('rejects empty content', () => {
        expect(handler.detectFile('', 'test.csv')).toBe(false);
    });
});

describe('Revolut provider — handler detection', () => {
    const [savings, investments, account] = revolutProvider.fileHandlers;

    describe('savings handler', () => {
        if (!isTextHandler(savings)) {
            throw new Error('Expected text handler');
        }

        it('detects "Interest PAID" in content', () => {
            expect(savings.detectFile('Date,Type\nInterest PAID,100', 'export.csv')).toBe(true);
        });

        it('detects by filename pattern', () => {
            expect(savings.detectFile('Date,Amount\n2025-01-01,100', 'savings-statement-2025.csv')).toBe(true);
        });

        it('rejects unrelated CSV', () => {
            expect(savings.detectFile('Date,Amount\n2025-01-01,100', 'transactions.csv')).toBe(false);
        });
    });

    describe('investments handler', () => {
        if (!isTextHandler(investments)) {
            throw new Error('Expected text handler');
        }

        it('detects CSV with Date, Ticker, Type columns', () => {
            expect(investments.detectFile('Date,Ticker,Type,Quantity\n2025-01-01,AAPL,BUY,10', 'test.csv')).toBe(true);
        });

        it('rejects CSV without required columns', () => {
            expect(investments.detectFile('Date,Amount\n2025-01-01,100', 'test.csv')).toBe(false);
        });

        it('rejects empty content', () => {
            expect(investments.detectFile('', 'test.csv')).toBe(false);
        });
    });

    describe('account handler', () => {
        if (!isTextHandler(account)) {
            throw new Error('Expected text handler');
        }

        it('detects CSV with Product, Balance, State columns', () => {
            expect(account.detectFile('Product,Balance,State\nCurrent,1000,COMPLETED', 'test.csv')).toBe(true);
        });

        it('rejects CSV without required columns', () => {
            expect(account.detectFile('Date,Amount\n2025-01-01,100', 'test.csv')).toBe(false);
        });

        it('rejects empty content', () => {
            expect(account.detectFile('', 'test.csv')).toBe(false);
        });
    });
});

describe('Revolut investments — parseFile trade conversion', () => {
    const handler = revolutProvider.fileHandlers[1];

    if (!isTextHandler(handler)) {
        throw new Error('Expected text handler');
    }

    it('converts BUY trades with positive quantity', () => {
        const csv = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2025-03-15 10:30:00,AAPL,BUY,10,170.50,1705.00,USD,1.0`;
        const result = handler.parseFile(csv);

        expect(result.trades).toHaveLength(1);
        expect(result.trades![0].quantity).toBe(10);
        expect(result.trades![0].proceeds).toBe(0);
        expect(result.trades![0].commission).toBe(0);
        expect(result.trades![0].symbol).toBe('AAPL');
        expect(result.trades![0].currency).toBe('USD');
    });

    it('converts SELL trades with negative quantity', () => {
        const csv = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2025-03-15 10:30:00,AAPL,SELL,5,180.00,900.00,USD,1.0`;
        const result = handler.parseFile(csv);

        expect(result.trades).toHaveLength(1);
        expect(result.trades![0].quantity).toBe(-5);
        expect(result.trades![0].proceeds).toBe(900);
    });
});
