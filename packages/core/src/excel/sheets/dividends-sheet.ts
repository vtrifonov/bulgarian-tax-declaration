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

export function addDividendsSheet(workbook: Workbook, state: AppState): Worksheet {
    const sheet = workbook.addWorksheet('Дивиденти');

    // Headers
    const headers = [
        'Символ',
        'Държава',
        'Дата',
        'Валута',
        'Брутен размер',
        'WHT',
        'БГ данък',
        'WHT кредит',
        'Курс',
        'Дивидент (база)',
        'WHT (база)',
        'Бележки',
    ];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Sort dividends by symbol then date
    const sorted = [...state.dividends].sort((a, b) => {
        if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
        return a.date.localeCompare(b.date);
    });

    // Data rows
    for (let i = 0; i < sorted.length; i++) {
        const d = sorted[i];
        const r = i + 2;

        const row = sheet.addRow([
            d.symbol,
            d.country,
            d.date,
            d.currency,
            d.grossAmount,
            d.withholdingTax,
            d.bgTaxDue,
            d.whtCredit,
            1, // FX rate (simplified - assume 1:1 or base lookup needed)
            `=ROUND(E${r}*I${r},2)`, // Dividend in base currency
            `=ROUND(F${r}*I${r},2)`, // WHT in base currency
            d.notes || '',
        ]);

        // Set formats
        row.getCell(3).numFmt = DATE_FORMAT;
        row.getCell(5).numFmt = CCY_FORMAT;
        row.getCell(6).numFmt = CCY_FORMAT;
        row.getCell(7).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(8).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(9).numFmt = CCY_FORMAT;
        row.getCell(10).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(11).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
    }

    // Column widths
    const widths = [10, 14, 12, 10, 14, 12, 12, 12, 10, 14, 12, 20];
    for (let i = 0; i < headers.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}
