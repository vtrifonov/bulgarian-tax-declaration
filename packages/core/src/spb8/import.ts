import * as ExcelJS from 'exceljs';

import type {
    Spb8PersonalData,
    Spb8Security,
} from '../types/index.js';

const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export async function importPreviousSpb8(buffer: ArrayBuffer): Promise<{
    securities: Spb8Security[];
    personalData?: Spb8PersonalData;
}> {
    const wb = new ExcelJS.Workbook();

    await wb.xlsx.load(buffer);

    const sheet = wb.getWorksheet('СПБ-8') ?? wb.worksheets[0];

    if (!sheet) {
        throw new Error('No worksheet found');
    }

    const securities: Spb8Security[] = [];

    sheet.eachRow((row) => {
        // Look for ISIN in columns I-N (9-14) in the BNB template layout
        const isinVal = String(row.getCell(9).value ?? '').trim();

        if (ISIN_REGEX.test(isinVal)) {
            // Valid ISIN found — this is a securities row
            // In the new layout, securities section (04) includes all rows with valid ISINs in I-N
            // Get quantities from columns O-R (15-18) and S-V (19-22)
            const startQty = parseNumericCell(row, 15);
            const endQty = parseNumericCell(row, 19);

            securities.push({
                isin: isinVal,
                currency: '', // Not stored in form
                quantityStartOfYear: startQty,
                quantityEndOfYear: endQty,
            });
        }
    });

    return { securities };
}

function parseNumericCell(row: ExcelJS.Row, col: number): number {
    const val = row.getCell(col).value;

    if (typeof val === 'number') {
        return val;
    }
    const parsed = parseFloat(String(val ?? ''));

    return isNaN(parsed) ? 0 : parsed;
}
