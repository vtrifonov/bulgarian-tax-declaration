import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    extractPeriod,
    parseCashBalance,
    parseDividends,
    parseEtradePdf,
    parseHoldings,
    parseInterest,
    parseNameToTickerMap,
} from '../etrade-pdf.js';

describe('extractPeriod', () => {
    it('extracts quarterly period dates', () => {
        const text = 'CLIENT STATEMENT For the Period January 1- March 31, 2025 E*TRADE';
        const result = extractPeriod(text);

        expect(result).toEqual({ startDate: '2025-01-01', endDate: '2025-03-31', year: 2025 });
    });

    it('extracts annual period dates', () => {
        const text = 'CLIENT STATEMENT For the Period January 1- December 31, 2025';
        const result = extractPeriod(text);

        expect(result).toEqual({ startDate: '2025-01-01', endDate: '2025-12-31', year: 2025 });
    });

    it('returns null for non-E*TRADE text', () => {
        expect(extractPeriod('Some random document text')).toBeNull();
    });
});

describe('parseHoldings', () => {
    it('parses common stock holdings', () => {
        const text = `STOCKS
COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value Unrealized
Gain/(Loss) Est Ann Income Current
Yield %
PROGRESS SOFTWARE (PRGS) 829.000 $51.510 $19,838.49 $42,701.79 $22,863.30 $580.30 1.36
829.000 shs from Stock Plan; Asset Class: Equities`;
        const result = parseHoldings(text);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            symbol: 'PRGS',
            currency: 'USD',
            quantity: 829,
            costPrice: expect.closeTo(23.93, 1),
        });
    });

    it('returns empty array when no holdings section', () => {
        expect(parseHoldings('Some other section text')).toEqual([]);
    });
});

describe('parseInterest', () => {
    it('parses MMF dividend entries as interest', () => {
        const text = `CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend TREASURY LIQUIDITY FUND Transaction Reportable for the Prior Year. $16.45
2/3 Dividend TREASURY LIQUIDITY FUND
DIV PAYMENT
15.85
3/3 Dividend TREASURY LIQUIDITY FUND
DIV PAYMENT
14.26
NET CREDITS/(DEBITS) $46.56`;
        const result = parseInterest(text, 2025);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({
            date: '2025-01-02',
            amount: 16.45,
            currency: 'USD',
            description: 'TREASURY LIQUIDITY FUND',
        });
        expect(result[1].date).toBe('2025-02-03');
        expect(result[1].amount).toBe(15.85);
        expect(result[2].date).toBe('2025-03-03');
        expect(result[2].amount).toBe(14.26);
    });

    it('returns empty array when no activity section', () => {
        expect(parseInterest('No activity here', 2025)).toEqual([]);
    });
});

describe('parseCashBalance', () => {
    it('parses balance sheet cash values', () => {
        const text = `BALANCE SHEET (^ includes accrued interest)
Last Period This Period
(as of 12/31/24) (as of 3/31/25)
Cash, BDP, MMFs $4,645.52 $4,692.08
Stocks 54,009.35 42,701.79
Total Assets $58,654.87 $47,393.87`;
        const result = parseCashBalance(text);

        expect(result).toEqual({ amountStartOfYear: 4645.52, amountEndOfYear: 4692.08 });
    });

    it('returns null when no balance sheet section', () => {
        expect(parseCashBalance('No balance here')).toBeNull();
    });
});

