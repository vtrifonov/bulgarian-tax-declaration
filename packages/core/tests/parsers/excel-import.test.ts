import {
    describe,
    expect,
    it,
} from 'vitest';
import { importHoldingsFromExcel } from '../../src/parsers/excel-import.js';
import ExcelJS from 'exceljs';

describe('importHoldingsFromExcel', () => {
    it('parses holdings from Притежания sheet', async () => {
        // Create a minimal xlsx matching the app's known export format
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена', 'Общо', 'Курс', 'Общо BGN', 'Бележки']);
        ws.addRow(['IB', 'AAPL', 'САЩ', '2024-03-15', 50, 'USD', 250.42, '', '', '', '']);

        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);

        expect(holdings).toHaveLength(1);
        expect(holdings[0].symbol).toBe('AAPL');
        expect(holdings[0].quantity).toBe(50);
        expect(holdings[0].unitPrice).toBe(250.42);
        expect(holdings[0].broker).toBe('IB');
    });

    it('falls back to first sheet if Pritezhaniya is missing', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Other');
        ws.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена']);
        ws.addRow(['IB', 'GOOG', 'US', '2024-05-01', 10, 'USD', 150]);
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);
        expect(holdings).toHaveLength(1);
        expect(holdings[0].symbol).toBe('GOOG');
    });

    it('skips rows with quantity 0', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена', 'Общо', 'Курс', 'Общо BGN', 'Бележки']);
        ws.addRow(['IB', 'AAPL', 'САЩ', '2024-03-15', 50, 'USD', 250.42, '', '', '', '']);
        ws.addRow(['IB', 'MSFT', 'САЩ', '2024-04-10', 0, 'USD', 100.0, '', '', '', '']); // Quantity = 0
        ws.addRow(['IB', 'GOOGL', 'САЩ', '2024-05-20', 5, 'USD', 140.0, '', '', '', '']);

        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);

        expect(holdings).toHaveLength(2);
        expect(holdings.map(h => h.symbol)).toEqual(['AAPL', 'GOOGL']);
    });

    it('handles empty cells gracefully', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена', 'Общо', 'Курс', 'Общо BGN', 'Бележки']);
        ws.addRow(['IB', 'AAPL', 'САЩ', '2024-03-15', 50, 'USD', 250.42, '', '', '', '']); // Empty columns
        ws.addRow([undefined, 'MSFT', '', '2024-04-10', 20, 'USD', 100.0, null, null, null, undefined]); // Mixed empties, but valid quantity

        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);

        expect(holdings).toHaveLength(2);
        expect(holdings[0].symbol).toBe('AAPL');
        expect(holdings[0].broker).toBe('IB');
        expect(holdings[1].symbol).toBe('MSFT');
    });

    it('parses multiple rows correctly', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена', 'Общо', 'Курс', 'Общо BGN', 'Бележки']);
        ws.addRow(['IB', 'AAPL', 'САЩ', '2024-03-15', 50, 'USD', 250.42, '', '', '', 'First holding']);
        ws.addRow(['IB', 'CSPX', 'Ирландия', '2024-06-10', 5, 'EUR', 600.0, '', '', '', 'Second holding']);
        ws.addRow(['Revolut', 'BGN_HOLD', 'България', '2024-01-01', 1000, 'BGN', 1.0, '', '', '', '']);

        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);

        expect(holdings).toHaveLength(3);
        expect(holdings[0]).toMatchObject({
            symbol: 'AAPL',
            quantity: 50,
            unitPrice: 250.42,
            broker: 'IB',
            notes: 'First holding',
        });
        expect(holdings[1]).toMatchObject({
            symbol: 'CSPX',
            quantity: 5,
            unitPrice: 600,
            currency: 'EUR',
        });
        expect(holdings[2]).toMatchObject({
            symbol: 'BGN_HOLD',
            quantity: 1000,
            currency: 'BGN',
        });
    });

    it('recognizes English column headers', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Sheet1');
        ws.addRow(['Broker', 'Symbol', 'Country', 'Date acquired', 'Quantity', 'Currency', 'Unit price']);
        ws.addRow(['IB', 'AAPL', 'US', '2024-03-15', 50, 'USD', 250.42]);
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);
        expect(holdings).toHaveLength(1);
        expect(holdings[0].symbol).toBe('AAPL');
        expect(holdings[0].unitPrice).toBe(250.42);
    });

    it('recognizes alternative BG headers like "Ед. цена във валута" and "Брой"', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['Брокер', 'Държава', 'Символ', 'Дата на придобиване', 'Брой', 'Валута', 'Ед. цена във валута']);
        ws.addRow(['IB', 'САЩ', 'AAPL', '2024-03-15', 50, 'USD', 250.42]);
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);
        expect(holdings).toHaveLength(1);
        expect(holdings[0].unitPrice).toBe(250.42);
        expect(holdings[0].currency).toBe('USD');
    });

    it('does not confuse "Ед. цена във валута" with currency column', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['Брокер', 'Държава', 'Символ', 'Дата', 'Брой', 'Валута', 'Ед. цена във валута']);
        ws.addRow(['IB', 'САЩ', 'AAPL', '2024-03-15', 50, 'USD', 250.42]);
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);
        expect(holdings[0].currency).toBe('USD'); // "Валута" col, not price col
        expect(holdings[0].unitPrice).toBe(250.42); // "Ед. цена" col
    });

    it('throws descriptive error when headers not found', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Data');
        ws.addRow(['Col1', 'Col2', 'Col3']);
        ws.addRow([1, 2, 3]);
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        await expect(importHoldingsFromExcel(buffer)).rejects.toThrow('Could not detect column headers');
    });

    it('finds headers in row 2 when row 1 has merged cells', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['', '', '', '', '', 'Валута']); // Row 1: partial merged header
        ws.addRow(['Брокер', 'Държава', 'Символ', 'Дата', 'Количество', 'Валута', 'Цена']);
        ws.addRow(['IB', 'САЩ', 'AAPL', '2024-03-15', 50, 'USD', 250.42]);
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);
        expect(holdings).toHaveLength(1);
        expect(holdings[0].symbol).toBe('AAPL');
    });

    it('preserves notes field', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Притежания');
        ws.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена', 'Общо', 'Курс', 'Общо BGN', 'Бележки']);
        ws.addRow(['IB', 'AAPL', 'САЩ', '2024-03-15', 50, 'USD', 250.42, '', '', '', 'Inherited from parent']);
        ws.addRow(['IB', 'MSFT', 'САЩ', '2024-04-10', 20, 'USD', 120.0, '', '', '', '']);
        ws.addRow(['Revolut', 'BTC_COLD', 'България', '2023-01-01', 0.5, 'BTC', 50000, '', '', '', 'Hardware wallet since 2023']);

        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const holdings = await importHoldingsFromExcel(buffer);

        expect(holdings[0].notes).toBe('Inherited from parent');
        expect(holdings[1].notes).toBeUndefined(); // Empty notes become undefined
        expect(holdings[2].notes).toBe('Hardware wallet since 2023');
    });
});
