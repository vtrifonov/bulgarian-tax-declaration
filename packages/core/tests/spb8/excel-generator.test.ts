import * as ExcelJS from 'exceljs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { generateSpb8Excel } from '../../src/spb8/excel-generator.js';
import type { Spb8FormData } from '../../src/types/index.js';

const formData: Spb8FormData = {
    year: 2025,
    reportType: 'P',
    personalData: { name: 'Иван Иванов', egn: '1234567890', email: 'test@example.com' },
    accounts: [
        { broker: 'IB', type: '03', maturity: 'L', country: 'IE', currency: 'EUR', amountStartOfYear: 200, amountEndOfYear: 374 },
        { broker: 'IB', type: '03', maturity: 'L', country: 'IE', currency: 'USD', amountStartOfYear: 9697, amountEndOfYear: 3359 },
    ],
    securities: [
        { isin: 'US0378331005', currency: 'USD', quantityStartOfYear: 120, quantityEndOfYear: 150 },
        { isin: 'IE00BK5BQT80', currency: 'EUR', quantityStartOfYear: 30, quantityEndOfYear: 30 },
    ],
    thresholdMet: true,
    totalBgn: 75000,
};

describe('generateSpb8Excel', () => {
    it('produces valid xlsx buffer', async () => {
        const buf = await generateSpb8Excel(formData);

        expect(buf).toBeInstanceOf(Uint8Array);
        expect(buf.length).toBeGreaterThan(0);
    });

    it('creates a sheet named СПБ-8', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8');

        expect(sheet).toBeDefined();
    });

    it('writes year in correct cell', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;
        // Year appears in row 5, column K (11) in new layout
        const yearCell = sheet.getRow(5).getCell(11);

        expect(yearCell.value).toBe(2025);
    });

    it('writes personal data when provided', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;
        // Name in row 12, column G (7) in new layout
        const nameCell = sheet.getRow(12).getCell(7);

        expect(nameCell.value).toBe('Иван Иванов');
    });

    it('writes account rows with amounts in thousands', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;
        // Find a row with "03" type (data rows start at row 23)
        let found = false;

        sheet.eachRow((row) => {
            const cellVal = String(row.getCell(1).value ?? '');

            if (cellVal.includes('03')) {
                found = true;
            }
        });
        expect(found).toBe(true);
    });

    it('writes securities rows with ISIN in columns I-N', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;
        let isinFound = false;

        sheet.eachRow((row) => {
            // ISIN is in column I (9) in new layout
            if (row.getCell(9).value === 'US0378331005') {
                isinFound = true;
            }
        });
        expect(isinFound).toBe(true);
    });
});
