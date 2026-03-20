import type {
    Workbook,
    Worksheet,
} from 'exceljs';

import type { AppState } from '../../types/index.js';
import {
    FONT,
    HEADER_STYLE,
} from '../styles.js';

export function addSpb8PersonalDataSheet(workbook: Workbook, state: AppState): Worksheet | null {
    const personal = state.spb8PersonalData;

    if (!personal) {
        return null;
    }
    const rows: Array<[string, string]> = [
        ['name', personal.name ?? ''],
        ['egn', personal.egn ?? ''],
        ['phone', personal.phone ?? ''],
        ['email', personal.email ?? ''],
        ['address.city', personal.address?.city ?? ''],
        ['address.postalCode', personal.address?.postalCode ?? ''],
        ['address.district', personal.address?.district ?? ''],
        ['address.street', personal.address?.street ?? ''],
        ['address.number', personal.address?.number ?? ''],
        ['address.entrance', personal.address?.entrance ?? ''],
    ];
    const hasData = rows.some(([, value]) => value.trim().length > 0);

    if (!hasData) {
        return null;
    }
    const sheet = workbook.addWorksheet('СПБ-8 Лични Данни');
    const headerRow = sheet.addRow(['Поле', 'Стойност']);

    headerRow.eachCell((cell) => {
        cell.style = { ...HEADER_STYLE, font: FONT };
    });

    for (const [key, value] of rows) {
        const row = sheet.addRow([key, value]);

        row.font = FONT;
    }

    sheet.getColumn(1).width = 18;
    sheet.getColumn(2).width = 40;

    return sheet;
}
