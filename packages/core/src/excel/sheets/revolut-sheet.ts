import type { Workbook } from 'exceljs';

import type { AppState } from '../../types/index.js';
import {
    baseCcyFormat,
    CCY_FORMAT,
    DATE_FORMAT,
    FONT,
    FX_RATE_FORMAT,
    HEADER_STYLE,
} from '../styles.js';

export function addRevolutSheets(workbook: Workbook, state: AppState): void {
    if (state.revolutInterest.length === 0) {
        return;
    }

    const ccy = state.baseCurrency;

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Revolut Лихва');
    const summaryHeaders = ['Валута', 'Записи', `Нетна лихва`, `Нетна лихва (${ccy})`, `Данък 10% (${ccy})`];
    const summaryHeaderRow = summarySheet.addRow(summaryHeaders);

    summaryHeaderRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    let summaryR = 2;

    for (const ri of state.revolutInterest) {
        const net = ri.entries.reduce((sum, e) => sum + e.amount, 0);
        const row = summarySheet.addRow([
            ri.currency,
            ri.entries.length,
            net,
            null, // D: net in base
            null, // E: tax in base
        ]);

        // Use mid-year date for FX approximation
        const midDate = `${state.taxYear}-06-30`;
        const fxRate = getFxRate(ri.currency, midDate, state);

        row.getCell(4).value = { formula: `ROUND(C${summaryR}*${fxRate},2)` };
        row.getCell(5).value = { formula: `ROUND(D${summaryR}*0.1,2)` };

        row.getCell(3).numFmt = CCY_FORMAT;
        row.getCell(4).numFmt = baseCcyFormat(ccy);
        row.getCell(5).numFmt = baseCcyFormat(ccy);
        row.font = FONT;
        summaryR++;
    }

    // Total row
    const lastDataRow = summaryR - 1;

    if (lastDataRow >= 2) {
        const totalRow = summarySheet.addRow([
            'Общо',
            null,
            null,
            null,
            null,
        ]);

        totalRow.getCell(4).value = { formula: `SUM(D2:D${lastDataRow})` };
        totalRow.getCell(5).value = { formula: `SUM(E2:E${lastDataRow})` };
        totalRow.getCell(4).numFmt = baseCcyFormat(ccy);
        totalRow.getCell(5).numFmt = baseCcyFormat(ccy);
        totalRow.font = { ...FONT, bold: true };
    }

    summarySheet.getColumn(1).width = 12;
    summarySheet.getColumn(2).width = 10;
    summarySheet.getColumn(3).width = 14;
    summarySheet.getColumn(4).width = 16;
    summarySheet.getColumn(5).width = 16;

    // Detail sheets per currency
    for (const ri of state.revolutInterest) {
        const detailSheet = workbook.addWorksheet(`Revolut ${ri.currency}`);

        const detailHeaders = ['Дата', 'Описание', 'Размер', 'Валутен курс', `Размер (${ccy})`];
        const detailHeaderRow = detailSheet.addRow(detailHeaders);

        detailHeaderRow.eachCell((cell) => {
            cell.style = { ...HEADER_STYLE, font: FONT };
        });

        let r = 2;

        for (const entry of ri.entries) {
            const row = detailSheet.addRow([
                entry.date,
                entry.description,
                entry.amount,
                null, // D: FX rate
                null, // E: Amount in base
            ]);

            setFxRateCell(row.getCell(4), ri.currency, r, state);
            row.getCell(5).value = { formula: `ROUND(C${r}*D${r},2)` };

            row.getCell(1).numFmt = DATE_FORMAT;
            row.getCell(3).numFmt = CCY_FORMAT;
            row.getCell(4).numFmt = FX_RATE_FORMAT;
            row.getCell(5).numFmt = baseCcyFormat(ccy);
            row.font = FONT;
            r++;
        }

        detailSheet.getColumn(1).width = 12;
        detailSheet.getColumn(2).width = 25;
        detailSheet.getColumn(3).width = 12;
        detailSheet.getColumn(4).width = 12;
        detailSheet.getColumn(5).width = 14;
    }
}

function getFxRate(currency: string, date: string, state: AppState): number {
    if (currency === state.baseCurrency) {
        return 1;
    }

    if (currency === 'EUR' && state.baseCurrency === 'BGN') {
        return 1.95583;
    }

    if (currency === 'BGN' && state.baseCurrency === 'EUR') {
        return 1 / 1.95583;
    }
    const ecbRate = state.fxRates[currency]?.[date];

    if (!ecbRate) {
        return 1;
    }

    return state.baseCurrency === 'BGN' ? 1.95583 / ecbRate : 1 / ecbRate;
}

function setFxRateCell(
    cell: import('exceljs').Cell,
    currency: string,
    rowNum: number,
    state: AppState,
): void {
    if (currency === state.baseCurrency) {
        cell.value = 1;

        return;
    }

    if (state.baseCurrency === 'BGN') {
        if (currency === 'EUR') {
            cell.value = 1.95583;

            return;
        }
        cell.value = { formula: `IFERROR(VLOOKUP(A${rowNum},INDIRECT("${currency}!A:B"),2,FALSE),"")` };
    } else {
        if (currency === 'EUR') {
            cell.value = 1;

            return;
        }
        cell.value = { formula: `IFERROR(VLOOKUP(A${rowNum},INDIRECT("${currency}!A:B"),2,FALSE),"")` };
    }
}
