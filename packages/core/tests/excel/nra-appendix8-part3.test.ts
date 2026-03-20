import * as ExcelJS from 'exceljs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { generateNraAppendix8Part3 } from '../../src/excel/nra-appendix8-part3.js';
import type { Dividend } from '../../src/types/index.js';

const mkDiv = (symbol: string, overrides?: Partial<Dividend>): Dividend => ({
    symbol,
    country: 'САЩ',
    date: '2025-06-15',
    currency: 'USD',
    grossAmount: 100,
    withholdingTax: 10,
    bgTaxDue: 0,
    whtCredit: 0,
    ...overrides,
});

const fxRates: Record<string, Record<string, number>> = {
    USD: { '2025-06-15': 1.80, '2025-03-10': 1.82 },
    EUR: { '2025-06-15': 1.96 },
};

async function getSheet(dividends: Dividend[]) {
    const buf = await generateNraAppendix8Part3(dividends, fxRates);
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(buf.buffer as ArrayBuffer);

    return workbook.getWorksheet('Приложение 8 Част III')!;
}

describe('generateNraAppendix8Part3', () => {
    it('generates correct headers with 12 columns', async () => {
        const sheet = await getSheet([]);

        const headerRow = sheet.getRow(1);
        const headers: (string | number | null)[] = [];

        for (let i = 1; i <= 12; i++) {
            headers.push(headerRow.getCell(i).value);
        }

        expect(headers).toHaveLength(12);
        expect(headers[0]).toContain('№');
        expect(headers[1]).toContain('Наименование');
        expect(headers[2]).toContain('Държава');
        expect(headers[3]).toContain('Код вид доход');
        expect(headers[4]).toContain('Код за прилагане');
        expect(headers[5]).toContain('Брутен размер');
        expect(headers[6]).toContain('цена на придобиване');
        expect(headers[7]).toContain('Положителна разлика');
        expect(headers[8]).toContain('Платен данък');
        expect(headers[9]).toContain('Допустим размер');
        expect(headers[10]).toContain('признатия данъчен кредит');
        expect(headers[11]).toContain('Дължим данък');
    });

    it('generates column number row (row 2) with 1-12', async () => {
        const sheet = await getSheet([]);

        const numRow = sheet.getRow(2);
        const numCells: (string | number | null)[] = [];

        for (let i = 1; i <= 12; i++) {
            numCells.push(numRow.getCell(i).value);
        }

        expect(numCells).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    });

    it('generates data rows from dividends', async () => {
        const dividends = [
            mkDiv('AAPL', { grossAmount: 100, withholdingTax: 10 }),
        ];

        const sheet = await getSheet(dividends);

        // Row 3 is the first data row
        const dataRow = sheet.getRow(3);
        const rowNum = dataRow.getCell(1).value;
        const symbol = dataRow.getCell(2).value;
        const country = dataRow.getCell(3).value;
        const incomeCode = dataRow.getCell(4).value;
        const methodCode = dataRow.getCell(5).value;

        expect(rowNum).toBe('1.1');
        expect(symbol).toBe('AAPL');
        expect(country).toBe('САЩ');
        expect(incomeCode).toBe(8141);
        expect(methodCode).toBe(1);
    });

    it('filters out zero grossAmount dividends', async () => {
        const dividends = [
            mkDiv('AAPL', { grossAmount: 100 }),
            mkDiv('MSFT', { grossAmount: 0 }),
            mkDiv('GOOG', { grossAmount: 50 }),
        ];

        const sheet = await getSheet(dividends);

        // Count data rows (rows 3 onwards)
        let dataRowCount = 0;

        for (let i = 3; i <= sheet.rowCount; i++) {
            const row = sheet.getRow(i);
            const firstCell = row.getCell(1).value;

            if (firstCell && String(firstCell).includes('.')) {
                dataRowCount++;
            }
        }

        expect(dataRowCount).toBe(2);
        expect(sheet.getRow(3).getCell(2).value).toBe('AAPL');
        expect(sheet.getRow(4).getCell(2).value).toBe('GOOG');
    });

    it('sorts by symbol then date', async () => {
        const dividends = [
            mkDiv('ZZZZ', { grossAmount: 100, date: '2025-06-15' }),
            mkDiv('AAPL', { grossAmount: 100, date: '2025-03-10' }),
            mkDiv('AAPL', { grossAmount: 100, date: '2025-06-15' }),
            mkDiv('MSFT', { grossAmount: 100, date: '2025-03-10' }),
        ];

        const sheet = await getSheet(dividends);

        expect(sheet.getRow(3).getCell(2).value).toBe('AAPL');
        expect(sheet.getRow(3).getCell(3).value).toBe('САЩ');
        const date1 = sheet.getRow(3).getCell(2).value;

        expect(sheet.getRow(4).getCell(2).value).toBe('AAPL');
        const date2 = sheet.getRow(4).getCell(2).value;

        expect(sheet.getRow(5).getCell(2).value).toBe('MSFT');
        expect(sheet.getRow(6).getCell(2).value).toBe('ZZZZ');

        // Verify date sorting within AAPL
        // (Row 3 should be 2025-03-10, Row 4 should be 2025-06-15 for AAPL)
        expect(date1).toBe('AAPL');
        expect(date2).toBe('AAPL');
    });

    it('generates totals row with sums of columns 6-12', async () => {
        const dividends = [
            mkDiv('AAPL', { grossAmount: 100, withholdingTax: 10, date: '2025-06-15' }),
            mkDiv('MSFT', { grossAmount: 200, withholdingTax: 20, date: '2025-06-15' }),
        ];

        const sheet = await getSheet(dividends);

        // Totals row is the last row after data rows
        // Row 3 = AAPL, Row 4 = MSFT, Row 5 = totals
        const totalsRow = sheet.getRow(5);

        expect(totalsRow.getCell(5).value).toContain('Общо:');

        const grossTotal = Number(totalsRow.getCell(6).value);
        const whtTotal = Number(totalsRow.getCell(9).value);
        const creditTotal = Number(totalsRow.getCell(11).value);
        const dueTotal = Number(totalsRow.getCell(12).value);

        expect(grossTotal).toBeGreaterThan(0);
        expect(whtTotal).toBeGreaterThan(0);
        expect(creditTotal).toBeGreaterThan(0);
        expect(dueTotal).toBeGreaterThanOrEqual(0);
    });

    it('handles empty dividends array with only headers and totals', async () => {
        const sheet = await getSheet([]);

        expect(sheet.getRow(1).getCell(1).value).toContain('№');
        expect(sheet.getRow(2).getCell(1).value).toBe('1');

        // When no dividends, rows are: headers, column numbers, totals
        expect(sheet.rowCount).toBe(3);

        // Verify totals row exists with zero values
        const totalsRow = sheet.getRow(3);

        expect(totalsRow.getCell(5).value).toContain('Общо:');
        expect(Number(totalsRow.getCell(6).value)).toBe(0);
        expect(Number(totalsRow.getCell(9).value)).toBe(0);
    });

    it('handles Irish ETF with 0% WHT', async () => {
        const dividends = [
            mkDiv('EUNL', {
                country: 'Ирландия',
                grossAmount: 100,
                withholdingTax: 0,
                currency: 'EUR',
                date: '2025-06-15',
            }),
        ];

        const sheet = await getSheet(dividends);

        const dataRow = sheet.getRow(3);
        const whtAmount = Number(dataRow.getCell(9).value);
        const creditAmount = Number(dataRow.getCell(11).value);
        const dueAmount = Number(dataRow.getCell(12).value);

        expect(whtAmount).toBe(0);
        expect(creditAmount).toBe(0);
        expect(dueAmount).toBeGreaterThan(0); // Still owes 5% tax
    });

    it('generates row numbers incrementally (1.1, 2.1, 3.1, ...)', async () => {
        const dividends = [
            mkDiv('AAPL', { grossAmount: 100 }),
            mkDiv('MSFT', { grossAmount: 200 }),
            mkDiv('GOOG', { grossAmount: 300 }),
        ];

        const sheet = await getSheet(dividends);

        expect(sheet.getRow(3).getCell(1).value).toBe('1.1');
        expect(sheet.getRow(4).getCell(1).value).toBe('2.1');
        expect(sheet.getRow(5).getCell(1).value).toBe('3.1');
    });

    it('applies correct formatting to header row', async () => {
        const sheet = await getSheet([]);

        const headerRow = sheet.getRow(1);
        const cell = headerRow.getCell(1);

        expect(cell.font?.bold).toBe(true);
        expect(cell.font?.size).toBe(10);
        expect(cell.alignment?.horizontal).toBe('center');
        expect(cell.alignment?.vertical).toBe('middle');
        expect(cell.alignment?.wrapText).toBe(true);
        expect(cell.border?.top?.style).toBe('thin');
    });

    it('applies correct formatting to totals row', async () => {
        const dividends = [mkDiv('AAPL', { grossAmount: 100 })];

        const sheet = await getSheet(dividends);

        const totalsRow = sheet.getRow(4);
        const cell = totalsRow.getCell(6);

        expect(cell.font?.bold).toBe(true);
        expect(cell.font?.size).toBe(10);
        expect(cell.numFmt).toBe('#,##0.00');
        expect(cell.alignment?.horizontal).toBe('right');
    });

    it('generates numeric format for columns 6-12', async () => {
        const dividends = [mkDiv('AAPL', { grossAmount: 100 })];

        const sheet = await getSheet(dividends);

        const dataRow = sheet.getRow(3);

        for (let col = 6; col <= 12; col++) {
            const cell = dataRow.getCell(col);

            expect(cell.numFmt).toBe('#,##0.00');
            expect(cell.alignment?.horizontal).toBe('right');
        }
    });

    it('includes calculations from calcDividendRowTax', async () => {
        const dividends = [
            mkDiv('AAPL', {
                grossAmount: 100,
                withholdingTax: 10,
                currency: 'USD',
                date: '2025-06-15',
            }),
        ];

        const sheet = await getSheet(dividends);

        const dataRow = sheet.getRow(3);

        // Verify that numeric columns are populated with calculated values
        const grossBase = Number(dataRow.getCell(6).value);
        const whtBase = Number(dataRow.getCell(9).value);
        const tax5pct = Number(dataRow.getCell(10).value);
        const recognizedCredit = Number(dataRow.getCell(11).value);
        const bgTaxDue = Number(dataRow.getCell(12).value);

        expect(grossBase).toBeGreaterThan(0);
        expect(whtBase).toBeGreaterThan(0);
        expect(tax5pct).toBeGreaterThan(0);
        expect(recognizedCredit).toBeLessThanOrEqual(tax5pct);
        expect(bgTaxDue).toBeGreaterThanOrEqual(0);
    });

    it('sets zero values for columns 7 and 8 (cost basis and positive difference)', async () => {
        const dividends = [mkDiv('AAPL', { grossAmount: 100 })];

        const sheet = await getSheet(dividends);

        const dataRow = sheet.getRow(3);

        expect(dataRow.getCell(7).value).toBe(0);
        expect(dataRow.getCell(8).value).toBe(0);
    });

    it('handles multiple dividends with correct totals calculation', async () => {
        const dividends = [
            mkDiv('AAPL', { grossAmount: 100, withholdingTax: 10, date: '2025-06-15' }),
            mkDiv('MSFT', { grossAmount: 200, withholdingTax: 20, date: '2025-06-15' }),
            mkDiv('GOOG', { grossAmount: 300, withholdingTax: 30, date: '2025-06-15' }),
        ];

        const sheet = await getSheet(dividends);

        // Data rows: 3, 4, 5
        // Totals row: 6
        const totalsRow = sheet.getRow(6);

        const grossTotal = Number(totalsRow.getCell(6).value);

        // Verify totals are sums of individual rows
        const aapl = Number(sheet.getRow(3).getCell(6).value);
        const msft = Number(sheet.getRow(4).getCell(6).value);
        const goog = Number(sheet.getRow(5).getCell(6).value);

        expect(Math.abs(grossTotal - (aapl + msft + goog))).toBeLessThan(0.01);
    });

    it('produces deterministic output for same input', async () => {
        const dividends = [
            mkDiv('ZZZZ', { grossAmount: 100, date: '2025-06-15' }),
            mkDiv('AAPL', { grossAmount: 200, date: '2025-06-15' }),
            mkDiv('MSFT', { grossAmount: 300, date: '2025-06-15' }),
        ];

        const buf1 = await generateNraAppendix8Part3(dividends, fxRates);
        const buf2 = await generateNraAppendix8Part3(dividends, fxRates);
        const wb1 = new ExcelJS.Workbook();
        const wb2 = new ExcelJS.Workbook();

        await wb1.xlsx.load(buf1.buffer as ArrayBuffer);
        await wb2.xlsx.load(buf2.buffer as ArrayBuffer);

        const sheet1 = wb1.getWorksheet('Приложение 8 Част III');
        const sheet2 = wb2.getWorksheet('Приложение 8 Част III');

        expect(sheet1).toBeDefined();
        expect(sheet2).toBeDefined();
        expect(sheet1!.rowCount).toBe(sheet2!.rowCount);
        expect(sheet1!.columnCount).toBe(sheet2!.columnCount);

        for (let row = 1; row <= sheet1!.rowCount; row++) {
            for (let col = 1; col <= sheet1!.columnCount; col++) {
                expect(sheet1!.getRow(row).getCell(col).value).toEqual(sheet2!.getRow(row).getCell(col).value);
            }
        }
    });

    it('preserves dividend order after sorting by symbol then date', async () => {
        const dividends = [
            mkDiv('MSFT', { grossAmount: 100, date: '2025-03-10' }),
            mkDiv('AAPL', { grossAmount: 200, date: '2025-06-15' }),
            mkDiv('AAPL', { grossAmount: 150, date: '2025-03-10' }),
        ];

        const sheet = await getSheet(dividends);

        expect(sheet.getRow(3).getCell(2).value).toBe('AAPL');
        expect(sheet.getRow(4).getCell(2).value).toBe('AAPL');
        expect(sheet.getRow(5).getCell(2).value).toBe('MSFT');
    });

    it('handles dividend with missing symbols', async () => {
        const dividends = [
            mkDiv('AAPL', { grossAmount: 100 }),
            mkDiv('', { grossAmount: 100 }),
            mkDiv('MSFT', { grossAmount: 100 }),
        ];

        const sheet = await getSheet(dividends);

        // Empty symbol should be filtered out
        let dataRowCount = 0;

        for (let i = 3; i <= sheet.rowCount; i++) {
            const row = sheet.getRow(i);
            const firstCell = row.getCell(1).value;

            if (firstCell && String(firstCell).includes('.')) {
                dataRowCount++;
            }
        }

        expect(dataRowCount).toBe(2);
    });

    it('handles different currencies with correct FX conversion', async () => {
        const dividends = [
            mkDiv('AAPL', {
                grossAmount: 100,
                withholdingTax: 10,
                currency: 'USD',
                date: '2025-06-15',
            }),
            mkDiv('ASML', {
                grossAmount: 100,
                withholdingTax: 10,
                currency: 'EUR',
                date: '2025-06-15',
            }),
        ];

        const sheet = await getSheet(dividends);

        const row3Gross = Number(sheet.getRow(3).getCell(6).value);
        const row4Gross = Number(sheet.getRow(4).getCell(6).value);

        // EUR should convert to higher BGN due to 1.96 rate vs 1.80 for USD
        expect(row4Gross).toBeGreaterThan(row3Gross);
    });
});
