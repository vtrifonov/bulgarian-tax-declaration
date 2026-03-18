import * as ExcelJS from 'exceljs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { generateNraAppendix8 } from '../../src/excel/nra-appendix8.js';
import type { Holding } from '../../src/types/index.js';

const mkHolding = (symbol: string, overrides?: Partial<Holding>): Holding => ({
    id: `h-${symbol}`,
    broker: 'IB',
    country: 'US',
    symbol,
    dateAcquired: '2024-06-15',
    quantity: 10,
    currency: 'USD',
    unitPrice: 100,
    ...overrides,
});

const fxRates: Record<string, Record<string, number>> = {
    USD: { '2024-06-15': 1.8, '2024-01-10': 1.82, '2024-03-20': 1.79 },
    EUR: { '2024-06-15': 1.96 },
};

async function getDataRows(holdings: Holding[]) {
    const buf = await generateNraAppendix8(holdings, fxRates);
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(buf.buffer as ArrayBuffer);
    const sheet = workbook.getWorksheet('Приложение 8 Част I')!;
    // Row 1 = header, Row 2 = column numbers, data starts at row 3
    const rows: { symbol: string; quantity: number }[] = [];

    for (let i = 3; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i);

        rows.push({
            symbol: String(row.getCell(1).value), // "Вид" but we check via quantity
            quantity: Number(row.getCell(3).value),
        });
    }

    return rows;
}

describe('NRA Appendix 8 order preservation', () => {
    it('outputs holdings in array order, not alphabetical', async () => {
        const holdings = [
            mkHolding('MSFT'),
            mkHolding('AAPL'),
            mkHolding('GOOG'),
        ];

        // Use different quantities to distinguish rows in output
        holdings[0].quantity = 11;
        holdings[1].quantity = 22;
        holdings[2].quantity = 33;

        const buf2 = await generateNraAppendix8(holdings, fxRates);
        const wb2 = new ExcelJS.Workbook();

        await wb2.xlsx.load(buf2.buffer as ArrayBuffer);
        const s2 = wb2.getWorksheet('Приложение 8 Част I')!;

        expect(Number(s2.getRow(3).getCell(3).value)).toBe(11); // MSFT first
        expect(Number(s2.getRow(4).getCell(3).value)).toBe(22); // AAPL second
        expect(Number(s2.getRow(5).getCell(3).value)).toBe(33); // GOOG third
    });

    it('filters out zero-quantity holdings while preserving order', async () => {
        const holdings = [
            mkHolding('MSFT', { quantity: 5 }),
            mkHolding('AAPL', { quantity: 0 }),
            mkHolding('GOOG', { quantity: 8 }),
        ];
        const rows = await getDataRows(holdings);

        expect(rows).toHaveLength(2);
        expect(rows[0].quantity).toBe(5); // MSFT
        expect(rows[1].quantity).toBe(8); // GOOG
    });

    it('filters out empty-symbol holdings while preserving order', async () => {
        const holdings = [
            mkHolding('MSFT', { quantity: 5 }),
            mkHolding('', { quantity: 10 }),
            mkHolding('GOOG', { quantity: 8 }),
        ];
        const rows = await getDataRows(holdings);

        expect(rows).toHaveLength(2);
        expect(rows[0].quantity).toBe(5);
        expect(rows[1].quantity).toBe(8);
    });

    it('produces deterministic output for same input', async () => {
        const holdings = [
            mkHolding('ZZZZ', { quantity: 1 }),
            mkHolding('AAAA', { quantity: 2 }),
            mkHolding('MMMM', { quantity: 3 }),
        ];
        const rows1 = await getDataRows(holdings);
        const rows2 = await getDataRows(holdings);

        expect(rows1).toEqual(rows2);
    });

    it('preserves reordered array order after simulated move (last→first)', async () => {
        // Simulate what moveHolding(2, 0) does: splice + reinsert
        const holdings = [
            mkHolding('AAPL', { quantity: 1 }),
            mkHolding('MSFT', { quantity: 2 }),
            mkHolding('GOOG', { quantity: 3 }),
        ];
        const [moved] = holdings.splice(2, 1);

        holdings.splice(0, 0, moved);
        // Now order is [GOOG, AAPL, MSFT]

        const rows = await getDataRows(holdings);

        expect(rows).toHaveLength(3);
        expect(rows[0].quantity).toBe(3); // GOOG
        expect(rows[1].quantity).toBe(1); // AAPL
        expect(rows[2].quantity).toBe(2); // MSFT
    });

    it('preserves pre-sorted alphabetical order in output', async () => {
        // Simulate what applySorting would produce: alphabetical by symbol
        const holdings = [
            mkHolding('AAPL', { quantity: 22 }),
            mkHolding('GOOG', { quantity: 33 }),
            mkHolding('MSFT', { quantity: 11 }),
        ];
        const rows = await getDataRows(holdings);

        expect(rows).toHaveLength(3);
        expect(rows[0].quantity).toBe(22); // AAPL
        expect(rows[1].quantity).toBe(33); // GOOG
        expect(rows[2].quantity).toBe(11); // MSFT
    });

    it('handles all holdings being filtered out', async () => {
        const holdings = [
            mkHolding('A', { quantity: 0 }),
            mkHolding('B', { symbol: '' }),
        ];
        const rows = await getDataRows(holdings);

        expect(rows).toHaveLength(0);
    });
});
