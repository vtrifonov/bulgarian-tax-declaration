import * as ExcelJS from 'exceljs';

import type { Spb8FormData } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Styles (matching Python reference)
// ─────────────────────────────────────────────────────────────────────────────

const TITLE_FONT = { name: 'Arial', size: 14, bold: true };
const NORMAL_FONT = { name: 'Arial', size: 10 };
const BOLD_FONT = { name: 'Arial', size: 10, bold: true };
const SMALL_FONT = { name: 'Arial', size: 10 };
const HEADER_FONT = { name: 'Arial', size: 10, bold: true };
const ITALIC_SMALL = { name: 'Arial', size: 10, italic: true };
const TINY_FONT = { name: 'Arial', size: 10 };
const TINY_BOLD = { name: 'Arial', size: 10, bold: true };
const YEAR_FONT = { name: 'Arial', size: 10, bold: true };
const SUBTITLE_FONT = { name: 'Arial', size: 12, bold: true };

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
const TOP_CENTER = { horizontal: 'center' as const, vertical: 'top' as const, wrapText: true };

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF4C7A1' } };
const SECTION_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF4C7A1' } };

const BASE_ROW_HEIGHT = 15;
const TALL_SUBHEADER_ROW_HEIGHT = BASE_ROW_HEIGHT * 2;

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

function toExcelAddressValue(value: string | undefined): string | number | undefined {
    if (!value) {
        return value;
    }

    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
    }

    return sanitizeForExcel(trimmed);
}

function toExcelNumericTextValue(value: string | undefined): string | number | undefined {
    if (!value) {
        return value;
    }

    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
    }

    return sanitizeForExcel(trimmed);
}

