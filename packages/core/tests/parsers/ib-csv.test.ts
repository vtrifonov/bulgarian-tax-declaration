import { readFileSync } from 'fs';
import { join } from 'path';

import {
    describe,
    expect,
    it,
} from 'vitest';

import { parseIBCsv } from '../../src/parsers/ib-csv.js';

const fixture = readFileSync(join(__dirname, '../fixtures/ib-minimal.csv'), 'utf-8');

describe('parseIBCsv', () => {
    const result = parseIBCsv(fixture);

    it('parses trades', () => {
        expect(result.trades).toHaveLength(3); // 1 EUR buy + 1 USD buy + 1 USD sell
        const buy = result.trades.find(t => t.symbol === 'SXR8'); // CSPX normalized to SXR8 via alias

        expect(buy).toBeDefined();
        expect(buy!.quantity).toBe(1);
        expect(buy!.price).toBe(614.28);
        expect(buy!.currency).toBe('EUR');
        expect(buy!.exchange).toBe('IBIS2');
        expect(buy!.saleTaxClassification).toBe('eu-regulated-market');
    });

    it('distinguishes buys from sells', () => {
        const sell = result.trades.find(t => t.quantity < 0);

        expect(sell).toBeDefined();
        expect(sell!.symbol).toBe('AAPL');
        expect(sell!.quantity).toBe(-5);
        expect(sell!.exchange).toBe('NASDAQ');
        expect(sell!.saleTaxClassification).toBe('taxable');
    });

    it('parses dividends and combines same-date BABA entries', () => {
        const baba = result.dividends.filter(d => d.symbol === 'BABA');

        // BABA has ordinary + bonus on same date — should be combined into one entry
        expect(baba).toHaveLength(1);
        expect(baba[0].amount).toBeCloseTo(20.00); // 10.50 + 9.50
    });

    it('nets ASML reversal', () => {
        const asml = result.dividends.filter(d => d.symbol === 'ASML');

        expect(asml).toHaveLength(1);
        expect(asml[0].amount).toBeCloseTo(10.64); // 10.64 - 10.64 + 10.64
    });

    it('parses BOTH withholding tax sections', () => {
        // EUR section has ASML, USD section has AAPL + MSFT + prior-year VCLT adjustments
        const eurWht = result.withholdingTax.filter(w => w.currency === 'EUR');
        const usdWht = result.withholdingTax.filter(w => w.currency === 'USD');

        expect(eurWht.length).toBeGreaterThan(0);
        expect(usdWht.length).toBeGreaterThan(0);
    });

    it('includes prior-year WHT adjustments', () => {
        const priorYear = result.withholdingTax.filter(w => w.date.startsWith('2024'));

        expect(priorYear.length).toBeGreaterThan(0);
    });

    it('parses stock yield entries', () => {
        expect(result.stockYield.length).toBeGreaterThan(0);
        expect(result.stockYield[0].symbol).toBe('ISPAd');
    });

    it('parses open positions', () => {
        expect(result.openPositions).toHaveLength(2);
        const sxr8 = result.openPositions.find(p => p.symbol === 'SXR8');

        expect(sxr8).toBeDefined();
        expect(sxr8!.currency).toBe('EUR');
        expect(sxr8!.quantity).toBe(1);
        expect(sxr8!.costPrice).toBe(614.28);
        const aapl = result.openPositions.find(p => p.symbol === 'AAPL');

        expect(aapl).toBeDefined();
        expect(aapl!.currency).toBe('USD');
        expect(aapl!.quantity).toBe(10);
    });

    it('skips Total rows in open positions', () => {
        expect(result.openPositions.every(p => p.symbol !== '')).toBe(true);
    });

    it('builds symbol aliases from Financial Instrument Information', () => {
        expect(result.symbolAliases['CSPX']).toBe('SXR8');
    });

    it('normalizes trade symbols using aliases', () => {
        // CSPX trade should be normalized to SXR8
        const sxr8Trade = result.trades.find(t => t.symbol === 'SXR8');

        expect(sxr8Trade).toBeDefined();
        expect(result.trades.find(t => t.symbol === 'CSPX')).toBeUndefined();
    });

    it('extracts symbol from dividend description', () => {
        const msft = result.dividends.find(d => d.symbol === 'MSFT');

        expect(msft).toBeDefined();
        expect(msft!.amount).toBe(166.00);
    });

    it('stops parsing section at Total line', () => {
        // Should not include Total rows as data
        const totalTrades = result.trades.filter(t => t.symbol === '');

        expect(totalTrades).toHaveLength(0);
    });

    it('empty CSV returns empty arrays', () => {
        const emptyResult = parseIBCsv('');

        expect(emptyResult.trades).toHaveLength(0);
        expect(emptyResult.dividends).toHaveLength(0);
        expect(emptyResult.withholdingTax).toHaveLength(0);
        expect(emptyResult.stockYield).toHaveLength(0);
    });

    it('handles Payment in Lieu dividend descriptions', () => {
        // Test data with Payment in Lieu entries
        const csvWithPaymentInLieu = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2025-03-15,VCLT(US92206C8139) Payment in Lieu of Dividend USD 0.50,50.00
Dividends,Data,Total,,,50.00`;

        const result = parseIBCsv(csvWithPaymentInLieu);
        const paymentInLieu = result.dividends.find(d => d.symbol === 'VCLT');

        expect(paymentInLieu).toBeDefined();
        expect(paymentInLieu!.amount).toBe(50.00);
    });

    it('parses Inter-Company transfer In as synthetic buy trade', () => {
        const csvWithTransfer = `Statement,Header,Field Name,Field Value
Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code
Transfers,Data,Stocks,USD,AAPL,2024-08-30,Inter-Company,In,--,U7069264,50,--,"11,489.50",0.00,0.00,`;
        const result = parseIBCsv(csvWithTransfer);

        expect(result.trades).toHaveLength(1);
        expect(result.trades[0].symbol).toBe('AAPL');
        expect(result.trades[0].currency).toBe('USD');
        expect(result.trades[0].quantity).toBe(50);
        expect(result.trades[0].dateTime).toBe(''); // Empty — user fills in
        expect(result.trades[0].price).toBe(0); // Empty — user fills in
    });

    it('skips transfer Out rows', () => {
        const csvWithOut = `Statement,Header,Field Name,Field Value
Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code
Transfers,Data,Stocks,USD,AAPL,2024-08-30,Inter-Company,Out,--,U7069264,50,--,"11,489.50",0.00,0.00,`;
        const result = parseIBCsv(csvWithOut);

        expect(result.trades).toHaveLength(0);
    });

    it('parses transfer with comma-formatted quantity', () => {
        const csvComma = `Statement,Header,Field Name,Field Value
Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code
Transfers,Data,Stocks,EUR,LHAd,2024-08-30,Inter-Company,In,--,U7069264,"1,000",--,"5,888.00",0.00,0.00,`;
        const result = parseIBCsv(csvComma);

        expect(result.trades).toHaveLength(1);
        expect(result.trades[0].quantity).toBe(1000);
    });

    it('skips transfer with invalid quantity', () => {
        const csvBad = `Statement,Header,Field Name,Field Value
Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code
Transfers,Data,Stocks,USD,AAPL,2024-08-30,Inter-Company,In,--,U7069264,N/A,--,0,0.00,0.00,`;
        const result = parseIBCsv(csvBad);

        expect(result.trades).toHaveLength(0);
    });

    it('parses forex trades section without crashing (ignores non-Stocks trades)', () => {
        // Test data with Forex section that should be ignored (only Stocks trades matter)
        const csvWithForex = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,AAPL,"2025-01-15, 10:00:00",10,150.00,150.00,-1500.00,-1.00,1501.00,0,0,O
Trades,Data,Order,Forex,USD,EUR,"2025-01-20, 11:00:00",1000,-1.05,1.05,-1050.00,-5.00,-1050.00,0,0,O
Trades,Total,,Stocks,USD,,,,,,-1500.00,-1.00,1501.00,0,0,
Trades,Total,,Forex,USD,,,,,,-1050.00,-5.00,-1050.00,0,0,`;

        const result = parseIBCsv(csvWithForex);

        // Should only parse Stocks trades, not Forex
        expect(result.trades).toHaveLength(1);
        expect(result.trades[0].symbol).toBe('AAPL');
    });

    it('parses basis field from IB trade rows', () => {
        const csv = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,MSFT,"2025-02-10, 09:30:00",-5,300.00,300.00,1500.00,-1.00,-1200.00,299.00,0,C`;

        const result = parseIBCsv(csv);

        expect(result.trades).toHaveLength(1);
        expect(result.trades[0].basis).toBe(-1200.00);
    });

    it('skips Open Position with quantity=0', () => {
        const csv = `Statement,Header,Field Name,Field Value
Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,USD,CLOSED,0,1,100.00,0,0,0,0,`;
        const result = parseIBCsv(csv);

        expect(result.openPositions).toHaveLength(0);
    });

    it('skips Open Position with negative quantity', () => {
        const csv = `Statement,Header,Field Name,Field Value
Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,USD,SHORT,-10,1,100.00,-1000.00,95.00,-950.00,50.00,`;
        const result = parseIBCsv(csv);

        expect(result.openPositions).toHaveLength(0);
    });

    it('accepts Open Position with costPrice=0', () => {
        const csv = `Statement,Header,Field Name,Field Value
Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,USD,FREE,5,1,0,0,10.00,50.00,50.00,`;
        const result = parseIBCsv(csv);

        expect(result.openPositions).toHaveLength(1);
        expect(result.openPositions[0].costPrice).toBe(0);
    });

    it('handles interest row with truncated fields', () => {
        const csv = `Statement,Header,Field Name,Field Value
Interest,Header,Currency,Date,Description,Amount
Interest,Data,USD,2025-01-06`;
        const result = parseIBCsv(csv);

        expect(result.interest).toHaveLength(0); // skipped due to NaN amount
    });

    it('returns empty symbolAliases when no Financial Instrument Information', () => {
        const csv = `Statement,Header,Field Name,Field Value
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,AAPL,"2025-01-15, 10:00:00",10,150.00,150.00,-1500.00,-1.00`;
        const result = parseIBCsv(csv);

        expect(Object.keys(result.symbolAliases)).toHaveLength(0);
    });

    it('alias resolution: sold symbol not in Open Positions gets no alias', () => {
        const csv = `Statement,Header,Field Name,Field Value
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,EUR,CSPX,"2025-01-21, 10:26:07",1,614.28,614.38,-614.28,-1.25
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Type,Code
Financial Instrument Information,Data,Stocks,"CSPX, SXR8",ISHARES CORE S&P 500,75776072,IE00B5BMR087,SXR8,IBIS2,1,ETF,`;
        // No Open Positions for SXR8 → alias uses primarySymbol (field[7]=SXR8)
        const result = parseIBCsv(csv);

        expect(result.symbolAliases['CSPX']).toBe('SXR8');
        expect(result.trades[0].symbol).toBe('SXR8');
    });
});
