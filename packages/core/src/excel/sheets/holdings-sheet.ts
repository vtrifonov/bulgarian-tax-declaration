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

export function addHoldingsSheet(workbook: Workbook, state: AppState): Worksheet {
    const sheet = workbook.addWorksheet('Притежания');
    const ccy = state.baseCurrency;

    // Headers
    const headers = [
        'Брокер',
        'Символ',
        'Държава',
        'Дата на придобиване',
        'Количество',
        'Валута',
        'Цена',
        'Общо',
        'Курс за деня',
        `Общо (${ccy})`,
        'Бележки',
    ];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Data rows (skip incomplete rows)
    let r = 2;

    for (let i = 0; i < state.holdings.length; i++) {
        const h = state.holdings[i];

        if (!h.symbol && !h.currency) {
            continue;
        }

        const row = sheet.addRow([
            h.broker,
            h.symbol,
            h.country,
            h.dateAcquired,
            h.quantity,
            h.currency,
            h.unitPrice,
            null, // H: formula
            null, // I: formula/value
            null, // J: formula
            h.notes || '',
        ]);

        // H: Total = Qty * Price
        row.getCell(8).value = { formula: `ROUND(E${r}*G${r},2)` };
        // I: FX rate
        setFxRateCell(row.getCell(9), h.currency, r, state.baseCurrency);
        // J: Total in base currency
        row.getCell(10).value = { formula: `ROUND(H${r}*I${r},2)` };

        row.getCell(4).numFmt = DATE_FORMAT;
        row.getCell(5).numFmt = '#,##0';
        row.getCell(7).numFmt = CCY_FORMAT;
        row.getCell(8).numFmt = CCY_FORMAT;
        row.getCell(9).numFmt = FX_RATE_FORMAT;
        row.getCell(10).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
        r++;
    }

    // Column widths
    const widths = [12, 14, 10, 12, 12, 10, 12, 12, 12, 14, 20];

    for (let i = 0; i < headers.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}

function setFxRateCell(
    cell: import('exceljs').Cell,
    currency: string,
    rowNum: number,
    baseCurrency: string,
): void {
    if (currency === baseCurrency) {
        cell.value = 1;

        return;
    }

    if (baseCurrency === 'BGN') {
        if (currency === 'EUR') {
            cell.value = 1.95583;

            return;
        }

        if (currency === 'BGN') {
            cell.value = 1;

            return;
        }
        cell.value = { formula: `IFERROR(VLOOKUP(D${rowNum},INDIRECT(F${rowNum}&"!A:B"),2,FALSE),"")` };
    } else {
        if (currency === 'EUR') {
            cell.value = 1;

            return;
        }

        if (currency === 'BGN') {
            cell.value = { formula: '1/1.95583' };

            return;
        }
        cell.value = { formula: `IFERROR(VLOOKUP(D${rowNum},INDIRECT(F${rowNum}&"!A:B"),2,FALSE),"")` };
    }
}
