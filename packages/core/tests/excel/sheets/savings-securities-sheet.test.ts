import * as ExcelJS from 'exceljs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { addSavingsSecuritiesSheet } from '../../../src/excel/sheets/savings-securities-sheet.js';
import type { AppState } from '../../../src/types/index.js';

const baseState: AppState = {
    taxYear: 2025,
    baseCurrency: 'BGN',
    language: 'bg',
    holdings: [],
    sales: [],
    dividends: [],
    stockYield: [],
    brokerInterest: [],
    fxRates: {},
    manualEntries: [],
};

describe('addSavingsSecuritiesSheet', () => {
    it('returns null when savingsSecurities is undefined', () => {
        const wb = new ExcelJS.Workbook();

        const result = addSavingsSecuritiesSheet(wb, baseState);

        expect(result).toBeNull();
    });

    it('returns null when savingsSecurities is empty', () => {
        const wb = new ExcelJS.Workbook();

        const result = addSavingsSecuritiesSheet(wb, { ...baseState, savingsSecurities: [] });

        expect(result).toBeNull();
    });

    it('creates worksheet with correct name', () => {
        const wb = new ExcelJS.Workbook();
        const state = {
            ...baseState,
            savingsSecurities: [
                { isin: 'IE0002RUHW32', currency: 'GBP', quantityStartOfYear: 0, quantityEndOfYear: 12.85 },
            ],
        };

        const result = addSavingsSecuritiesSheet(wb, state);

        expect(result).not.toBeNull();
        expect(result!.name).toBe('Спестовни Ценни Книжа');
    });

    it('writes header row with 4 columns', () => {
        const wb = new ExcelJS.Workbook();
        const state = {
            ...baseState,
            savingsSecurities: [
                { isin: 'IE0002RUHW32', currency: 'GBP', quantityStartOfYear: 0, quantityEndOfYear: 12.85 },
            ],
        };

        const sheet = addSavingsSecuritiesSheet(wb, state)!;
        const header = sheet.getRow(1);

        expect(header.getCell(1).value).toBe('ISIN');
        expect(header.getCell(2).value).toBe('Валута');
        expect(header.getCell(3).value).toBe('Начало година');
        expect(header.getCell(4).value).toBe('Край година');
    });

    it('writes security data rows', () => {
        const wb = new ExcelJS.Workbook();
        const state = {
            ...baseState,
            savingsSecurities: [
                { isin: 'IE0002RUHW32', currency: 'GBP', quantityStartOfYear: 0, quantityEndOfYear: 12.85 },
                { isin: 'IE000AZVL3K0', currency: 'EUR', quantityStartOfYear: 100, quantityEndOfYear: 550 },
            ],
        };

        const sheet = addSavingsSecuritiesSheet(wb, state)!;

        const row1 = sheet.getRow(2);
        expect(row1.getCell(1).value).toBe('IE0002RUHW32');
        expect(row1.getCell(2).value).toBe('GBP');
        expect(row1.getCell(3).value).toBe(0);
        expect(row1.getCell(4).value).toBe(12.85);

        const row2 = sheet.getRow(3);
        expect(row2.getCell(1).value).toBe('IE000AZVL3K0');
        expect(row2.getCell(2).value).toBe('EUR');
        expect(row2.getCell(3).value).toBe(100);
        expect(row2.getCell(4).value).toBe(550);
    });

    it('sets correct column widths', () => {
        const wb = new ExcelJS.Workbook();
        const state = {
            ...baseState,
            savingsSecurities: [
                { isin: 'IE0002RUHW32', currency: 'GBP', quantityStartOfYear: 0, quantityEndOfYear: 12.85 },
            ],
        };

        const sheet = addSavingsSecuritiesSheet(wb, state)!;

        expect(sheet.getColumn(1).width).toBe(18);
        expect(sheet.getColumn(2).width).toBe(10);
        expect(sheet.getColumn(3).width).toBe(14);
        expect(sheet.getColumn(4).width).toBe(14);
    });
});
