import * as ExcelJS from 'exceljs';

import { calcDividendRowTax } from '../fx/convert.js';
import type { Dividend } from '../types/index.js';

/**
 * Generate an Excel file matching the NRA Приложение 8, Част III format
 * for uploading dividend tax data to the tax portal.
 *
 * Columns: № | Наименование | Държава | Код вид доход | Код метод | Брутен размер |
 *          Цена на придобиване | Положителна разлика | Платен данък в чужбина |
 *          Допустим размер кредит | Признат кредит | Дължим данък
 */
export async function generateNraAppendix8Part3(
    dividends: Dividend[],
    fxRates: Record<string, Record<string, number>>,
): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Приложение 8 Част III');

    const headers = [
        '№',
        'Наименование на лицето, изплатило дохода',
        'Държава',
        'Код вид доход',
        'Код за прилагане на метод',
        'Брутен размер на дохода',
        'Документално доказана цена на придобиване',
        'Положителна разлика между колона 6 и колона 7',
        'Платен данък в чужбина',
        'Допустим размер на данъчния кредит',
        'Размер на признатия данъчен кредит',
        'Дължим данък',
    ];

    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = thinBorder();
    });
    headerRow.height = 60;

    // Column number row
    const numRow = sheet.addRow(Array.from({ length: 12 }, (_, i) => String(i + 1)));

    numRow.eachCell((cell) => {
        cell.font = { italic: true, size: 9 };
        cell.alignment = { horizontal: 'center' };
        cell.border = thinBorder();
    });

    // Filter and sort dividends
    const sorted = dividends
        .filter(d => d.symbol && d.grossAmount > 0)
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));

    let rowNum = 1;

    for (const d of sorted) {
        const { grossBase, whtBase, tax5pct, bgTaxDue } = calcDividendRowTax(
            d.grossAmount,
            d.withholdingTax,
            d.currency,
            d.date,
            'BGN',
            fxRates,
        );
        const recognizedCredit = Math.min(whtBase, tax5pct);

        const row = sheet.addRow([
            `${rowNum}.1`,
            d.symbol,
            d.country,
            8141,
            1,
            round2(grossBase),
            0,
            0,
            round2(whtBase),
            round2(tax5pct),
            round2(recognizedCredit),
            round2(bgTaxDue),
        ]);

        row.eachCell((cell, colNumber) => {
            cell.border = thinBorder();

            if (colNumber >= 6) {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right' };
            }
        });
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(5).alignment = { horizontal: 'center' };

        rowNum++;
    }

    // Totals row
    const totals = sorted.reduce((acc, d) => {
        const { grossBase, whtBase, tax5pct, bgTaxDue } = calcDividendRowTax(
            d.grossAmount,
            d.withholdingTax,
            d.currency,
            d.date,
            'BGN',
            fxRates,
        );

        acc.gross += grossBase;
        acc.wht += whtBase;
        acc.tax5 += tax5pct;
        acc.credit += Math.min(whtBase, tax5pct);
        acc.due += bgTaxDue;

        return acc;
    }, { gross: 0, wht: 0, tax5: 0, credit: 0, due: 0 });

    const totalRow = sheet.addRow([
        '',
        '',
        '',
        '',
        'Общо:',
        round2(totals.gross),
        0,
        0,
        round2(totals.wht),
        round2(totals.tax5),
        round2(totals.credit),
        round2(totals.due),
    ]);

    totalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, size: 10 };
        cell.border = thinBorder();

        if (colNumber >= 6) {
            cell.numFmt = '#,##0.00';
            cell.alignment = { horizontal: 'right' };
        }
    });
    totalRow.getCell(5).alignment = { horizontal: 'right' };

    // Column widths
    const widths = [6, 22, 14, 10, 10, 14, 14, 14, 14, 14, 14, 14];

    widths.forEach((w, i) => {
        sheet.getColumn(i + 1).width = w;
    });

    const buf = await workbook.xlsx.writeBuffer();

    return new Uint8Array(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer);
}

function thinBorder(): Partial<ExcelJS.Borders> {
    return {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
    };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
