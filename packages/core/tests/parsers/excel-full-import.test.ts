import * as ExcelJS from 'exceljs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import { generateExcel } from '../../src/excel/generator.js';
import { importFullExcel } from '../../src/parsers/excel-full-import.js';
import type {
    AppState,
    Spb8PersonalData,
} from '../../src/types/index.js';

function buildStateWithPersonalData(spb8PersonalData: Spb8PersonalData): AppState {
    return {
        taxYear: 2025,
        baseCurrency: 'BGN',
        language: 'bg',
        holdings: [
            {
                id: 'holding-1',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'AAPL',
                dateAcquired: '2024-01-15',
                quantity: 10,
                currency: 'USD',
                unitPrice: 150,
                isin: 'US0378331005',
            },
        ],
        sales: [],
        dividends: [],
        stockYield: [],
        brokerInterest: [],
        fxRates: {},
        manualEntries: [],
        spb8PersonalData,
    };
}

describe('importFullExcel SPB-8 personal data', () => {
    it('restores personal data from exported Excel', async () => {
        const personalData: Spb8PersonalData = {
            name: 'Иван Иванов',
            egn: '8001010000',
            phone: '+359888123456',
            email: 'ivan@example.com',
            address: {
                city: 'София',
                postalCode: '1000',
                district: 'Средец',
                street: 'Граф Игнатиев',
                number: '10',
                entrance: 'A',
            },
        };
        const buffer = await generateExcel(buildStateWithPersonalData(personalData));

        const imported = await importFullExcel(buffer.buffer as ArrayBuffer);

        expect(imported.spb8PersonalData).toEqual(personalData);
    });

    it('reads personal data from СПБ-8 Лични Данни sheet directly', async () => {
        const wb = new ExcelJS.Workbook();
        const holdings = wb.addWorksheet('Притежания');

        holdings.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена']);
        holdings.addRow(['IB', 'AAPL', 'САЩ', '2024-01-15', 10, 'USD', 150]);

        const personal = wb.addWorksheet('СПБ-8 Лични Данни');

        personal.addRow(['Ключ', 'Стойност']);
        personal.addRow(['name', 'Иван Иванов']);
        personal.addRow(['egn', '8001010000']);
        personal.addRow(['phone', '+359888123456']);
        personal.addRow(['email', 'ivan@example.com']);
        personal.addRow(['address.city', 'София']);
        personal.addRow(['address.postalCode', '1000']);
        personal.addRow(['address.district', 'Средец']);
        personal.addRow(['address.street', 'Граф Игнатиев']);
        personal.addRow(['address.number', '10']);
        personal.addRow(['address.entrance', 'A']);

        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        const imported = await importFullExcel(buffer.buffer as ArrayBuffer);

        expect(imported.spb8PersonalData).toEqual({
            name: 'Иван Иванов',
            egn: '8001010000',
            phone: '+359888123456',
            email: 'ivan@example.com',
            address: {
                city: 'София',
                postalCode: '1000',
                district: 'Средец',
                street: 'Граф Игнатиев',
                number: '10',
                entrance: 'A',
            },
        });
    });
});
