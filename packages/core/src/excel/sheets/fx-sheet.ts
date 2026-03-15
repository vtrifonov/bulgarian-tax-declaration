import type {
    Workbook,
    Worksheet,
} from 'exceljs';
import {
    CCY_FORMAT,
    DATE_FORMAT,
    FONT,
    HEADER_STYLE,
} from '../styles.js';

export function addFxSheet(
    workbook: Workbook,
    currency: string,
    rates: Record<string, number>,
    _taxYear: number,
): Worksheet {
    const sheet = workbook.addWorksheet(currency);

    // Headers
    const headerRow = sheet.addRow(['Дата', 'Курс']);
    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Data rows: sorted by date
    const dates = Object.keys(rates).sort();
    for (const date of dates) {
        const row = sheet.addRow([date, rates[date]]);
        row.getCell(1).numFmt = DATE_FORMAT;
        row.getCell(2).numFmt = CCY_FORMAT;
        row.font = FONT;
    }

    // Column widths
    sheet.getColumn(1).width = 12;
    sheet.getColumn(2).width = 12;

    return sheet;
}
