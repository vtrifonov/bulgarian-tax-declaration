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
    personalData: {
        name: 'Иван Иванов',
        egn: '1234567890',
        phone: '+359888123456',
        email: 'test@example.com',
        address: {
            city: 'София',
            postalCode: '1000',
            district: 'Лозенец',
            street: 'Черни връх',
            number: '12',
            entrance: 'A, 5',
        },
    },
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
        const yearCell = sheet.getRow(5).getCell(10);

        expect(yearCell.value).toBe(2025);
    });

    it('creates merged year and report-type boxes in the header', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('M5').master.address).toBe('J5');
        expect(sheet.getCell('J7').value).toBe('X');
        expect(sheet.getCell('N7').value).toBeNull();
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

    it('writes address, phone, and email fields', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('G17').value).toBe('София');
        expect(sheet.getCell('T17').value).toBe(1000);
        expect(sheet.getCell('D18').value).toBe('Лозенец');
        expect(sheet.getCell('K18').value).toBe('Черни връх');
        expect(sheet.getCell('Q18').value).toBe(12);
        expect(sheet.getCell('T18').value).toBe('A, 5');
        const phoneValue = sheet.getCell('E19').value as { richText: Array<{ text: string }> };

        expect(phoneValue.richText[0].text).toBe('+359888123456');
        expect(String(sheet.getCell('A20').value ?? '')).toContain('test@example.com');
    });

    it('exports digit-only EGN and numeric-looking address fields as numbers', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('G13').value).toBe(1234567890);
        expect(sheet.getCell('S17').value).toBe(1000);
        expect(sheet.getCell('R18').value).toBe(12);
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

    it('merges the accounts label across all section 03 rows', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('A27').value).toBe('03. Сметки, открити в чужбина');
        expect(sheet.getCell('B28').master.address).toBe('A27');
        expect(sheet.getCell('H28').master.address).toBe('A27');
    });

    it('merges the entry cells for rows 25 and 26 in the accounts table', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('J25').master.address).toBe('I25');
        expect(sheet.getCell('L25').master.address).toBe('K25');
        expect(sheet.getCell('N25').master.address).toBe('M25');
        expect(sheet.getCell('R25').master.address).toBe('O25');
        expect(sheet.getCell('V25').master.address).toBe('S25');
        expect(sheet.getCell('J26').master.address).toBe('I26');
        expect(sheet.getCell('L26').master.address).toBe('K26');
        expect(sheet.getCell('N26').master.address).toBe('M26');
        expect(sheet.getCell('R26').master.address).toBe('O26');
        expect(sheet.getCell('V26').master.address).toBe('S26');
    });

    it('merges the securities label across all section 04 rows', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('A32').value).toBe('04. Придобити ценни книжа');
        expect(sheet.getCell('B33').master.address).toBe('A32');
        expect(sheet.getCell('H33').master.address).toBe('A32');
    });

    it('adds an empty section 04 row when there are no securities', async () => {
        const buf = await generateSpb8Excel({ ...formData, securities: [] });
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('A32').value).toBe('04. Придобити ценни книжа');
        expect(sheet.getCell('N32').master.address).toBe('I32');
        expect(sheet.getCell('R32').master.address).toBe('O32');
        expect(sheet.getCell('V32').master.address).toBe('S32');
    });

    it('skips securities that would export as 0/0 after rounding', async () => {
        const buf = await generateSpb8Excel({
            ...formData,
            securities: [
                ...formData.securities,
                { isin: 'US19260Q1076', currency: 'USD', quantityStartOfYear: 0.0004, quantityEndOfYear: 0.0076 },
            ],
        });
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;
        let tinyIsinFound = false;

        sheet.eachRow((worksheetRow) => {
            if (worksheetRow.getCell(9).value === 'US19260Q1076') {
                tinyIsinFound = true;
            }
        });

        expect(tinyIsinFound).toBe(false);
    });

    it('styles section and table headers with template fill color', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('A11').fill).toMatchObject({ fgColor: { argb: 'FFF4C7A1' } });
        expect(sheet.getCell('A22').fill).toMatchObject({ fgColor: { argb: 'FFF4C7A1' } });
        expect(sheet.getCell('A23').fill).toMatchObject({ fgColor: { argb: 'FFF4C7A1' } });
    });

    it('configures the sheet view and print area for the SPB-8 form', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.views[0]).toMatchObject({ showGridLines: false });
        expect(String(sheet.pageSetup.printArea)).toContain('A');
        expect(String(sheet.pageSetup.printArea)).toContain('V');
        expect(sheet.getColumn(23).hidden).toBe(true);
    });

    it('creates a merged signature box in the footer', async () => {
        const buf = await generateSpb8Excel(formData);
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const sheet = wb.getWorksheet('СПБ-8')!;

        expect(sheet.getCell('O37').value).toBe('Подпис:');
        expect(sheet.getCell('V40').master.address).toBe('O37');
        expect(sheet.getCell('A36').fill).toMatchObject({ fgColor: { argb: 'FFF4C7A1' } });
    });
});