describe('parseEtradePdf', () => {
    it('orchestrates all section parsers from full PDF text', () => {
        const fullText = `CLIENT STATEMENT For the Period January 1- March 31, 2025
E*TRADE from Morgan Stanley
...
BALANCE SHEET (^ includes accrued interest)
Last Period This Period
(as of 12/31/24) (as of 3/31/25)
Cash, BDP, MMFs $4,645.52 $4,692.08
Stocks 54,009.35 42,701.79
...
COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value Unrealized Gain/(Loss) Est Ann Income Current Yield %
PROGRESS SOFTWARE (PRGS) 829.000 $51.510 $19,838.49 $42,701.79 $22,863.30 $580.30 1.36
...
CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend TREASURY LIQUIDITY FUND Transaction Reportable for the Prior Year. $16.45
2/3 Dividend TREASURY LIQUIDITY FUND
DIV PAYMENT
15.85
NET CREDITS/(DEBITS) $31.30`;

        const result = parseEtradePdf(fullText);

        expect(result.openPositions).toHaveLength(1);
        expect(result.openPositions![0].symbol).toBe('PRGS');
        expect(result.interest).toHaveLength(2);
        expect(result.interest![0].amount).toBe(16.45);
        expect(result.foreignAccounts).toHaveLength(1);
        expect(result.foreignAccounts![0].amountStartOfYear).toBe(4645.52);
        expect(result.foreignAccounts![0].amountEndOfYear).toBe(4692.08);
        expect(result.foreignAccounts![0].broker).toBe('E*TRADE');
        expect(result.foreignAccounts![0].country).toBe('US');
        expect(result.foreignAccounts![0].type).toBe('03');
    });

    it('parses multiple stock holdings', () => {
        const text = `STOCKS
COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value
Unrealized
Gain/(Loss) Est Ann Income
Current
Yield %
ACME TECHNOLOGY (ACME) 1,000.000 $60.548 $25,000.00 $60,548.20 $35,548.20 $700.00 1.15
1,000.000 shs from Stock Plan; Asset Class: Equities
BETA CORP (BETA) 500.000 $120.000 $40,000.00 $60,000.00 $20,000.00 $300.00 0.50
500.000 shs from Stock Plan; Asset Class: Equities`;
        const result = parseHoldings(text);

        expect(result).toHaveLength(2);
        expect(result[0].symbol).toBe('ACME');
        expect(result[0].quantity).toBe(1000);
        expect(result[1].symbol).toBe('BETA');
        expect(result[1].quantity).toBe(500);
        expect(result[1].costPrice).toBeCloseTo(80, 0);
    });

    it('returns empty array when quantity is zero', () => {
        const text = `COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value
ZERO CORP (ZERO) 0.000 $50.000 $0.00 $0.00 $0.00 $0.00 0.00`;
        const result = parseHoldings(text);

        expect(result).toEqual([]);
    });

    it('filters out non-MMF dividends (stock dividends)', () => {
        const text = `CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend APPLE INC $50.00
1/3 Dividend TREASURY LIQUIDITY FUND $10.00
NET CREDITS/(DEBITS)`;
        const result = parseInterest(text, 2025);

        expect(result).toHaveLength(1);
        expect(result[0].description).toBe('TREASURY LIQUIDITY FUND');
        expect(result[0].amount).toBe(10.00);
    });

    it('handles activity section with no dividend entries', () => {
        const text = `CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
NET CREDITS/(DEBITS) $0.00`;
        const result = parseInterest(text, 2025);

        expect(result).toEqual([]);
    });

    it('handles statement with no stock holdings', () => {
        const text = `CLIENT STATEMENT For the Period January 1- March 31, 2025
BALANCE SHEET (^ includes accrued interest)
Last Period
(as of 12/31/24)
This Period
(as of 3/31/25)
Cash, BDP, MMFs $5,000.00 $5,050.00
CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend TREASURY LIQUIDITY FUND $10.00
NET CREDITS/(DEBITS)`;
        const result = parseEtradePdf(text);

        expect(result.openPositions).toHaveLength(0);
        expect(result.interest).toHaveLength(1);
        expect(result.foreignAccounts).toHaveLength(1);
    });
});

describe('parseDividends', () => {
    const holdingsContext = `COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value
PROGRESS SOFTWARE (PRGS) 1,603.000 $50.450 $35,896.69 $80,871.35 $44,974.66 $1,122.00 1.39`;

    it('parses equity dividends with withholding tax and resolves ticker', () => {
        const text = `${holdingsContext}
CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
3/15 Qualified Dividend PROGRESS SOFTWARE 280.53
3/15 Tax Withholding PROGRESS SOFTWARE (28.05)
NET CREDITS/(DEBITS)`;
        const nameToTicker = parseNameToTickerMap(text);
        const result = parseDividends(text, 2024, nameToTicker);

        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('PRGS');
        expect(result[0].date).toBe('2024-03-15');
        expect(result[0].grossAmount).toBe(280.53);
        expect(result[0].withholdingTax).toBe(28.05);
    });

    it('skips MMF distributions (handled by parseInterest)', () => {
        const text = `${holdingsContext}
CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend TREASURY LIQUIDITY FUND $16.45
3/15 Qualified Dividend PROGRESS SOFTWARE 280.53
NET CREDITS/(DEBITS)`;
        const nameToTicker = parseNameToTickerMap(text);
        const result = parseDividends(text, 2024, nameToTicker);

        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('PRGS');
    });

    it('handles dividend without WHT', () => {
        const text = `COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value
ACME CORP (ACME) 100.000 $50.000 $5,000.00 $5,000.00 $0.00 $0.00 0.00
CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
6/15 Qualified Dividend ACME CORP 150.00
NET CREDITS/(DEBITS)`;
        const nameToTicker = parseNameToTickerMap(text);
        const result = parseDividends(text, 2024, nameToTicker);

        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('ACME');
        expect(result[0].grossAmount).toBe(150.00);
        expect(result[0].withholdingTax).toBe(0);
    });

    it('falls back to last word when no holdings context', () => {
        const text = `CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
6/15 Qualified Dividend UNKNOWN COMPANY 50.00
NET CREDITS/(DEBITS)`;
        const result = parseDividends(text, 2024);

        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('COMPANY');
    });

    it('returns empty when no equity dividends', () => {
        const text = `CASH FLOW ACTIVITY BY DATE
Activity
Date
Settlement
Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend TREASURY LIQUIDITY FUND $16.45
NET CREDITS/(DEBITS)`;
        const result = parseDividends(text, 2024);

        expect(result).toEqual([]);
    });
});