// Column widths for 22 columns (A-V)
const COL_WIDTHS = {
    1: 5.5,
    2: 5.5,
    3: 5.5,
    4: 5.5,
    5: 5.5,
    6: 4.4,
    7: 3.3,
    8: 6.6,
    9: 6.6,
    10: 5.5,
    11: 5.5,
    12: 5.5,
    13: 6.6,
    14: 6.6,
    15: 6.6,
    16: 5.5,
    17: 5.5,
    18: 6.6,
    19: 6.6,
    20: 5.5,
    21: 5.5,
    22: 3.3,
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

function applyOuterBorder(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
) {
    for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
            const cell = sheet.getCell(r, c);
            const existingBorder = cell.border ?? {};
            const border: Partial<ExcelJS.Borders> = {
                top: r === startRow ? THIN_SIDE : existingBorder.top,
                bottom: r === endRow ? THIN_SIDE : existingBorder.bottom,
                left: c === startCol ? THIN_SIDE : existingBorder.left,
                right: c === endCol ? THIN_SIDE : existingBorder.right,
            };

            cell.border = border;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────────────────────

function addLabeledValueRow(
    sheet: ExcelJS.Worksheet,
    row: number,
    labelStartCol: number,
    labelEndCol: number,
    valueStartCol: number,
    valueEndCol: number,
    label: string,
    value: string | number | undefined,
) {
    mergeAndSet(sheet, row, row, labelStartCol, labelEndCol, label, NORMAL_FONT, LEFT_WRAP);
    mergeAndSet(sheet, row, row, valueStartCol, valueEndCol, sanitizeForExcel(value), NORMAL_FONT, LEFT_WRAP, BOTTOM_BORDER);
}

export async function generateSpb8Excel(formData: Spb8FormData): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();

    workbook.created = new Date(0);
    workbook.modified = new Date(0);
    const sheet = workbook.addWorksheet('СПБ-8');

    sheet.views = [{ showGridLines: false }];
    sheet.pageSetup.printArea = 'A:V';
    sheet.getColumn(23).hidden = true;

    // Set column widths
    for (let c = 1; c <= 22; c++) {
        sheet.getColumn(c).width = COL_WIDTHS[c as keyof typeof COL_WIDTHS];
    }

    sheet.getRow(2).height = 20;
    sheet.getRow(9).height = 0;
    sheet.getRow(9).hidden = true;
    sheet.getRow(11).height = 22;
    sheet.getRow(23).height = 22;

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
        SUBTITLE_FONT,
        CENTER,
    );

    // Year
    mergeAndSet(sheet, 5, 5, 9, 9, 'за', NORMAL_FONT, RIGHT_CENTER);
    mergeAndSet(sheet, 5, 5, 10, 13, formData.year, YEAR_FONT, CENTER, THIN_BORDER);
    mergeAndSet(sheet, 5, 5, 14, 15, 'година', NORMAL_FONT, LEFT_CENTER);

    // Report type (P = initial, R = corrective)
    mergeAndSet(sheet, 7, 7, 6, 9, 'Тип на отчета:', BOLD_FONT, RIGHT_CENTER);
    mergeAndSet(sheet, 7, 7, 10, 10, formData.reportType === 'P' ? 'X' : '', BOLD_FONT, CENTER, THIN_BORDER);
    mergeAndSet(sheet, 7, 7, 13, 13, formData.reportType === 'R' ? 'X' : '', BOLD_FONT, CENTER, THIN_BORDER);
    mergeAndSet(sheet, 8, 8, 10, 12, 'първоначален', BOLD_FONT, LEFT_CENTER);
    mergeAndSet(sheet, 8, 8, 13, 15, 'коригиращ', BOLD_FONT, LEFT_CENTER);

    // ──────────────────────────────────────────────────────────────────────────
    // Section 1: Personal Data
    // ──────────────────────────────────────────────────────────────────────────

    mergeAndSet(sheet, 11, 11, 1, 22, '1. МЕСТНО ФИЗИЧЕСКО ЛИЦЕ', BOLD_FONT, LEFT_WRAP, THIN_BORDER, SECTION_FILL);
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
        toExcelNumericTextValue(formData.personalData?.egn),
        NORMAL_FONT,
        LEFT_WRAP,
        BOTTOM_BORDER,
    );
    applyOuterBorder(sheet, 11, 13, 1, 22);
    mergeAndSet(sheet, 14, 14, 1, 22, '', NORMAL_FONT, LEFT_WRAP);
    mergeAndSet(
        sheet,
        15,
        15,
        1,
        22,
        'Попълва се само при първоначална регистрация и при промяна на регистрацията в БНБ:',
        ITALIC_SMALL,
        CENTER,
    );
    mergeAndSet(sheet, 16, 16, 1, 22, 'Адрес на местоживеене', BOLD_FONT, LEFT_WRAP);
    addLabeledValueRow(sheet, 17, 1, 6, 7, 15, 'Населено място:', formData.personalData?.address?.city ?? '');
    addLabeledValueRow(sheet, 17, 16, 18, 19, 22, 'Пощенски код:', toExcelAddressValue(formData.personalData?.address?.postalCode));
    addLabeledValueRow(sheet, 18, 1, 3, 4, 7, 'Кв./ж.к', formData.personalData?.address?.district ?? '');
    addLabeledValueRow(sheet, 18, 8, 10, 11, 15, 'Улица:', formData.personalData?.address?.street ?? '');
    addLabeledValueRow(sheet, 18, 16, 16, 17, 18, '№', toExcelAddressValue(formData.personalData?.address?.number));
    addLabeledValueRow(sheet, 18, 19, 19, 20, 22, 'вх./ап.', toExcelAddressValue(formData.personalData?.address?.entrance));
    // Phone: use RichText to force text type and avoid Excel "Number Stored as Text" warning
    mergeAndSet(sheet, 19, 19, 1, 4, 'Телефон:', NORMAL_FONT, LEFT_WRAP);
    mergeAndSet(sheet, 19, 19, 5, 22, '', NORMAL_FONT, LEFT_WRAP, BOTTOM_BORDER);
    const phoneCell = sheet.getCell(19, 5);
    const phoneVal = formData.personalData?.phone ?? '';

    phoneCell.value = { richText: [{ font: NORMAL_FONT, text: phoneVal }] };
    phoneCell.numFmt = '@';
    mergeAndSet(
        sheet,
        20,
        20,
        1,
        22,
        `Електронни съобщения на БНБ във връзка с подадените документи ще приемам на следния електронен адрес: ${formData.personalData?.email ?? ''}`.trim(),
        NORMAL_FONT,
        LEFT_WRAP,
        BOTTOM_BORDER,
    );
    applyOuterBorder(sheet, 15, 20, 1, 22);

    // ──────────────────────────────────────────────────────────────────────────
    // Section 2: Foreign Receivables / Liabilities
    // ──────────────────────────────────────────────────────────────────────────

    mergeAndSet(
        sheet,
        22,
        22,
        1,
        22,
        '2. ВЗЕМАНИЯ (ЗАДЪЛЖЕНИЯ) ОТ (КЪМ) ЧУЖДЕСТРАННИ ЛИЦА',
        BOLD_FONT,
        LEFT_WRAP,
        THIN_BORDER,
        SECTION_FILL,
    );

    // Sub-sections 01–03 column headers (rows 23–24)
    mergeAndSet(
        sheet,
        23,
        24,
        1,
        8,
        'ТИП НА ВЗЕМАНЕТО/ЗАДЪЛЖЕНИЕТО',
        HEADER_FONT,
        CENTER,
        THIN_BORDER,
        HEADER_FILL,
    );
    sheet.getRow(24).height = TALL_SUBHEADER_ROW_HEIGHT;
    mergeAndSet(sheet, 23, 24, 9, 10, 'Матуритет', HEADER_FONT, CENTER, THIN_BORDER, HEADER_FILL);
    mergeAndSet(sheet, 23, 24, 11, 12, 'Държава', HEADER_FONT, CENTER, THIN_BORDER, HEADER_FILL);
    mergeAndSet(sheet, 23, 24, 13, 14, 'Валута', HEADER_FONT, CENTER, THIN_BORDER, HEADER_FILL);

    // Top header for amount section (18-18) spans both start and end
    mergeAndSet(
        sheet,
        23,
        23,
        15,
        22,
        'Размер в хиляди валутни единици',
        HEADER_FONT,
        CENTER,
        THIN_BORDER,
        HEADER_FILL,
    );

    // Apply gray fill and borders to row 19 for amount columns (they're not merged vertically)
    for (let c = 15; c <= 22; c++) {
        const cell = sheet.getCell(24, c);

        cell.border = THIN_BORDER;
        cell.fill = HEADER_FILL;
        cell.font = SMALL_FONT;
        cell.alignment = CENTER;
    }

    // Now set the sub-header values in row 19
    sheet.getCell(24, 15).value = 'В началото на отчетната година';
    sheet.mergeCells(24, 15, 24, 18);

    sheet.getCell(24, 19).value = 'В края на отчетната година';
    sheet.mergeCells(24, 19, 24, 22);

    // Sub-section rows 01–03 labels
    const sectionLabels = [
        { row: 25, label: '01. Предоставени финансови кредити' },
        { row: 26, label: '02. Получени финансови кредити' },
    ];

    for (const { row, label } of sectionLabels) {
        mergeAndSet(sheet, row, row, 1, 8, label, NORMAL_FONT, LEFT_WRAP, THIN_BORDER);
        mergeAndSet(sheet, row, row, 9, 10, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, row, row, 11, 12, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, row, row, 13, 14, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, row, row, 15, 18, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, row, row, 19, 22, '', NORMAL_FONT, CENTER, THIN_BORDER);
    }

    // Write accounts data (overwrite/add to section 03)
    let nextRow = 22;

    if (formData.accounts.length > 0) {
        const accountsStartRow = 27;
        const accountsEndRow = accountsStartRow + formData.accounts.length - 1;

        mergeAndSet(
            sheet,
            accountsStartRow,
            accountsEndRow,
            1,
            8,
            '03. Сметки, открити в чужбина',
            NORMAL_FONT,
            LEFT_WRAP,
            THIN_BORDER,
        );

        for (let idx = 0; idx < formData.accounts.length; idx++) {
            const account = formData.accounts[idx];
            const r = 27 + idx;

            mergeAndSet(sheet, r, r, 9, 10, sanitizeForExcel(account.maturity), NORMAL_FONT, CENTER, THIN_BORDER);
            mergeAndSet(sheet, r, r, 11, 12, sanitizeForExcel(account.country), NORMAL_FONT, CENTER, THIN_BORDER);
            mergeAndSet(sheet, r, r, 13, 14, sanitizeForExcel(account.currency), NORMAL_FONT, CENTER, THIN_BORDER);

            const startK = account.amountStartOfYear / 1000;

            mergeAndSet(sheet, r, r, 15, 18, Math.round(startK * 100) / 100, NORMAL_FONT, CENTER, THIN_BORDER);
            sheet.getCell(r, 15).numFmt = '0.00';

            const endK = account.amountEndOfYear / 1000;

            mergeAndSet(sheet, r, r, 19, 22, Math.round(endK * 100) / 100, NORMAL_FONT, CENTER, THIN_BORDER);
            sheet.getCell(r, 19).numFmt = '0.00';

            nextRow = r + 1;
        }
    } else {
        mergeAndSet(sheet, 27, 27, 1, 8, '03. Сметки, открити в чужбина', NORMAL_FONT, LEFT_WRAP, THIN_BORDER);
        mergeAndSet(sheet, 27, 27, 9, 10, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, 27, 27, 11, 12, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, 27, 27, 13, 14, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, 27, 27, 15, 18, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, 27, 27, 19, 22, '', NORMAL_FONT, CENTER, THIN_BORDER);
        nextRow = 28;
    }

    // Sub-section 04 column headers
    const h1 = nextRow + 1;
    const h2 = h1 + 1;
    const exportableSecurities = formData.securities.filter((security) => {
        const startQty = Math.round(security.quantityStartOfYear * 100) / 100;
        const endQty = Math.round(security.quantityEndOfYear * 100) / 100;

        return startQty !== 0 || endQty !== 0;
    });

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
        HEADER_FILL,
    );
    mergeAndSet(sheet, h1, h2, 9, 14, 'ISIN', HEADER_FONT, CENTER, THIN_BORDER, HEADER_FILL);

    // Top header for size section spans both rows
    mergeAndSet(sheet, h1, h1, 15, 22, 'Размер', HEADER_FONT, CENTER, THIN_BORDER, HEADER_FILL);

    // Apply gray fill and borders to row h2 for size columns
    sheet.getRow(h2).height = TALL_SUBHEADER_ROW_HEIGHT;

    for (let c = 15; c <= 22; c++) {
        const cell = sheet.getCell(h2, c);

        cell.border = THIN_BORDER;
        cell.fill = HEADER_FILL;
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

    if (exportableSecurities.length > 0) {
        const securitiesStartRow = h2 + 1;
        const securitiesEndRow = securitiesStartRow + exportableSecurities.length - 1;

        mergeAndSet(
            sheet,
            securitiesStartRow,
            securitiesEndRow,
            1,
            8,
            '04. Придобити ценни книжа',
            NORMAL_FONT,
            LEFT_WRAP,
            THIN_BORDER,
        );
    } else {
        mergeAndSet(sheet, row, row, 1, 8, '04. Придобити ценни книжа', NORMAL_FONT, LEFT_WRAP, THIN_BORDER);
        mergeAndSet(sheet, row, row, 9, 14, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, row, row, 15, 18, '', NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(sheet, row, row, 19, 22, '', NORMAL_FONT, CENTER, THIN_BORDER);
        row++;
    }

    for (let idx = 0; idx < exportableSecurities.length; idx++) {
        const security = exportableSecurities[idx];

        mergeAndSet(sheet, row, row, 9, 14, sanitizeForExcel(security.isin), NORMAL_FONT, CENTER, THIN_BORDER);
        mergeAndSet(
            sheet,
            row,
            row,
            15,
            18,
            Math.round(security.quantityStartOfYear * 100) / 100,
            NORMAL_FONT,
            CENTER,
            THIN_BORDER,
        );
        sheet.getCell(row, 15).numFmt = '0.00';
        mergeAndSet(
            sheet,
            row,
            row,
            19,
            22,
            Math.round(security.quantityEndOfYear * 100) / 100,
            NORMAL_FONT,
            CENTER,
            THIN_BORDER,
        );
        sheet.getCell(row, 19).numFmt = '0.00';
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
        'Известно ми е, че за посочването на неверни данни нося отговорност по чл. 313 от Наказателния кодекс.',
        ITALIC_SMALL,
        CENTER,
    );

    row++;
    mergeAndSet(sheet, row, row, 1, 22, 'СЪСТАВИЛ ОТЧЕТА', BOLD_FONT, LEFT_WRAP, THIN_BORDER, SECTION_FILL);

    row++;
    const footerTopRow = row;
    const footerBottomRow = row + 3;

    mergeAndSet(sheet, footerTopRow, footerTopRow, 1, 9, 'Име и фамилия:', NORMAL_FONT, LEFT_WRAP, BOTTOM_BORDER);
    mergeAndSet(sheet, footerTopRow, footerTopRow, 10, 14, 'Длъжност:', NORMAL_FONT, LEFT_WRAP, BOTTOM_BORDER);
    mergeAndSet(sheet, footerTopRow, footerBottomRow, 15, 22, 'Подпис:', NORMAL_FONT, TOP_CENTER, THIN_BORDER);

    mergeAndSet(sheet, footerTopRow + 1, footerTopRow + 1, 1, 14, 'Телефон:', NORMAL_FONT, LEFT_WRAP, BOTTOM_BORDER);
    mergeAndSet(sheet, footerTopRow + 2, footerTopRow + 2, 1, 14, 'Електронна поща:', NORMAL_FONT, LEFT_WRAP, BOTTOM_BORDER);
    mergeAndSet(sheet, footerTopRow + 3, footerTopRow + 3, 1, 14, 'Дата:', NORMAL_FONT, LEFT_WRAP, BOTTOM_BORDER);

    row = footerBottomRow + 2;
    sheet.getRow(row).height = 22;
    sheet.getRow(row + 1).height = 22;
    sheet.getRow(row + 2).height = 22;
    mergeAndSet(
        sheet,
        row,
        row + 2,
        1,
        22,
        'Българската народна банка е Администратор на лични данни, вписан в регистъра на администраторите на лични данни под № 0017806, представлявана от нейния Управител. Предоставените от Вас лични данни се събират и обработват за целите на Наредба № 27 на БНБ. Трети лица могат да получат информация само по реда и при условия на закона. Разполагате с право на достъп и право на коригиране на събраните лични данни.',
        TINY_FONT,
        CENTER,
    );

    row += 4;
    mergeAndSet(
        sheet,
        row,
        row,
        1,
        22,
        'Електронният вариант на формата се намира на интернет страницата на БНБ на адрес www.bnb.bg',
        TINY_FONT,
        CENTER,
    );

    row += 2;
    mergeAndSet(
        sheet,
        row,
        row,
        1,
        22,
        'БЪЛГАРСКА НАРОДНА БАНКА, пл. "Княз Александър I" № 1, София 1000,',
        TINY_BOLD,
        CENTER,
    );
    row++;
    mergeAndSet(
        sheet,
        row,
        row,
        1,
        22,
        'дирекция "Статистика", тел. (02) 9145 1071, (02) 9145 1523, +359 882 103561',
        TINY_FONT,
        CENTER,
    );

    // Convert to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new Uint8Array(buffer as ArrayBuffer);
}
