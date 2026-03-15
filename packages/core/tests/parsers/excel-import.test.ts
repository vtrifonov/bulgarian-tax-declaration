import { describe, it, expect } from 'vitest';
import { importHoldingsFromExcel } from '../../src/parsers/excel-import.js';
import ExcelJS from 'exceljs';

describe('importHoldingsFromExcel', () => {
  it('parses holdings from Притежания sheet', async () => {
    // Create a minimal xlsx matching the app's known export format
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Притежания');
    ws.addRow(['Брокер', 'Държава', 'Символ', 'Дата', 'Количество', 'Валута', 'Цена', 'Общо', 'Курс', 'Общо BGN', 'Бележки']);
    ws.addRow(['IB', 'САЩ', 'AAPL', '2024-03-15', 50, 'USD', 250.42, '', '', '', '']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const holdings = await importHoldingsFromExcel(buffer);

    expect(holdings).toHaveLength(1);
    expect(holdings[0].symbol).toBe('AAPL');
    expect(holdings[0].quantity).toBe(50);
    expect(holdings[0].unitPrice).toBe(250.42);
    expect(holdings[0].broker).toBe('IB');
  });

  it('throws if Pritezhaniya sheet is missing', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Other');
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(importHoldingsFromExcel(buffer)).rejects.toThrow('Притежания');
  });
});
