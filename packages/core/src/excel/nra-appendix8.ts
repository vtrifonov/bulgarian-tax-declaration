import * as ExcelJS from 'exceljs';

import { toBaseCurrency } from '../fx/convert.js';
import type { Holding } from '../types/index.js';

/**
 * Generate an Excel file matching the NRA Приложение 8, Част I format
 * for uploading holdings to the tax portal.
 *
 * Columns: Вид | Държава | Брой | Дата на придобиване | В съответната валута | В лева
 */
export async function generateNraAppendix8(
    holdings: Holding[],
    fxRates: Record<string, Record<string, number>>,
): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();

    workbook.created = new Date(0);
    workbook.modified = new Date(0);
    const sheet = workbook.addWorksheet('Приложение 8 Част I');

    // Header row matching NRA format
    const headers = [
        'Вид',
        'Държава',
        'Брой',
        'Дата и година на придобиване',
        'В съответната валута',
        'В лева',
    ];

    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 11 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' },
        };
    });

    // Column number row (1, 2, 3, 4, 5, 6)
    const numRow = sheet.addRow(['1', '2', '3', '4', '5', '6']);

    numRow.eachCell((cell) => {
        cell.font = { italic: true, size: 9 };
        cell.alignment = { horizontal: 'center' };
        cell.border = {
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' },
        };
    });

    // Data rows — only complete holdings with quantity > 0
    const validHoldings = holdings
        .filter(h => h.symbol && h.quantity > 0 && h.country !== 'България');

    for (const h of validHoldings) {
        const totalCcy = h.quantity * h.unitPrice;
        const totalBgn = toBaseCurrency(totalCcy, h.currency, h.dateAcquired, 'BGN', fxRates);
        const bgnValue = isNaN(totalBgn) ? 0 : totalBgn;

        const row = sheet.addRow([
            'Акции',
            h.country,
            h.quantity,
            h.dateAcquired,
            totalCcy,
            bgnValue,
        ]);

        // Format cells
        row.getCell(1).alignment = { horizontal: 'left' };
        row.getCell(2).alignment = { horizontal: 'left' };
        row.getCell(3).numFmt = '0.00000000';
        row.getCell(3).alignment = { horizontal: 'right' };
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(5).numFmt = '#,##0.00';
        row.getCell(5).alignment = { horizontal: 'right' };
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(6).alignment = { horizontal: 'right' };
        row.getCell(5).alignment = { horizontal: 'right' };
        row.getCell(6).alignment = { horizontal: 'right' };

        // Borders
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' },
            };
        });
    }

    // Column widths matching NRA form proportions
    sheet.getColumn(1).width = 12;
    sheet.getColumn(2).width = 20;
    sheet.getColumn(3).width = 16;
    sheet.getColumn(4).width = 22;
    sheet.getColumn(5).width = 20;
    sheet.getColumn(6).width = 16;

    const buf = await workbook.xlsx.writeBuffer();

    return new Uint8Array(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer);
}
