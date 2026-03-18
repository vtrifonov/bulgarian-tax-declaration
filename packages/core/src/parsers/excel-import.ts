import * as ExcelJS from 'exceljs';

import type { Holding } from '../types/index.js';
const randomUUID = () => crypto.randomUUID();

/** Substring patterns → field mapping (checked in order, first match wins per cell) */
const HEADER_PATTERNS: [RegExp, string][] = [
    [/брокер|broker/i, 'broker'],
    [/символ|symbol/i, 'symbol'],
    [/държава|country/i, 'country'],
    [/дата на придобиване|дата|date acquired|date/i, 'dateAcquired'],
    [/количество|брой|quantity|qty/i, 'quantity'],
    [/ед\.\s*цена|unit\s*price/i, 'unitPrice'], // Must be before generic цена/валута
    [/^валута$|^currency$/i, 'currency'], // Exact match only — avoids matching "Ед. цена във валута"
    [/цена|price/i, 'unitPrice'],
    [/бележки|коментари|notes|comments/i, 'notes'],
    [/продадено\s*чрез|consumed\s*by/i, 'consumedBy'],
];

function matchHeader(value: string): string | null {
    const v = value.toLowerCase().trim();

    if (!v) {
        return null;
    }

    for (const [pattern, field] of HEADER_PATTERNS) {
        if (pattern.test(v)) {
            return field;
        }
    }

    return null;
}

export async function importHoldingsFromExcel(buffer: ArrayBuffer): Promise<Holding[]> {
    const wb = new ExcelJS.Workbook();

    await wb.xlsx.load(buffer);

    const ws = wb.getWorksheet('Притежания') ?? wb.worksheets[0];

    if (!ws) {
        throw new Error('No sheets found in Excel file');
    }

    // Find header row and build column mapping
    let headerRow = 0;
    const colMap: Record<string, number> = {};

    for (let r = 1; r <= 5; r++) {
        const row = ws.getRow(r);
        let matchCount = 0;
        const candidates: Record<string, number> = {};

        for (let c = 1; c <= 20; c++) {
            const val = String(row.getCell(c).value ?? '');
            const field = matchHeader(val);

            if (field && !candidates[field]) { // First match wins (avoid "Валута" matching twice)
                candidates[field] = c;
                matchCount++;
            }
        }

        if (matchCount >= 3) { // Need at least symbol + quantity + one more
            headerRow = r;
            Object.assign(colMap, candidates);
            break;
        }
    }

    // Fallback: fixed column positions (legacy format: Broker, Symbol, Country, Date, Qty, Currency, Price, ..., Notes)
    if (headerRow === 0) {
        // Collect first 5 rows of headers for error message
        const found: string[] = [];

        for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
            const row = ws.getRow(r);
            const cells: string[] = [];

            for (let c = 1; c <= 15; c++) {
                const v = String(row.getCell(c).value ?? '').trim();

                if (v) {
                    cells.push(v);
                }
            }

            if (cells.length > 0) {
                found.push(`Row ${r}: ${cells.join(', ')}`);
            }
        }
        throw new Error(
            `Could not detect column headers in sheet "${ws.name}". `
                + `Expected headers like: Брокер, Символ, Държава, Дата, Количество, Валута, Цена.\n`
                + `Found:\n${found.join('\n')}`,
        );
    }

    const holdings: Holding[] = [];

    /** Extract cell value — handles formula cells (exceljs returns {formula, result}) */
    function cellStr(cell: ExcelJS.Cell): string {
        const v = cell.value;

        if (v === null || v === undefined) {
            return '';
        }

        if (typeof v === 'object' && 'result' in v) {
            return String(v.result ?? '').trim();
        }

        if (v instanceof Date) {
            return v.toISOString().split('T')[0];
        }

        return String(v).trim();
    }

    function cellNum(cell: ExcelJS.Cell): number {
        const v = cell.value;

        if (v === null || v === undefined) {
            return 0;
        }

        if (typeof v === 'object' && 'result' in v) {
            return Number(v.result ?? 0);
        }

        return Number(v) || 0;
    }

    function cellDate(cell: ExcelJS.Cell): string {
        const v = cell.value;

        if (v instanceof Date) {
            return v.toISOString().split('T')[0];
        }

        if (v && typeof v === 'object' && 'result' in v) {
            const r = v.result;

            return r instanceof Date ? r.toISOString().split('T')[0] : String(r ?? '').split('T')[0].trim();
        }

        return v ? String(v).split('T')[0].trim() : '';
    }

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRow) {
            return;
        }

        const symbol = colMap.symbol ? cellStr(row.getCell(colMap.symbol)) : '';
        const quantity = colMap.quantity ? cellNum(row.getCell(colMap.quantity)) : 0;
        const consumedByRaw = colMap.consumedBy ? cellStr(row.getCell(colMap.consumedBy)) : '';
        const hasConsumedBy = consumedByRaw.trim().length > 0;

        // Allow quantity 0 for consumed holdings (marked with consumedBy column)
        if (!symbol || (quantity <= 0 && !hasConsumedBy)) {
            return;
        }

        const holding: Holding = {
            id: randomUUID(),
            broker: colMap.broker ? cellStr(row.getCell(colMap.broker)) : '',
            country: colMap.country ? cellStr(row.getCell(colMap.country)) : '',
            symbol,
            dateAcquired: colMap.dateAcquired ? cellDate(row.getCell(colMap.dateAcquired)) : '',
            quantity,
            currency: colMap.currency ? cellStr(row.getCell(colMap.currency)) : '',
            unitPrice: colMap.unitPrice ? cellNum(row.getCell(colMap.unitPrice)) : 0,
            notes: colMap.notes ? cellStr(row.getCell(colMap.notes)) || undefined : undefined,
        };

        if (hasConsumedBy) {
            holding.consumedByFifo = true;
            // Store raw sale numbers temporarily — resolved to IDs by importFullExcel
            (holding as Holding & { _consumedByNums?: string })._consumedByNums = consumedByRaw;
        }

        holdings.push(holding);
    });

    return holdings;
}

