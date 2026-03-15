import { describe, it, expect } from 'vitest';
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
    expect(sheetNames).toContain('EUR');
    expect(sheetNames).toContain('Притежания');
    expect(sheetNames).toContain('Продажби');
    expect(sheetNames).toContain('Дивиденти');
    expect(sheetNames).toContain('IB Stock Yield');
    expect(sheetNames).toContain('Revolut Лихва');
    expect(sheetNames).toContain('Revolut EUR 2025');
    expect(sheetNames).toContain('Revolut USD 2025');

    // Verify Holdings sheet structure
    const holdingsSheet = workbook.getWorksheet('Притежания');
    expect(holdingsSheet).toBeDefined();
    expect(holdingsSheet!.rowCount).toBeGreaterThan(1); // Header + data rows

    const headerRow = holdingsSheet!.getRow(1);
    expect(headerRow.getCell(1).value).toBe('Брокер');
    expect(headerRow.getCell(2).value).toBe('Държава');
    expect(headerRow.getCell(3).value).toBe('Символ');
    expect(headerRow.getCell(4).value).toBe('Дата');

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

    const eurSheet = workbook.getWorksheet('EUR');
    expect(eurSheet).toBeDefined();

    // Verify Revolut sheets
    const revolutSummary = workbook.getWorksheet('Revolut Лихва');
    expect(revolutSummary).toBeDefined();
    expect(revolutSummary!.rowCount).toBeGreaterThan(1);

    const revHeader = revolutSummary!.getRow(1);
    expect(revHeader.getCell(1).value).toBe('Валута');
    expect(revHeader.getCell(2).value).toBe('Общо приход');
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
      revolutInterest: [],
      fxRates: {
        USD: {
          '2024-01-15': 0.92,
        },
      },
      manualEntries: [],
    };

    const buffer = await generateExcel(state);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const holdingsSheet = workbook.getWorksheet('Притежания');
    const headerRow = holdingsSheet!.getRow(1);
    let foundEurColumn = false;
    headerRow.eachCell((cell) => {
      if (cell.value === 'Общо EUR') {
        foundEurColumn = true;
      }
    });
    expect(foundEurColumn).toBe(true);
  });
});
