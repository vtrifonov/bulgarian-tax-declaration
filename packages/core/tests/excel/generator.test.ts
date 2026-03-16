import {
    describe,
    expect,
    it,
} from 'vitest';
import ExcelJS from 'exceljs';
import { generateExcel } from '../../src/excel/generator.js';
import type { AppState } from '../../src/types/index.js';

describe('Excel Generator', () => {
    it('generates Excel with correct structure', async () => {
        // Create minimal AppState with sample data
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [
                {
                    id: '1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.0,
                    notes: 'Test holding',
                },
                {
                    id: '2',
                    broker: 'IB',
                    country: 'Ирландия',
                    symbol: 'CSPX',
                    dateAcquired: '2024-06-10',
                    quantity: 5,
                    currency: 'EUR',
                    unitPrice: 600.0,
                    notes: '',
                },
            ],
            sales: [
                {
                    id: '1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'MSFT',
                    dateAcquired: '2023-01-10',
                    dateSold: '2025-05-20',
                    quantity: 2,
                    currency: 'USD',
                    buyPrice: 100.0,
                    sellPrice: 250.0,
                    fxRateBuy: 1.82,
                    fxRateSell: 1.95583,
                },
            ],
            dividends: [
                {
                    symbol: 'AAPL',
                    country: 'САЩ',
                    date: '2025-02-10',
                    currency: 'USD',
                    grossAmount: 50.0,
                    withholdingTax: 5.0,
                    bgTaxDue: 2.5,
                    whtCredit: 5.0,
                    notes: 'Q1 dividend',
                },
                {
                    symbol: 'BABA',
                    country: 'Хонконг',
                    date: '2025-03-15',
                    currency: 'USD',
                    grossAmount: 100.0,
                    withholdingTax: 0.0,
                    bgTaxDue: 5.0,
                    whtCredit: 0.0,
                    notes: '',
                },
            ],
            stockYield: [
                {
                    date: '2025-02-15',
                    symbol: 'AAPL',
                    currency: 'USD',
                    amount: 10.5,
                },
            ],
            ibInterest: [],
            revolutInterest: [
                {
                    currency: 'EUR',
                    entries: [
                        {
                            date: '2025-03-01',
                            description: 'Interest PAID',
                            amount: 5.0,
                        },
                        {
                            date: '2025-03-15',
                            description: 'Service Fee Charged',
                            amount: -1.0,
                        },
                    ],
                },
                {
                    currency: 'USD',
                    entries: [
                        {
                            date: '2025-02-28',
                            description: 'Interest PAID',
                            amount: 3.5,
                        },
                    ],
                },
            ],
            fxRates: {
                USD: {
                    '2024-01-15': 1.82,
                    '2025-02-10': 1.9,
                    '2025-05-20': 1.95583,
                },
                EUR: {
                    '2024-06-10': 1.95583,
                },
            },
            ibInterest: [],
            manualEntries: [],
        };

        // Generate Excel
        const buffer = await generateExcel(state);

        // Read back with exceljs
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        // Verify sheet names exist
        const sheetNames = workbook.worksheets.map((ws) => ws.name);
        expect(sheetNames).toContain('USD');
        // EUR/BGN is fixed rate — no FX sheet needed
        expect(sheetNames).toContain('Притежания');
        expect(sheetNames).toContain('Продажби');
        expect(sheetNames).toContain('Дивиденти');
        expect(sheetNames).toContain('IB Stock Yield');
        expect(sheetNames).toContain('Revolut Лихва');
        expect(sheetNames).toContain('Revolut EUR');
        expect(sheetNames).toContain('Revolut USD');

        // Verify Holdings sheet structure
        const holdingsSheet = workbook.getWorksheet('Притежания');
        expect(holdingsSheet).toBeDefined();
        expect(holdingsSheet!.rowCount).toBeGreaterThan(1); // Header + data rows

        const headerRow = holdingsSheet!.getRow(1);
        expect(headerRow.getCell(1).value).toBe('Брокер');
        expect(headerRow.getCell(2).value).toBe('Символ');
        expect(headerRow.getCell(3).value).toBe('Държава');
        expect(headerRow.getCell(4).value).toBe('Дата на придобиване');

        // Verify at least one formula is present
        const dataRow = holdingsSheet!.getRow(2);
        const formulaCell = dataRow.getCell(9); // Курс column
        expect(formulaCell.value).toBeDefined();
        // Should contain formula (either simple like "1", "1.95583" or a VLOOKUP)
        const cellValue = String(formulaCell.value);
        expect(cellValue.length).toBeGreaterThan(0);

        // Verify Sales sheet
        const salesSheet = workbook.getWorksheet('Продажби');
        expect(salesSheet).toBeDefined();
        expect(salesSheet!.rowCount).toBeGreaterThan(1);

        const salesHeader = salesSheet!.getRow(1);
        expect(salesHeader.getCell(1).value).toBe('Брокер');
        expect(salesHeader.getCell(4).value).toBe('Дата покупка');

        // Check for formula in sales data
        const salesDataRow = salesSheet!.getRow(2);
        const salesFormula = salesDataRow.getCell(12); // Приходи
        expect(salesFormula.value).toBeDefined();

        // Verify Dividends sheet
        const dividendsSheet = workbook.getWorksheet('Дивиденти');
        expect(dividendsSheet).toBeDefined();
        expect(dividendsSheet!.rowCount).toBeGreaterThan(1);

        const divHeader = dividendsSheet!.getRow(1);
        expect(divHeader.getCell(1).value).toBe('Символ');
        expect(divHeader.getCell(3).value).toBe('Дата');

        // Verify Stock Yield sheet
        const stockYieldSheet = workbook.getWorksheet('IB Stock Yield');
        expect(stockYieldSheet).toBeDefined();
        expect(stockYieldSheet!.rowCount).toBeGreaterThan(1);

        const syHeader = stockYieldSheet!.getRow(1);
        expect(syHeader.getCell(1).value).toBe('Дата');
        expect(syHeader.getCell(2).value).toBe('Символ');

        // Verify FX sheets
        const usdSheet = workbook.getWorksheet('USD');
        expect(usdSheet).toBeDefined();

        // EUR/BGN fixed rate — no EUR FX sheet

        // Verify Revolut sheets
        const revolutSummary = workbook.getWorksheet('Revolut Лихва');
        expect(revolutSummary).toBeDefined();
        expect(revolutSummary!.rowCount).toBeGreaterThan(1);

        const revHeader = revolutSummary!.getRow(1);
        expect(revHeader.getCell(1).value).toBe('Валута');
        expect(revHeader.getCell(2).value).toBe('Записи');
    });

    it('generates Excel with EUR base currency', async () => {
        const state: AppState = {
            taxYear: 2026,
            baseCurrency: 'EUR',
            language: 'bg',
            holdings: [
                {
                    id: '1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.0,
                    notes: '',
                },
            ],
            sales: [],
            dividends: [],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [],
            fxRates: {
                USD: {
                    '2024-01-15': 0.92,
                },
            },
            ibInterest: [],
            manualEntries: [],
        };

        const buffer = await generateExcel(state);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const holdingsSheet = workbook.getWorksheet('Притежания');
        const headerRow = holdingsSheet!.getRow(1);
        let foundEurColumn = false;
        headerRow.eachCell((cell) => {
            if (cell.value === 'Общо (EUR)') {
                foundEurColumn = true;
            }
        });
        expect(foundEurColumn).toBe(true);
    });

    it('dividends sheet has rows ordered by symbol then date', async () => {
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [],
            sales: [],
            dividends: [
                { symbol: 'ZZZZ', country: 'САЩ', date: '2025-01-10', currency: 'USD', grossAmount: 10, withholdingTax: 1, bgTaxDue: 1, whtCredit: 1, notes: '' },
                { symbol: 'AAPL', country: 'САЩ', date: '2025-02-10', currency: 'USD', grossAmount: 50, withholdingTax: 5, bgTaxDue: 2.5, whtCredit: 5, notes: '' },
                { symbol: 'AAPL', country: 'САЩ', date: '2025-01-10', currency: 'USD', grossAmount: 25, withholdingTax: 2, bgTaxDue: 1.5, whtCredit: 2, notes: '' },
            ],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [],
            fxRates: { USD: { '2025-01-10': 1.9, '2025-02-10': 1.95 } },
            ibInterest: [],
            manualEntries: [],
        };

        const buffer = await generateExcel(state);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const dividendsSheet = workbook.getWorksheet('Дивиденти');
        expect(dividendsSheet).toBeDefined();

        // Get symbols from data rows (skip header)
        const symbols: string[] = [];
        const dates: string[] = [];
        for (let i = 2; i <= dividendsSheet!.rowCount; i++) {
            const symbol = dividendsSheet!.getRow(i).getCell(1).value;
            const date = dividendsSheet!.getRow(i).getCell(3).value;
            if (symbol) {
                symbols.push(String(symbol));
                dates.push(String(date));
            }
        }

        // Check ordering: AAPL entries first (2025-01-10, then 2025-02-10), then ZZZZ
        expect(symbols).toEqual(['AAPL', 'AAPL', 'ZZZZ']);
        expect(dates).toEqual(['2025-01-10', '2025-02-10', '2025-01-10']);
    });

    it('sales sheet has correct column headers', async () => {
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [],
            sales: [
                {
                    id: '1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'MSFT',
                    dateAcquired: '2023-01-10',
                    dateSold: '2025-05-20',
                    quantity: 2,
                    currency: 'USD',
                    buyPrice: 100,
                    sellPrice: 250,
                    fxRateBuy: 1.82,
                    fxRateSell: 1.95,
                },
            ],
            dividends: [],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [],
            fxRates: {},
            ibInterest: [],
            manualEntries: [],
        };

        const buffer = await generateExcel(state);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const salesSheet = workbook.getWorksheet('Продажби');
        const headerRow = salesSheet!.getRow(1);

        const expectedHeaders = [
            'Брокер',
            'Символ',
            'Държава',
            'Дата покупка',
            'Дата продажба',
            'Кол.',
            'Валута',
            'Цена покупка',
            'Цена продажба',
            'Курс покупка',
            'Курс продажба',
            'Приходи (BGN)',
            'Разходи (BGN)',
            'Печалба/Загуба (BGN)',
        ];

        expectedHeaders.forEach((header, index) => {
            expect(headerRow.getCell(index + 1).value).toBe(header);
        });
    });

    it('FX rate sheet has dates and rates', async () => {
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [
                {
                    id: '1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'AAPL',
                    dateAcquired: '2025-01-15',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.0,
                    notes: '',
                },
            ],
            sales: [],
            dividends: [],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [],
            fxRates: {
                USD: {
                    '2025-01-15': 1.82,
                    '2025-02-20': 1.90,
                    '2025-03-10': 1.95,
                },
            },
            ibInterest: [],
            manualEntries: [],
        };

        const buffer = await generateExcel(state);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const usdSheet = workbook.getWorksheet('USD');
        expect(usdSheet).toBeDefined();

        const headerRow = usdSheet!.getRow(1);
        expect(headerRow.getCell(1).value).toBe('Дата');
        expect(headerRow.getCell(2).value).toBe('Курс');

        // Check data rows
        const dates: string[] = [];
        const rates: number[] = [];
        for (let i = 2; i <= usdSheet!.rowCount; i++) {
            const date = usdSheet!.getRow(i).getCell(1).value;
            const rate = usdSheet!.getRow(i).getCell(2).value;
            if (date && rate) {
                dates.push(String(date));
                rates.push(Number(rate));
            }
        }

        expect(dates.length).toBe(3);
        expect(rates).toContain(1.82);
        expect(rates).toContain(1.90);
        expect(rates).toContain(1.95);
    });

    it('revolut detail sheets exist per currency', async () => {
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [],
            sales: [],
            dividends: [],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [
                {
                    currency: 'EUR',
                    entries: [
                        { date: '2025-01-01', description: 'Interest PAID', amount: 5.0 },
                    ],
                },
                {
                    currency: 'GBP',
                    entries: [
                        { date: '2025-02-01', description: 'Interest PAID', amount: 3.0 },
                    ],
                },
            ],
            fxRates: {},
            ibInterest: [],
            manualEntries: [],
        };

        const buffer = await generateExcel(state);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        // Check summary sheet exists
        const summarySheet = workbook.getWorksheet('Revolut Лихва');
        expect(summarySheet).toBeDefined();

        // Check detail sheets exist
        const eurSheet = workbook.getWorksheet('Revolut EUR');
        const gbpSheet = workbook.getWorksheet('Revolut GBP');
        expect(eurSheet).toBeDefined();
        expect(gbpSheet).toBeDefined();

        // Check detail sheet headers
        const eurDetailHeaders = eurSheet!.getRow(1);
        expect(eurDetailHeaders.getCell(1).value).toBe('Дата');
        expect(eurDetailHeaders.getCell(2).value).toBe('Описание');
        expect(eurDetailHeaders.getCell(3).value).toBe('Размер');
    });

    it('holdings sheet formulas exist (VLOOKUP or ROUND)', async () => {
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [
                {
                    id: '1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-15',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.0,
                    notes: 'Test',
                },
            ],
            sales: [],
            dividends: [],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [],
            fxRates: { USD: { '2024-01-15': 1.82 } },
            ibInterest: [],
            manualEntries: [],
        };

        const buffer = await generateExcel(state);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const holdingsSheet = workbook.getWorksheet('Притежания');
        const dataRow = holdingsSheet!.getRow(2);

        // Check column H (Общо = Qty * Price) has formula
        const totalCell = dataRow.getCell(8);
        expect(totalCell.value).toBeDefined();
        const totalFormula = typeof totalCell.value === 'object' && totalCell.value !== null && 'formula' in totalCell.value
            ? (totalCell.value as { formula: string }).formula
            : String(totalCell.value);
        expect(totalFormula).toContain('ROUND');

        // Check column J (Total in base currency) has formula
        const totalBaseCell = dataRow.getCell(10);
        expect(totalBaseCell.value).toBeDefined();
        const totalBaseFormula = typeof totalBaseCell.value === 'object' && totalBaseCell.value !== null && 'formula' in totalBaseCell.value
            ? (totalBaseCell.value as { formula: string }).formula
            : String(totalBaseCell.value);
        expect(totalBaseFormula).toContain('ROUND');
    });

    it('empty state generates valid Excel with headers', async () => {
        const state: AppState = {
            taxYear: 2025,
            baseCurrency: 'BGN',
            language: 'bg',
            holdings: [],
            sales: [],
            dividends: [],
            stockYield: [],
            ibInterest: [],
            revolutInterest: [],
            fxRates: {},
            ibInterest: [],
            manualEntries: [],
        };

        const buffer = await generateExcel(state);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        // Check that all main sheets exist with headers
        const holdingsSheet = workbook.getWorksheet('Притежания');
        const salesSheet = workbook.getWorksheet('Продажби');
        const dividendsSheet = workbook.getWorksheet('Дивиденти');

        expect(holdingsSheet).toBeDefined();
        expect(salesSheet).toBeDefined();
        expect(dividendsSheet).toBeDefined();

        // Each should have at least the header row
        expect(holdingsSheet!.rowCount).toBeGreaterThanOrEqual(1);
        expect(salesSheet!.rowCount).toBeGreaterThanOrEqual(1);
        expect(dividendsSheet!.rowCount).toBeGreaterThanOrEqual(1);

        // Check header row exists
        const holdingsHeader = holdingsSheet!.getRow(1);
        expect(holdingsHeader.getCell(1).value).toBe('Брокер');
    });
});
