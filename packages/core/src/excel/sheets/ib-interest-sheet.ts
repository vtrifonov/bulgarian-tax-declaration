import type {
    Workbook,
    Worksheet,
} from 'exceljs';
import {
    baseCcyFormat,
    CCY_FORMAT,
    DATE_FORMAT,
    FONT,
    FX_RATE_FORMAT,
    HEADER_STYLE,
} from '../styles.js';
import type { AppState } from '../../types/index.js';

export function addIbInterestSheet(workbook: Workbook, state: AppState): Worksheet {
    const sheet = workbook.addWorksheet('IB Лихви');

    const headers = [
        'Дата',
        'Валута',
        'Описание',
        'Размер',
        'Курс',
        `Размер (${state.baseCurrency})`,
    ];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    let r = 2;
    for (let i = 0; i < state.ibInterest.length; i++) {
        const entry = state.ibInterest[i];
        if (!entry.currency && !entry.date) continue;

        const row = sheet.addRow([
            entry.date,
            entry.currency,
            entry.description,
            entry.amount,
            null, // E: FX rate
            null, // F: Amount in base
        ]);

        setFxRateCell(row.getCell(5), entry.currency, r, state.baseCurrency);
        row.getCell(6).value = { formula: `ROUND(D${r}*E${r},2)` };

        row.getCell(1).numFmt = DATE_FORMAT;
        row.getCell(4).numFmt = CCY_FORMAT;
        row.getCell(5).numFmt = FX_RATE_FORMAT;
        row.getCell(6).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
        r++;
    }

    const widths = [12, 10, 30, 12, 12, 14];
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
        cell.value = { formula: `IFERROR(VLOOKUP(A${rowNum},INDIRECT(B${rowNum}&"!A:B"),2,FALSE),"")` };
    } else {
        if (currency === 'EUR') {
            cell.value = 1;
            return;
        }
        if (currency === 'BGN') {
            cell.value = { formula: '1/1.95583' };
            return;
        }
        cell.value = { formula: `IFERROR(VLOOKUP(A${rowNum},INDIRECT(B${rowNum}&"!A:B"),2,FALSE),"")` };
    }
}
