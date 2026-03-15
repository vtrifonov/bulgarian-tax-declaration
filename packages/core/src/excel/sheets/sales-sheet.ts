import type { Workbook, Worksheet } from 'exceljs';
import { FONT, DATE_FORMAT, CCY_FORMAT, HEADER_STYLE, baseCcyFormat } from '../styles.js';
import type { AppState } from '../../types/index.js';

export function addSalesSheet(workbook: Workbook, state: AppState): Worksheet {
  const sheet = workbook.addWorksheet('Продажби');

  // Headers
  const headers = [
    'Брокер',
    'Държава',
    'Символ',
    'Дата покупка',
    'Дата продажба',
    'Кол.',
    'Валута',
    'Цена покупка',
    'Цена продажба',
    'Курс покупка',
    'Курс продажба',
    'Приходи',
    'Разходи',
    'П/З',
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.style = { ...HEADER_STYLE, font: FONT };
  });

  // Data rows
  for (let i = 0; i < state.sales.length; i++) {
    const s = state.sales[i];
    const r = i + 2;

    const row = sheet.addRow([
      s.broker,
      s.country,
      s.symbol,
      s.dateAcquired,
      s.dateSold,
      s.quantity,
      s.currency,
      s.buyPrice,
      s.sellPrice,
      s.fxRateBuy,
      s.fxRateSell,
      `=ROUND(F${r}*I${r}*K${r},2)`, // Proceeds = Qty * Sell Price * FX Sell
      `=ROUND(F${r}*H${r}*J${r},2)`, // Cost = Qty * Buy Price * FX Buy
      `=ROUND(L${r}-M${r},2)`, // P/L = Proceeds - Cost
    ]);

    // Set formats
    row.getCell(4).numFmt = DATE_FORMAT;
    row.getCell(5).numFmt = DATE_FORMAT;
    row.getCell(6).numFmt = '#,##0';
    row.getCell(8).numFmt = CCY_FORMAT;
    row.getCell(9).numFmt = CCY_FORMAT;
    row.getCell(10).numFmt = CCY_FORMAT;
    row.getCell(11).numFmt = CCY_FORMAT;
    row.getCell(12).numFmt = baseCcyFormat(state.baseCurrency);
    row.getCell(13).numFmt = baseCcyFormat(state.baseCurrency);
    row.getCell(14).numFmt = baseCcyFormat(state.baseCurrency);
    row.font = FONT;
  }

  // Column widths
  const widths = [12, 14, 10, 14, 14, 8, 10, 12, 12, 12, 12, 12, 12, 12];
  for (let i = 0; i < headers.length; i++) {
    sheet.getColumn(i + 1).width = widths[i];
  }

  return sheet;
}
