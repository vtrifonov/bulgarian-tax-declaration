import type {
    Workbook,
    Worksheet,
} from 'exceljs';

import { assembleSpb8 } from '../../spb8/assemble.js';
import type { AppState } from '../../types/index.js';
import {
    CCY_FORMAT,
    FONT,
    HEADER_STYLE,
} from '../styles.js';

export function addSpb8SecuritiesSheet(workbook: Workbook, state: AppState): Worksheet | null {
    const assembled = assembleSpb8(state, state.spb8PersonalData ?? {}, 'P');

    if (assembled.securities.length === 0) {
        return null;
    }

    const sheet = workbook.addWorksheet('СПБ-8 Ценни Книжа');
    const headers = [
        'ISIN',
        'Символ',
        'Валута',
        'Начало година',
        'Край година',
        'Цена 31.12',
    ];
    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    for (const sec of assembled.securities) {
        const symbol = state.holdings.find(h => h.isin === sec.isin)?.symbol ?? '';
        const explicitPrice = state.yearEndPrices?.[sec.isin];
        const row = sheet.addRow([
            sec.isin,
            symbol,
            sec.currency,
            sec.quantityStartOfYear,
            sec.quantityEndOfYear,
            explicitPrice ?? '',
        ]);

        row.getCell(4).numFmt = CCY_FORMAT;
        row.getCell(5).numFmt = CCY_FORMAT;
        row.getCell(6).numFmt = CCY_FORMAT;
        row.font = FONT;
    }

    const widths = [18, 14, 10, 14, 14, 14];

    for (let i = 0; i < widths.length; i++) {
        sheet.getColumn(i + 1).width = widths[i];
    }

    return sheet;
}