/** Parse a CSV line handling quoted fields */
function parseCsvRow(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());

    return fields;
}

export function importHoldingsFromCsv(content: string): Holding[] {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.length < 2) {
        return [];
    }

    // Detect header row (first 5 lines)
    let headerRowIdx = -1;
    const colMap: Record<string, number> = {};

    for (let r = 0; r < Math.min(5, lines.length); r++) {
        const fields = parseCsvRow(lines[r]);
        let matchCount = 0;
        const candidates: Record<string, number> = {};

        for (let c = 0; c < fields.length; c++) {
            const field = matchHeader(fields[c]);

            if (field && !candidates[field]) {
                candidates[field] = c;
                matchCount++;
            }
        }

        if (matchCount >= 3) {
            headerRowIdx = r;
            Object.assign(colMap, candidates);
            break;
        }
    }

    if (headerRowIdx === -1) {
        const preview = lines.slice(0, 3).join('\n');

        throw new Error(
            `Could not detect column headers in CSV. `
                + `Expected headers like: Брокер, Символ, Държава, Дата, Количество, Валута, Цена.\n`
                + `Found:\n${preview}`,
        );
    }

    const holdings: Holding[] = [];

    for (let i = headerRowIdx + 1; i < lines.length; i++) {
        const fields = parseCsvRow(lines[i]);

        const symbol = colMap.symbol !== undefined ? (fields[colMap.symbol] ?? '') : '';
        const quantityStr = colMap.quantity !== undefined ? (fields[colMap.quantity] ?? '') : '';
        const quantity = parseFloat(quantityStr) || 0;
        const consumedByRaw = colMap.consumedBy !== undefined ? (fields[colMap.consumedBy] ?? '') : '';
        const hasConsumedBy = consumedByRaw.trim().length > 0;

        if (!symbol || (quantity <= 0 && !hasConsumedBy)) {
            continue;
        }

        const dateRaw = colMap.dateAcquired !== undefined ? (fields[colMap.dateAcquired] ?? '') : '';
        // Normalize date: strip time part if present
        const dateAcquired = dateRaw.split('T')[0];

        const holding: Holding = {
            id: randomUUID(),
            broker: colMap.broker !== undefined ? (fields[colMap.broker] ?? '') : '',
            country: colMap.country !== undefined ? (fields[colMap.country] ?? '') : '',
            symbol,
            dateAcquired,
            quantity,
            currency: colMap.currency !== undefined ? (fields[colMap.currency] ?? '') : '',
            unitPrice: colMap.unitPrice !== undefined ? (parseFloat(fields[colMap.unitPrice]) || 0) : 0,
            notes: colMap.notes !== undefined ? (fields[colMap.notes] || undefined) : undefined,
        };

        if (hasConsumedBy) {
            holding.consumedByFifo = true;
            (holding as Holding & { _consumedByNums?: string })._consumedByNums = consumedByRaw;
        }

        holdings.push(holding);
    }

    return holdings;
}
