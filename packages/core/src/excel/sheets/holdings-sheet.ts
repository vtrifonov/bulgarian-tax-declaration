import type {
    Workbook,
    Worksheet,
} from 'exceljs';
import {
    baseCcyFormat,
    CCY_FORMAT,
    DATE_FORMAT,
    FONT,
    HEADER_STYLE,
} from '../styles.js';
import type { AppState } from '../../types/index.js';

export function addHoldingsSheet(workbook: Workbook, state: AppState): Worksheet {
    const sheet = workbook.addWorksheet('Притежания');
    const baseCcyCol = state.baseCurrency === 'BGN' ? 'Общо BGN' : 'Общо EUR';

    // Headers
    const headers = [
        'Брокер',
        'Държава',
        'Символ',
        'Дата',
        'Количество',
        'Валута',
        'Цена',
        'Общо',
        'Курс',
        baseCcyCol,
        'Бележки',
    ];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Data rows
    for (let i = 0; i < state.holdings.length; i++) {
        const h = state.holdings[i];
        const r = i + 2; // Row number (1-indexed, accounting for header)

        const row = sheet.addRow([
            h.broker,
            h.country,
            h.symbol,
            h.dateAcquired,
            h.quantity,
            h.currency,
            h.unitPrice,
            `=ROUND(E${r}*G${r},2)`, // Total = Qty * Price
            buildFxFormula(h.currency, r, state.baseCurrency), // FX rate lookup
            `=ROUND(H${r}*I${r},2)`, // Total in base currency = Total * FX rate
            h.notes || '',
        ]);

        // Set styles and formats
        row.getCell(4).numFmt = DATE_FORMAT;
        row.getCell(5).numFmt = '#,##0';
        row.getCell(7).numFmt = CCY_FORMAT;
        row.getCell(8).numFmt = CCY_FORMAT;
        row.getCell(9).numFmt = CCY_FORMAT;
        row.getCell(10).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
    }

    // Column widths
    const widths = [12, 14, 10, 12, 12, 10, 12, 12, 12, 14, 20];
    for (let i = 0; i < headers.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}

function buildFxFormula(
    currency: string,
    rowNum: number,
    baseCurrency: string,
): string {
    if (currency === baseCurrency) {
        return '1';
    }

    if (baseCurrency === 'BGN') {
        // For BGN base: EUR=1.95583, BGN=1, others=VLOOKUP
        if (currency === 'EUR') {
            return '1.95583';
        }
        if (currency === 'BGN') {
            return '1';
        }
        return `VLOOKUP(D${rowNum},INDIRECT(F${rowNum}&"!A:B"),2,FALSE)`;
    } else {
        // For EUR base: EUR=1, BGN=1/1.95583, others=VLOOKUP
        if (currency === 'EUR') {
            return '1';
        }
        if (currency === 'BGN') {
            return '=1/1.95583';
        }
        return `VLOOKUP(D${rowNum},INDIRECT(F${rowNum}&"!A:B"),2,FALSE)`;
    }
}
