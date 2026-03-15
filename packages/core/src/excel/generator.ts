import ExcelJS from 'exceljs';
import type { AppState } from '../types/index.js';
import { addFxSheet } from './sheets/fx-sheet.js';
import { addHoldingsSheet } from './sheets/holdings-sheet.js';
import { addSalesSheet } from './sheets/sales-sheet.js';
import { addDividendsSheet } from './sheets/dividends-sheet.js';
import { addStockYieldSheet } from './sheets/stock-yield-sheet.js';
import { addRevolutSheets } from './sheets/revolut-sheet.js';

export async function generateExcel(state: AppState): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // 1. FX rate sheets
  const currencies = detectCurrencies(state);
  for (const ccy of currencies) {
    const rates = state.fxRates[ccy] ?? {};
    addFxSheet(workbook, ccy, rates, state.taxYear);
  }

  // 2. Data sheets
  addHoldingsSheet(workbook, state);
  addSalesSheet(workbook, state);
  addDividendsSheet(workbook, state);
  addStockYieldSheet(workbook, state);
  addRevolutSheets(workbook, state);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function detectCurrencies(state: AppState): string[] {
  const cccies = new Set<string>();

  // From holdings
  for (const h of state.holdings) {
    if (h.currency !== state.baseCurrency) {
      cccies.add(h.currency);
    }
  }

  // From sales
  for (const s of state.sales) {
    if (s.currency !== state.baseCurrency) {
      cccies.add(s.currency);
    }
  }

  // From dividends
  for (const d of state.dividends) {
    if (d.currency !== state.baseCurrency) {
      cccies.add(d.currency);
    }
  }

  // From stock yield
  for (const sy of state.stockYield) {
    if (sy.currency !== state.baseCurrency) {
      cccies.add(sy.currency);
    }
  }

  // From revolut interest
  for (const ri of state.revolutInterest) {
    if (ri.currency !== state.baseCurrency) {
      cccies.add(ri.currency);
    }
  }

  return Array.from(cccies).sort();
}
