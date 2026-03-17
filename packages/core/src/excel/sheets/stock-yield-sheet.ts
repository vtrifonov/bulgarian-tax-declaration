import type {
    Workbook,
    Worksheet,
} from 'exceljs';

import type { AppState } from '../../types/index.js';
import { setFxRateCell } from '../fx-cell.js';
import {
    baseCcyFormat,
    CCY_FORMAT,
    DATE_FORMAT,
    FONT,
    FX_RATE_FORMAT,
    HEADER_STYLE,
} from '../styles.js';

export function addStockYieldSheet(workbook: Workbook, state: AppState): Worksheet {
    const sheet = workbook.addWorksheet('IB Stock Yield');

    // Headers
    const headers = ['Дата', 'Символ', 'Валута', 'Размер', 'Курс', 'Размер (база)'];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Data rows (skip incomplete rows)
    let r = 2;

    for (let i = 0; i < state.stockYield.length; i++) {
        const sy = state.stockYield[i];

        if (!sy.symbol || !sy.currency) {
            continue;
        }

        const row = sheet.addRow([
            sy.date,
            sy.symbol,
            sy.currency,
            sy.amount,
            null, // E: FX rate
            null, // F: Amount in base
        ]);

        // E: FX rate
        setFxRateCell(row.getCell(5), sy.currency, state.baseCurrency, 'A', 'C', r);
        // F: Amount in base currency
        row.getCell(6).value = { formula: `ROUND(D${r}*E${r},2)` };

        row.getCell(1).numFmt = DATE_FORMAT;
        row.getCell(4).numFmt = CCY_FORMAT;
        row.getCell(5).numFmt = FX_RATE_FORMAT;
        row.getCell(6).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
        r++;
    }

    // Column widths
    const widths = [12, 12, 10, 12, 12, 14];

    for (let i = 0; i < headers.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}
