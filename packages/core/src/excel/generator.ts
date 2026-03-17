import ExcelJS from 'exceljs';

import type { AppState } from '../types/index.js';
import { addBrokerInterestSheets } from './sheets/broker-interest-sheet.js';
import { addDividendsSheet } from './sheets/dividends-sheet.js';
import { addFxSheet } from './sheets/fx-sheet.js';
import { addHoldingsSheet } from './sheets/holdings-sheet.js';
import { addSalesSheet } from './sheets/sales-sheet.js';
import { addStockYieldSheet } from './sheets/stock-yield-sheet.js';

export async function generateExcel(state: AppState): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();

    // 1. Data sheets
    addHoldingsSheet(workbook, state);
    addSalesSheet(workbook, state);
    addDividendsSheet(workbook, state);
    addStockYieldSheet(workbook, state);
    addBrokerInterestSheets(workbook, state);

    // 2. FX rate sheets (last)
    const currencies = detectCurrencies(state);

    for (const ccy of currencies) {
        const rates = state.fxRates[ccy] ?? {};

        addFxSheet(workbook, ccy, rates, state.taxYear);
    }

    const buf = await workbook.xlsx.writeBuffer();

    return new Uint8Array(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer);
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

    // From broker interest
    for (const bi of state.brokerInterest) {
        if (bi.currency !== state.baseCurrency) {
            cccies.add(bi.currency);
        }
    }

    cccies.delete(''); // Exclude empty currencies from incomplete rows
    // EUR/BGN is a fixed rate — no FX sheet needed
    cccies.delete('EUR');
    cccies.delete('BGN');

    return Array.from(cccies).sort();
}
