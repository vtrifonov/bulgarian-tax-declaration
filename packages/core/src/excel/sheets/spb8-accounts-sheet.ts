import type {
    Workbook,
    Worksheet,
} from 'exceljs';

import { fxToBaseCurrency } from '../../spb8/assemble.js';
import type { AppState } from '../../types/index.js';
import {
    CCY_FORMAT,
    FONT,
    HEADER_STYLE,
} from '../styles.js';

export function addSpb8AccountsSheet(workbook: Workbook, state: AppState): Worksheet | null {
    if (!state.foreignAccounts || state.foreignAccounts.length === 0) {
        return null;
    }
    const baseCurrency = state.taxYear >= 2026 ? 'EUR' : 'BGN';
    const sheet = workbook.addWorksheet('СПБ-8 Сметки');
    const headers = [
        'Брокер',
        'Тип',
        'Падеж',
        'Държава',
        'Валута',
        'Начално салдо',
        'Крайно салдо',
        'Хил. нач.',
        'Хил. край',
        `Край ${baseCurrency}`,
    ];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    for (const account of state.foreignAccounts) {
        const endBase = account.amountEndOfYear * fxToBaseCurrency(account.currency, state.taxYear, state.fxRates);
        const row = sheet.addRow([
            account.broker,
            account.type,
            account.maturity,
            account.country,
            account.currency,
            account.amountStartOfYear,
            account.amountEndOfYear,
            Math.round(account.amountStartOfYear / 1000),
            Math.round(account.amountEndOfYear / 1000),
            endBase,
        ]);

        row.getCell(6).numFmt = CCY_FORMAT;
        row.getCell(7).numFmt = CCY_FORMAT;
        row.getCell(10).numFmt = CCY_FORMAT;
        row.font = FONT;
    }

    const widths = [20, 8, 8, 10, 10, 14, 14, 10, 10, 14];

    for (let i = 0; i < widths.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}
