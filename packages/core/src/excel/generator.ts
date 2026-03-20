import * as ExcelJS from 'exceljs';

import type { AppState } from '../types/index.js';
import { addBrokerInterestSheets } from './sheets/broker-interest-sheet.js';
import { addDividendsSheet } from './sheets/dividends-sheet.js';
import { addFxSheet } from './sheets/fx-sheet.js';
import { addHoldingsSheet } from './sheets/holdings-sheet.js';
import { addSalesSheet } from './sheets/sales-sheet.js';
import { addSpb8AccountsSheet } from './sheets/spb8-accounts-sheet.js';
import { addSpb8PersonalDataSheet } from './sheets/spb8-personal-sheet.js';
import { addSpb8SecuritiesSheet } from './sheets/spb8-securities-sheet.js';
import { addStockYieldSheet } from './sheets/stock-yield-sheet.js';

export async function generateExcel(state: AppState): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();

    workbook.created = new Date(0);
    workbook.modified = new Date(0);

    // 1. Data sheets
    addHoldingsSheet(workbook, state);
    addSalesSheet(workbook, state);
    addDividendsSheet(workbook, state);
    addStockYieldSheet(workbook, state);
    addBrokerInterestSheets(workbook, state);
    addSpb8AccountsSheet(workbook, state);
    addSpb8PersonalDataSheet(workbook, state);
    addSpb8SecuritiesSheet(workbook, state);

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
    const ccies = new Set<string>();

    // Collect currencies from all data arrays
    const itemArrays: { currency: string }[][] = [
        state.holdings,
        state.sales,
        state.dividends,
        state.stockYield,
        state.brokerInterest,
    ];

    for (const arr of itemArrays) {
        for (const item of arr) {
            if (item.currency && item.currency !== state.baseCurrency) {
                ccies.add(item.currency);
            }
        }
    }

    // EUR/BGN is a fixed rate — no FX sheet needed
    ccies.delete('EUR');
    ccies.delete('BGN');

    return Array.from(ccies).sort();
}
