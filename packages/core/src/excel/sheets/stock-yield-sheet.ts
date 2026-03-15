import type { Workbook, Worksheet } from 'exceljs';
import { FONT, DATE_FORMAT, CCY_FORMAT, HEADER_STYLE, baseCcyFormat } from '../styles.js';
import type { AppState } from '../../types/index.js';

export function addStockYieldSheet(workbook: Workbook, state: AppState): Worksheet {
  const sheet = workbook.addWorksheet('IB Stock Yield');

  // Headers
  const headers = ['Дата', 'Символ', 'Валута', 'Размер', 'Курс', 'Размер (база)'];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.style = { ...HEADER_STYLE, font: FONT };
  });

  // Data rows
  for (let i = 0; i < state.stockYield.length; i++) {
    const sy = state.stockYield[i];
    const r = i + 2;

    const row = sheet.addRow([
      sy.date,
      sy.symbol,
      sy.currency,
      sy.amount,
      1, // FX rate (simplified)
      `=ROUND(D${r}*E${r},2)`, // Amount in base currency
    ]);

    // Set formats
    row.getCell(1).numFmt = DATE_FORMAT;
    row.getCell(4).numFmt = CCY_FORMAT;
    row.getCell(5).numFmt = CCY_FORMAT;
    row.getCell(6).numFmt = baseCcyFormat(state.baseCurrency);
    row.font = FONT;
  }

  // Column widths
  const widths = [12, 12, 10, 12, 10, 14];
  for (let i = 0; i < headers.length; i++) {
    sheet.getColumn(i + 1).width = widths[i];
  }

  return sheet;
}
