import ExcelJS from 'exceljs';
import type { Holding } from '../types/index.js';
import { randomUUID } from 'crypto';

export async function importHoldingsFromExcel(buffer: Buffer): Promise<Holding[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet('Притежания');
  if (!ws) throw new Error('Sheet "Притежания" not found — this may not be an app-generated Excel file');

  const holdings: Holding[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    const broker = String(row.getCell(1).value ?? '');
    const country = String(row.getCell(2).value ?? '');
    const symbol = String(row.getCell(3).value ?? '');
    const dateAcquired = String(row.getCell(4).value ?? '');
    const quantity = Number(row.getCell(5).value ?? 0);
    const currency = String(row.getCell(6).value ?? '');
    const unitPrice = Number(row.getCell(7).value ?? 0);
    const notes = String(row.getCell(11).value ?? '');

    if (symbol && quantity > 0) {
      holdings.push({ id: randomUUID(), broker, country, symbol, dateAcquired, quantity, currency, unitPrice, notes: notes || undefined });
    }
  });

  return holdings;
}
