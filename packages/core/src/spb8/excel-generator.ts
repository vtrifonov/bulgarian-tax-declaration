import * as ExcelJS from 'exceljs';

import type { Spb8FormData } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Styles (matching Python reference)
// ─────────────────────────────────────────────────────────────────────────────

const TITLE_FONT = { name: 'Times New Roman', size: 12, bold: true };
const NORMAL_FONT = { name: 'Times New Roman', size: 9 };
const BOLD_FONT = { name: 'Times New Roman', size: 9, bold: true };
const SMALL_FONT = { name: 'Times New Roman', size: 8 };
const HEADER_FONT = { name: 'Times New Roman', size: 9, bold: true };
const ITALIC_SMALL = { name: 'Times New Roman', size: 8, italic: true };
const TINY_FONT = { name: 'Times New Roman', size: 7 };
const TINY_BOLD = { name: 'Times New Roman', size: 7, bold: true };
const YEAR_FONT = { name: 'Times New Roman', size: 11, bold: true };

const THIN_SIDE = { style: 'thin' as const };
const THIN_BORDER = {
    left: THIN_SIDE,
    right: THIN_SIDE,
    top: THIN_SIDE,
    bottom: THIN_SIDE,
};
const BOTTOM_BORDER = { bottom: THIN_SIDE };

const CENTER = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
const LEFT_WRAP = { horizontal: 'left' as const, vertical: 'middle' as const, wrapText: true };
const RIGHT_CENTER = { horizontal: 'right' as const, vertical: 'middle' as const };
const LEFT_CENTER = { horizontal: 'left' as const, vertical: 'middle' as const };

const GRAY_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };

// ─────────────────────────────────────────────────────────────────────────
// Sanitization function to prevent CSV formula injection
// ─────────────────────────────────────────────────────────────────────────

function sanitizeForExcel(value: string | number | undefined): string | number | undefined {
    if (typeof value !== 'string') {
        return value;
    }

    // Prefix with apostrophe if starts with formula characters
    if (value.length > 0 && '=+-@'.includes(value[0])) {
        return `'${value}`;
    }

    return value;
}

// Column widths for 22 columns (A-V)
const COL_WIDTHS = {
    1: 5,
    2: 5,
    3: 5,
    4: 5,
    5: 5,
    6: 4,
    7: 3,
    8: 6,
    9: 6,
    10: 5,
    11: 5,
    12: 5,
    13: 5,
    14: 6,
    15: 6,
    16: 5,
    17: 5,
    18: 6,
    19: 6,
    20: 5,
    21: 5,
    22: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper to merge cells and apply styling (equivalent to Python merge_and_set)
// ─────────────────────────────────────────────────────────────────────────────

function mergeAndSet(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
    value: string | number | undefined,
    font?: Partial<ExcelJS.Font>,
    alignment?: Partial<ExcelJS.Alignment>,
    border?: Partial<ExcelJS.Borders>,
    fill?: ExcelJS.FillPattern,
) {
    // Merge cells if range spans multiple cells
    if (endRow > startRow || endCol > startCol) {
        try {
            sheet.mergeCells(startRow, startCol, endRow, endCol);
        } catch {
            // Cell already merged, skip
        }
    }

    // Set value and font in the top-left cell
    const cell = sheet.getCell(startRow, startCol);

    cell.value = value;

    if (font) {
        cell.font = font;
    }

    if (alignment) {
        cell.alignment = alignment;
    }

    if (fill) {
        cell.fill = fill;
    }

    // Apply border to all cells in the range if specified
    if (border) {
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const currentCell = sheet.getCell(r, c);

                if (!currentCell.isMerged) {
                    currentCell.border = border;
                } else {
                    currentCell.border = border;
                }
            }
        }
    }
}

