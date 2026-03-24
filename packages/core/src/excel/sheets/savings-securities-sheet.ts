import type {
    Workbook,
    Worksheet,
} from 'exceljs';

import type { AppState } from '../../types/index.js';
import {
    CCY_FORMAT,
    FONT,
    HEADER_STYLE,
} from '../styles.js';

export function addSavingsSecuritiesSheet(workbook: Workbook, state: AppState): Worksheet | null {
    if (!state.savingsSecurities || state.savingsSecurities.length === 0) {
        return null;
    }

    const sheet = workbook.addWorksheet('Спестовни Ценни Книжа');
    const headers = [
        'ISIN',
        'Валута',
        'Начало година',
        'Край година',
    ];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    for (const sec of state.savingsSecurities) {
        const row = sheet.addRow([
            sec.isin,
            sec.currency,
            sec.quantityStartOfYear,
            sec.quantityEndOfYear,
        ]);

        row.getCell(3).numFmt = CCY_FORMAT;
        row.getCell(4).numFmt = CCY_FORMAT;
        row.font = FONT;
    }

    const widths = [18, 10, 14, 14];

    for (let i = 0; i < widths.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}
