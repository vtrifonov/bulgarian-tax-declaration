import * as ExcelJS from 'exceljs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { importFullExcel } from '../../../src/parsers/excel-full-import.js';

/** Add a minimal valid holdings sheet so importFullExcel doesn't throw */
function addMinimalHoldingsSheet(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('Притежания');

    ws.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена']);
}

describe('readSavingsSecuritiesSheet (via importFullExcel)', () => {
    it('returns empty array when sheet does not exist', async () => {
        const wb = new ExcelJS.Workbook();

        addMinimalHoldingsSheet(wb);
        const buf = await wb.xlsx.writeBuffer();
        const result = await importFullExcel(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer);

        expect(result.savingsSecurities).toEqual([]);
    });

    it('reads savings securities with valid ISIN, currency, and quantities', async () => {
        const wb = new ExcelJS.Workbook();

        addMinimalHoldingsSheet(wb);
        const ws = wb.addWorksheet('Спестовни Ценни Книжа');

        ws.addRow(['ISIN', 'Валута', 'Начало година', 'Край година']);
        ws.addRow(['IE0002RUHW32', 'GBP', 0, 12.85]);
        ws.addRow(['IE000AZVL3K0', 'EUR', 100, 550]);

        const buf = await wb.xlsx.writeBuffer();
        const result = await importFullExcel(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer);

        expect(result.savingsSecurities).toHaveLength(2);
        expect(result.savingsSecurities[0]).toEqual({
            isin: 'IE0002RUHW32',
            currency: 'GBP',
            quantityStartOfYear: 0,
            quantityEndOfYear: 12.85,
        });
        expect(result.savingsSecurities[1]).toEqual({
            isin: 'IE000AZVL3K0',
            currency: 'EUR',
            quantityStartOfYear: 100,
            quantityEndOfYear: 550,
        });
    });

    it('skips rows with missing ISIN', async () => {
        const wb = new ExcelJS.Workbook();

        addMinimalHoldingsSheet(wb);
        const ws = wb.addWorksheet('Спестовни Ценни Книжа');

        ws.addRow(['ISIN', 'Валута', 'Начало година', 'Край година']);
        ws.addRow(['IE0002RUHW32', 'GBP', 0, 12.85]);
        ws.addRow(['', 'EUR', 100, 550]); // Empty ISIN — should be skipped

        const buf = await wb.xlsx.writeBuffer();
        const result = await importFullExcel(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer);

        expect(result.savingsSecurities).toHaveLength(1);
        expect(result.savingsSecurities[0].isin).toBe('IE0002RUHW32');
    });

    it('parses fractional quantities correctly', async () => {
        const wb = new ExcelJS.Workbook();

        addMinimalHoldingsSheet(wb);
        const ws = wb.addWorksheet('Спестовни Ценни Книжа');

        ws.addRow(['ISIN', 'Валута', 'Начало година', 'Край година']);
        ws.addRow(['IE0002RUHW32', 'GBP', 383.51, 354.88]);

        const buf = await wb.xlsx.writeBuffer();
        const result = await importFullExcel(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer);

        expect(result.savingsSecurities[0].quantityStartOfYear).toBeCloseTo(383.51, 2);
        expect(result.savingsSecurities[0].quantityEndOfYear).toBeCloseTo(354.88, 2);
    });
});