// Helper to apply border to a range in a single row
function applyBorderRange(
    sheet: ExcelJS.Worksheet,
    row: number,
    colStart: number,
    colEnd: number,
    border?: Partial<ExcelJS.Borders>,
) {
    const b = border ?? THIN_BORDER;

    for (let c = colStart; c <= colEnd; c++) {
        sheet.getCell(row, c).border = b;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────────────────────

export async function generateSpb8Excel(formData: Spb8FormData): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();

    workbook.created = new Date(0);
    workbook.modified = new Date(0);
    const sheet = workbook.addWorksheet('СПБ-8');

    // Set column widths
    for (let c = 1; c <= 22; c++) {
        sheet.getColumn(c).width = COL_WIDTHS[c as keyof typeof COL_WIDTHS];
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Header
    // ──────────────────────────────────────────────────────────────────────────

    mergeAndSet(sheet, 1, 1, 1, 22, 'Образец по чл. 13', SMALL_FONT, RIGHT_CENTER);
    mergeAndSet(sheet, 2, 2, 1, 22, 'Форма СПБ-8', TITLE_FONT, CENTER);
    mergeAndSet(
        sheet,
        3,
        3,
        1,
        22,
        'Годишен отчет за вземанията и задълженията на местни физически лица от/към чуждестранни лица',
        BOLD_FONT,
        CENTER,
    );

    // Year
    mergeAndSet(sheet, 5, 5, 9, 10, 'за', NORMAL_FONT, RIGHT_CENTER);
    const yearCell = sheet.getCell(5, 11);

    yearCell.value = formData.year;
    yearCell.font = YEAR_FONT;
    yearCell.border = BOTTOM_BORDER;
    mergeAndSet(sheet, 5, 5, 12, 14, 'година', NORMAL_FONT, LEFT_CENTER);

    // Report type (P = initial, R = corrective)
    mergeAndSet(sheet, 7, 7, 9, 11, 'Тип на отчета:', NORMAL_FONT);

    const reportCell = sheet.getCell(8, 10);

    reportCell.value = 'X';
    reportCell.font = BOLD_FONT;
    reportCell.border = THIN_BORDER;
    reportCell.alignment = CENTER;

    mergeAndSet(sheet, 8, 8, 11, 12, 'първоначален', NORMAL_FONT, LEFT_CENTER);

    sheet.getCell(8, 14).border = THIN_BORDER;
    mergeAndSet(sheet, 8, 8, 15, 16, 'коригиращ', NORMAL_FONT, LEFT_CENTER);

    // ──────────────────────────────────────────────────────────────────────────
    // Section 1: Personal Data
    // ──────────────────────────────────────────────────────────────────────────

    mergeAndSet(sheet, 11, 11, 1, 22, '1. МЕСТНО ФИЗИЧЕСКО ЛИЦЕ', BOLD_FONT, LEFT_WRAP);
    mergeAndSet(sheet, 12, 12, 1, 6, '1.1. Име и фамилия:', NORMAL_FONT, LEFT_WRAP);
    mergeAndSet(
        sheet,
        12,
        12,
        7,
        22,
        sanitizeForExcel(formData.personalData?.name ?? ''),
        NORMAL_FONT,
        LEFT_WRAP,
        BOTTOM_BORDER,
    );
    mergeAndSet(sheet, 13, 13, 1, 6, '1.2. ЕГН/ЛНЧ:', NORMAL_FONT, LEFT_WRAP);
    mergeAndSet(
        sheet,
        13,
        13,
        7,
        22,
        sanitizeForExcel(formData.personalData?.egn ?? ''),
        NORMAL_FONT,
        LEFT_WRAP,
        BOTTOM_BORDER,
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Section 2: Foreign Receivables / Liabilities
    // ──────────────────────────────────────────────────────────────────────────

    mergeAndSet(
        sheet,
        16,
        16,
        1,
        22,
        '2. ВЗЕМАНИЯ (ЗАДЪЛЖЕНИЯ) ОТ (КЪМ) ЧУЖДЕСТРАННИ ЛИЦА',
        BOLD_FONT,
        LEFT_WRAP,
    );

    // Sub-sections 01–03 column headers (rows 18–19)
    mergeAndSet(
        sheet,
        18,
        19,
        1,
        8,
        'ТИП НА ВЗЕМАНЕТО/ЗАДЪЛЖЕНИЕТО',
        HEADER_FONT,
        CENTER,
        THIN_BORDER,
        GRAY_FILL,
    );
    mergeAndSet(sheet, 18, 19, 9, 10, 'Матуритет', HEADER_FONT, CENTER, THIN_BORDER, GRAY_FILL);
    mergeAndSet(sheet, 18, 19, 11, 12, 'Държава', HEADER_FONT, CENTER, THIN_BORDER, GRAY_FILL);
    mergeAndSet(sheet, 18, 19, 13, 14, 'Валута', HEADER_FONT, CENTER, THIN_BORDER, GRAY_FILL);

    // Top header for amount section (18-18) spans both start and end
    mergeAndSet(
        sheet,
        18,
        18,
        15,
        22,
        'Размер в хиляди валутни единици',
        HEADER_FONT,
        CENTER,
        THIN_BORDER,
        GRAY_FILL,
    );

    // Apply gray fill and borders to row 19 for amount columns (they're not merged vertically)
    for (let c = 15; c <= 22; c++) {
        const cell = sheet.getCell(19, c);

        cell.border = THIN_BORDER;
        cell.fill = GRAY_FILL;
        cell.font = SMALL_FONT;
        cell.alignment = CENTER;
    }

    // Now set the sub-header values in row 19
    sheet.getCell(19, 15).value = 'В началото на отчетната година';
    sheet.mergeCells(19, 15, 19, 18);

    sheet.getCell(19, 19).value = 'В края на отчетната година';
    sheet.mergeCells(19, 19, 19, 22);

    // Sub-section rows 01–03 labels
    const sectionLabels = [
        { row: 20, label: '01. Предоставени финансови кредити' },
        { row: 21, label: '02. Получени финансови кредити' },
        { row: 22, label: '03. Сметки, открити в чужбина' },
    ];

    for (const { row, label } of sectionLabels) {
        mergeAndSet(sheet, row, row, 1, 8, label, NORMAL_FONT, LEFT_WRAP, THIN_BORDER);
        applyBorderRange(sheet, row, 9, 22);
    }

    // Write accounts data (overwrite/add to section 03)
    let nextRow = 23;

    if (formData.accounts.length > 0) {
        for (let idx = 0; idx < formData.accounts.length; idx++) {
            const account = formData.accounts[idx];
            const r = 22 + idx;

            let labelText = '';

            if (idx === 0) {
                labelText = '03. Сметки, открити в чужбина';
            }

            mergeAndSet(sheet, r, r, 1, 8, labelText, NORMAL_FONT, LEFT_WRAP, THIN_BORDER);
            mergeAndSet(sheet, r, r, 9, 10, sanitizeForExcel(account.maturity), NORMAL_FONT, CENTER, THIN_BORDER);
            mergeAndSet(sheet, r, r, 11, 12, sanitizeForExcel(account.country), NORMAL_FONT, CENTER, THIN_BORDER);
            mergeAndSet(sheet, r, r, 13, 14, sanitizeForExcel(account.currency), NORMAL_FONT, CENTER, THIN_BORDER);

            const startK = Math.round(account.amountStartOfYear / 1000);

            mergeAndSet(sheet, r, r, 15, 18, startK, NORMAL_FONT, CENTER, THIN_BORDER);

            const endK = Math.round(account.amountEndOfYear / 1000);

            mergeAndSet(sheet, r, r, 19, 22, endK, NORMAL_FONT, CENTER, THIN_BORDER);

            nextRow = r + 1;
        }
    }

    // Sub-section 04 column headers
    const h1 = nextRow + 1;
    const h2 = h1 + 1;

    mergeAndSet(
        sheet,
        h1,
        h2,
        1,
        8,
        'ТИП НА ВЗЕМАНЕТО',
        HEADER_FONT,
        CENTER,
        THIN_BORDER,
        GRAY_FILL,
    );
    mergeAndSet(sheet, h1, h2, 9, 14, 'ISIN', HEADER_FONT, CENTER, THIN_BORDER, GRAY_FILL);

    // Top header for size section spans both rows
    mergeAndSet(sheet, h1, h1, 15, 22, 'Размер', HEADER_FONT, CENTER, THIN_BORDER, GRAY_FILL);

    // Apply gray fill and borders to row h2 for size columns
    for (let c = 15; c <= 22; c++) {
        const cell = sheet.getCell(h2, c);

        cell.border = THIN_BORDER;
        cell.fill = GRAY_FILL;
        cell.font = SMALL_FONT;
        cell.alignment = CENTER;
    }

    // Now set the sub-header values in row h2
    sheet.getCell(h2, 15).value = 'В началото на отчетната година';
    sheet.mergeCells(h2, 15, h2, 18);

    sheet.getCell(h2, 19).value = 'В края на отчетната година';
    sheet.mergeCells(h2, 19, h2, 22);

    // Securities data rows
    let row = h2 + 1;

    for (let idx = 0; idx < formData.securities.length; idx++) {
        const security = formData.securities[idx];
        const label = idx === 0 ? '04. Придобити ценни книжа' : '';

        mergeAndSet(sheet, row, row, 1, 8, label, NORMAL_FONT, LEFT_WRAP, THIN_BORDER);
        mergeAndSet(sheet, row, row, 9, 14, sanitizeForExcel(security.isin), NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(
            sheet,
            row,
            row,
            15,
            18,
            Math.round(security.quantityStartOfYear),
            NORMAL_FONT,
            CENTER,
            THIN_BORDER,
        );
        mergeAndSet(
            sheet,
            row,
            row,
            19,
            22,
            Math.round(security.quantityEndOfYear),
            NORMAL_FONT,
            CENTER,
            THIN_BORDER,
        );
        row++;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Footer
    // ──────────────────────────────────────────────────────────────────────────

    row++;
    mergeAndSet(
        sheet,
        row,
        row,
        1,
        22,
        ' Известно ми е, че за посочването на неверни данни нося отговорност по чл. 313 от Наказателния кодекс.',
        ITALIC_SMALL,
        LEFT_WRAP,
    );

    row++;
    mergeAndSet(sheet, row, row, 1, 22, 'СЪСТАВИЛ ОТЧЕТА', BOLD_FONT, LEFT_WRAP);

    row++;
    mergeAndSet(sheet, row, row, 1, 4, 'Име и фамилия:', NORMAL_FONT, LEFT_WRAP);
    mergeAndSet(sheet, row, row, 8, 10, 'Длъжност:', NORMAL_FONT, LEFT_WRAP);
    mergeAndSet(sheet, row, row, 15, 17, 'Подпис:', NORMAL_FONT, LEFT_WRAP);

    row++;
    mergeAndSet(sheet, row, row, 1, 4, 'Телефон:', NORMAL_FONT, LEFT_WRAP);

    row++;
    mergeAndSet(sheet, row, row, 1, 4, 'Електронна поща:', NORMAL_FONT, LEFT_WRAP);

    row++;
    mergeAndSet(sheet, row, row, 1, 4, 'Дата:', NORMAL_FONT, LEFT_WRAP);

    row += 2;
    mergeAndSet(
        sheet,
        row,
        row,
        1,
        22,
        'Българската народна банка е Администратор на лични данни. Предоставените от Вас лични данни се събират и обработват за целите на Наредба № 27 на БНБ.',
        TINY_FONT,
        LEFT_WRAP,
    );

    row += 2;
    mergeAndSet(
        sheet,
        row,
        row,
        1,
        22,
        'БЪЛГАРСКА НАРОДНА БАНКА, пл. "Княз Александър I" № 1, София 1000, дирекция "Статистика", тел. (02) 9145 1071, (02) 9145 1523',
        TINY_BOLD,
        CENTER,
    );

    // Convert to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new Uint8Array(buffer as ArrayBuffer);
}
