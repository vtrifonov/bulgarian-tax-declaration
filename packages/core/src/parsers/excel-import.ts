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
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return; // Skip header rows

    const broker = String(row.getCell(1).value ?? '').trim();
    const country = String(row.getCell(2).value ?? '').trim();
    const symbol = String(row.getCell(3).value ?? '').trim();
    const rawDate = row.getCell(4).value;
    const quantity = Number(row.getCell(5).value ?? 0);
    const currency = String(row.getCell(6).value ?? '').trim();
    const unitPrice = Number(row.getCell(7).value ?? 0);
    const notes = String(row.getCell(11).value ?? '').trim();

    // Parse date — could be Date object or string
    let dateAcquired = '';
    if (rawDate instanceof Date) {
      dateAcquired = rawDate.toISOString().split('T')[0];
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
