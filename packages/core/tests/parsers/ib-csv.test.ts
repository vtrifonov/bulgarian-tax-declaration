import {
    describe,
    expect,
    it,
} from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIBCsv } from '../../src/parsers/ib-csv.js';

const fixture = readFileSync(join(__dirname, '../fixtures/ib-minimal.csv'), 'utf-8');

describe('parseIBCsv', () => {
    const result = parseIBCsv(fixture);

    it('parses trades', () => {
        expect(result.trades).toHaveLength(3); // 1 EUR buy + 1 USD buy + 1 USD sell
        const buy = result.trades.find(t => t.symbol === 'CSPX');
        expect(buy).toBeDefined();
        expect(buy!.quantity).toBe(1);
        expect(buy!.price).toBe(614.28);
        expect(buy!.currency).toBe('EUR');
    });

    it('distinguishes buys from sells', () => {
        const sell = result.trades.find(t => t.quantity < 0);
        expect(sell).toBeDefined();
        expect(sell!.symbol).toBe('AAPL');
        expect(sell!.quantity).toBe(-5);
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
});
