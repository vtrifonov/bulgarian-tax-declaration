import type {
    Workbook,
    Worksheet,
} from 'exceljs';

import type { AppState } from '../../types/index.js';
import {
    baseCcyFormat,
    CCY_FORMAT,
    DATE_FORMAT,
    FONT,
    FX_RATE_FORMAT,
    HEADER_STYLE,
} from '../styles.js';

export function addSalesSheet(workbook: Workbook, state: AppState): Worksheet {
    const sheet = workbook.addWorksheet('Продажби');

    // Headers
    const ccy = state.baseCurrency;
    const headers = [
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
        `Приходи (${ccy})`,
        `Разходи (${ccy})`,
        `Печалба/Загуба (${ccy})`,
    ];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Data rows (skip incomplete rows)
    let r = 2;

    for (let i = 0; i < state.sales.length; i++) {
        const s = state.sales[i];

        if (!s.symbol || !s.currency) {
            continue;
        }

        const row = sheet.addRow([
            s.broker,
            s.symbol,
            s.country,
            s.dateAcquired,
            s.dateSold,
            s.quantity,
            s.currency,
            s.buyPrice,
            s.sellPrice,
            s.fxRateBuy,
            s.fxRateSell,
            null, // L: formula
            null, // M: formula
            null, // N: formula
        ]);

        // L: Proceeds = Qty * Sell Price * FX Sell
        row.getCell(12).value = { formula: `ROUND(F${r}*I${r}*K${r},2)` };
        // M: Cost = Qty * Buy Price * FX Buy
        row.getCell(13).value = { formula: `ROUND(F${r}*H${r}*J${r},2)` };
        // N: P/L = Proceeds - Cost
        row.getCell(14).value = { formula: `ROUND(L${r}-M${r},2)` };

        row.getCell(4).numFmt = DATE_FORMAT;
        row.getCell(5).numFmt = DATE_FORMAT;
        row.getCell(6).numFmt = '#,##0';
        row.getCell(8).numFmt = CCY_FORMAT;
        row.getCell(9).numFmt = CCY_FORMAT;
        row.getCell(10).numFmt = FX_RATE_FORMAT;
        row.getCell(11).numFmt = FX_RATE_FORMAT;
        row.getCell(12).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(13).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(14).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
        r++;
    }

    // Column widths
    const widths = [12, 14, 10, 14, 14, 8, 10, 12, 12, 12, 12, 12, 12, 12];

    for (let i = 0; i < headers.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}
