import type { Workbook } from 'exceljs';

import type {
    AppState,
    BrokerInterest,
} from '../../types/index.js';
import { setFxRateCell } from '../fx-cell.js';
import {
    baseCcyFormat,
    CCY_FORMAT,
    DATE_FORMAT,
    FONT,
    FX_RATE_FORMAT,
    HEADER_STYLE,
} from '../styles.js';

/**
 * Add one sheet per broker+currency combo: "{Broker} Лихви {CCY}"
 * e.g. "IB Лихви USD", "Revolut Лихви EUR"
 */
export function addBrokerInterestSheets(workbook: Workbook, state: AppState): void {
    for (const bi of state.brokerInterest) {
        if (bi.entries.length === 0) {
            continue;
        }
        addInterestSheet(workbook, bi, state);
    }
}

function addInterestSheet(workbook: Workbook, bi: BrokerInterest, state: AppState): void {
    const sheetName = `${bi.broker} Лихви ${bi.currency}`;
    const sheet = workbook.addWorksheet(sheetName);

    const ccy = state.baseCurrency;
    const headers = ['Дата', 'Описание', 'Сума', 'Курс', `Сума (${ccy})`];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    let r = 2;

    for (const entry of bi.entries) {
        const row = sheet.addRow([
            entry.date,
            entry.description,
            entry.amount,
            null, // D: FX rate
            null, // E: Amount in base
        ]);

        setFxRateCell(row.getCell(4), bi.currency, state.baseCurrency, 'A', bi.currency, r);
        row.getCell(5).value = { formula: `ROUND(C${r}*D${r},2)` };

        row.getCell(1).numFmt = DATE_FORMAT;
        row.getCell(3).numFmt = CCY_FORMAT;
        row.getCell(4).numFmt = FX_RATE_FORMAT;
        row.getCell(5).numFmt = baseCcyFormat(ccy);
        row.font = FONT;
        r++;
    }

    // Total row
    if (r > 2) {
        const totalRow = sheet.addRow(['Общо', null, null, null, null]);

        totalRow.getCell(3).value = { formula: `SUM(C2:C${r - 1})` };
        totalRow.getCell(5).value = { formula: `SUM(E2:E${r - 1})` };
        totalRow.getCell(3).numFmt = CCY_FORMAT;
        totalRow.getCell(5).numFmt = baseCcyFormat(ccy);
        totalRow.font = { ...FONT, bold: true };
    }

    sheet.getColumn(1).width = 12;
    sheet.getColumn(2).width = 30;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 14;
}
