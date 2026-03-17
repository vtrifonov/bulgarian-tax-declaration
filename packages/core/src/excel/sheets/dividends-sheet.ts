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

export function addDividendsSheet(workbook: Workbook, state: AppState): Worksheet {
    const sheet = workbook.addWorksheet('Дивиденти');

    // Headers
    const ccy = state.baseCurrency;
    const headers = [
        'Символ',
        'Държава',
        'Дата',
        'Валута',
        'Брутен размер',
        'WHT',
        'Валутен курс',
        `Брутно (${ccy})`,
        `Удържан данък (${ccy})`,
        `Данък 5% (${ccy})`,
        `Дължим данък (${ccy})`,
        'Бележки',
    ];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Sort dividends by symbol then date
    const sorted = [...state.dividends].sort((a, b) => {
        if (a.symbol !== b.symbol) {
            return a.symbol.localeCompare(b.symbol);
        }

        return a.date.localeCompare(b.date);
    });

    // Data rows (skip incomplete rows)
    let r = 2;

    for (let i = 0; i < sorted.length; i++) {
        const d = sorted[i];

        if (!d.symbol && !d.currency) {
            continue;
        }

        const row = sheet.addRow([
            d.symbol,
            d.country,
            d.date,
            d.currency,
            d.grossAmount,
            d.withholdingTax,
            null, // G: FX rate
            null, // H: Gross in base
            null, // I: WHT in base
            null, // J: Tax 5%
            null, // K: BG tax due
            d.notes || '',
        ]);

        // G: FX rate
        setFxRateCell(row.getCell(7), d.currency, r, state.baseCurrency);
        // H: Gross in base currency
        row.getCell(8).value = { formula: `ROUND(E${r}*G${r},2)` };
        // I: WHT in base currency
        row.getCell(9).value = { formula: `ROUND(F${r}*G${r},2)` };
        // J: Tax 5% = 5% of gross in base
        row.getCell(10).value = { formula: `ROUND(H${r}*0.05,2)` };
        // K: BG tax due = MAX(0, Tax 5% - WHT base)
        row.getCell(11).value = { formula: `MAX(0,J${r}-I${r})` };

        row.getCell(3).numFmt = DATE_FORMAT;
        row.getCell(5).numFmt = CCY_FORMAT;
        row.getCell(6).numFmt = CCY_FORMAT;
        row.getCell(7).numFmt = FX_RATE_FORMAT;
        row.getCell(8).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(9).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(10).numFmt = baseCcyFormat(state.baseCurrency);
        row.getCell(11).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
        r++;
    }

    // Column widths
    const widths = [10, 14, 12, 10, 14, 12, 12, 14, 12, 12, 14, 20];

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
        cell.value = { formula: `IFERROR(VLOOKUP(C${rowNum},INDIRECT(D${rowNum}&"!A:B"),2,FALSE),"")` };
    } else {
        if (currency === 'EUR') {
            cell.value = 1;

            return;
        }

        if (currency === 'BGN') {
            cell.value = { formula: '1/1.95583' };

            return;
        }
        cell.value = { formula: `IFERROR(VLOOKUP(C${rowNum},INDIRECT(D${rowNum}&"!A:B"),2,FALSE),"")` };
    }
}
