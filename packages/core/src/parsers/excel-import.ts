import ExcelJS from 'exceljs';
import type { Holding } from '../types/index.js';
const randomUUID = () => crypto.randomUUID();

export async function importHoldingsFromExcel(buffer: ArrayBuffer): Promise<Holding[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet('Притежания');
  if (!ws) throw new Error('Sheet "Притежания" not found — this may not be an app-generated Excel file');

  // Find the header row — look for "Символ" or "Symbol" in first 5 rows
  let headerRow = 1;
  for (let r = 1; r <= 5; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 11; c++) {
      const val = String(row.getCell(c).value ?? '').toLowerCase();
      if (val.includes('символ') || val.includes('symbol') || val === 'символ') {
        headerRow = r;
        break;
      }
    }
  }

  const holdings: Holding[] = [];

  /** Extract cell value — handles formula cells (exceljs returns {formula, result}) */
  function cellStr(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
    if (v instanceof Date) return v.toISOString().split('T')[0];
    return String(v).trim();
  }
  function cellNum(cell: ExcelJS.Cell): number {
    const v = cell.value;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && 'result' in v) return Number(v.result ?? 0);
    return Number(v) || 0;
  }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return; // Skip header rows

    const broker = cellStr(row.getCell(1));
    const country = cellStr(row.getCell(2));
    const symbol = cellStr(row.getCell(3));
    const rawDate = row.getCell(4).value;
    const quantity = cellNum(row.getCell(5));
    const currency = cellStr(row.getCell(6));
    const unitPrice = cellNum(row.getCell(7));
    const notes = cellStr(row.getCell(11));

    // Parse date — could be Date object, formula result, or string
    let dateAcquired = '';
    if (rawDate instanceof Date) {
      dateAcquired = rawDate.toISOString().split('T')[0];
    } else if (rawDate && typeof rawDate === 'object' && 'result' in rawDate) {
      const r = rawDate.result;
      dateAcquired = r instanceof Date ? r.toISOString().split('T')[0] : String(r ?? '').split('T')[0].trim();
    } else if (rawDate) {
      dateAcquired = String(rawDate).split('T')[0].trim();
    }

    if (symbol && quantity > 0) {
      holdings.push({
        id: randomUUID(),
        broker,
        country,
        symbol,
        dateAcquired,
        quantity,
        currency,
        unitPrice,
        notes: notes || undefined,
      });
    }
  });

  return holdings;
}
