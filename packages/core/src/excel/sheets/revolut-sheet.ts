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

export function addRevolutSheets(workbook: Workbook, state: AppState): void {
    // Summary sheet
    const summarySheet = workbook.addWorksheet('Revolut Лихва');

    // Summary headers
    const summaryHeaders = ['Валута', 'Общо приход', 'Общо данък'];
    const summaryHeaderRow = summarySheet.addRow(summaryHeaders);
    summaryHeaderRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    // Summary data - per currency
    for (let i = 0; i < state.revolutInterest.length; i++) {
        const ri = state.revolutInterest[i];
        const detailSheetName = `Revolut ${ri.currency} ${state.taxYear}`;

        // Calculate total interest (sum of all positive amounts)
        const totalInterest = ri.entries.reduce((sum, e) => sum + Math.max(0, e.amount), 0);
        const totalTax = totalInterest * 0.1; // 10% tax

        const row = summarySheet.addRow([ri.currency, totalInterest, totalTax]);
        row.getCell(2).numFmt = CCY_FORMAT;
        row.getCell(3).numFmt = baseCcyFormat(state.baseCurrency);
        row.font = FONT;
    }

    // Column widths
    summarySheet.getColumn(1).width = 12;
    summarySheet.getColumn(2).width = 14;
    summarySheet.getColumn(3).width = 14;

    // Detail sheets per currency
    for (const ri of state.revolutInterest) {
        const detailSheetName = `Revolut ${ri.currency} ${state.taxYear}`;
        const detailSheet = workbook.addWorksheet(detailSheetName);

        // Row 1: Summary values (these will be referenced from summary sheet)
        const summaryRow = detailSheet.addRow(['Общо приход', 'Общо данък']);
        summaryRow.font = FONT;

        // Row 2: blank
        detailSheet.addRow([]);

        // Row 3: Headers
        const detailHeaders = ['Дата', 'Описание', 'Размер'];
        const detailHeaderRow = detailSheet.addRow(detailHeaders);
        detailHeaderRow.eachCell((cell) => {
            cell.style = { ...HEADER_STYLE, font: FONT };
        });

        // Row 4+: Data
        for (const entry of ri.entries) {
            const row = detailSheet.addRow([entry.date, entry.description, entry.amount]);
            row.getCell(1).numFmt = DATE_FORMAT;
            row.getCell(3).numFmt = CCY_FORMAT;
            row.font = FONT;
        }

        // Column widths
        detailSheet.getColumn(1).width = 12;
        detailSheet.getColumn(2).width = 20;
        detailSheet.getColumn(3).width = 12;
    }
}
