import ExcelJS from 'exceljs';
import type {
    Dividend,
    Holding,
    IBInterestEntry,
    RevolutInterest,
    RevolutInterestEntry,
    Sale,
    StockYieldEntry,
} from '../types/index.js';
import { importHoldingsFromExcel } from './excel-import.js';

const randomUUID = () => crypto.randomUUID();

/** Extract cell value as string */
function cellStr(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
    if (v instanceof Date) return v.toISOString().split('T')[0];
    return String(v).trim();
}

/** Extract cell value as number */
function cellNum(cell: ExcelJS.Cell): number {
    const v = cell.value;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && 'result' in v) return Number(v.result ?? 0);
    return Number(v) || 0;
}

/** Extract cell as date string */
function cellDate(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v instanceof Date) return v.toISOString().split('T')[0];
    if (v && typeof v === 'object' && 'result' in v) {
        const r = v.result;
        return r instanceof Date ? r.toISOString().split('T')[0] : String(r ?? '').split('T')[0].trim();
    }
    return v ? String(v).split('T')[0].trim() : '';
}

export interface FullExcelImport {
    holdings: Holding[];
    sales: Sale[];
    dividends: Dividend[];
    stockYield: StockYieldEntry[];
    ibInterest: IBInterestEntry[];
    revolutInterest: RevolutInterest[];
}

/**
 * Import all data from an app-generated Excel file.
 * Reads sheets: Притежания, Продажби, Дивиденти, IB Stock Yield, IB Лихви
 */
export async function importFullExcel(buffer: ArrayBuffer): Promise<FullExcelImport> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const holdings = await importHoldingsFromExcel(buffer);
    const sales = readSalesSheet(wb);
    const dividends = readDividendsSheet(wb);
    const stockYield = readStockYieldSheet(wb);
    const ibInterest = readIbInterestSheet(wb);
    const revolutInterest = readRevolutInterestSheets(wb);

    return { holdings, sales, dividends, stockYield, ibInterest, revolutInterest };
}

function readSalesSheet(wb: ExcelJS.Workbook): Sale[] {
    const ws = wb.getWorksheet('Продажби');
    if (!ws) return [];

    const sales: Sale[] = [];
    // Columns: Брокер, Символ, Държава, Дата покупка, Дата продажба, Кол., Валута, Цена покупка, Цена продажба, Курс покупка, Курс продажба, ...
    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) return;
        const symbol = cellStr(row.getCell(2));
        const quantity = cellNum(row.getCell(6));
        if (!symbol || quantity <= 0) return;

        sales.push({
            id: randomUUID(),
            broker: cellStr(row.getCell(1)),
            symbol,
            country: cellStr(row.getCell(3)),
            dateAcquired: cellDate(row.getCell(4)),
            dateSold: cellDate(row.getCell(5)),
            quantity,
            currency: cellStr(row.getCell(7)),
            buyPrice: cellNum(row.getCell(8)),
            sellPrice: cellNum(row.getCell(9)),
            fxRateBuy: cellNum(row.getCell(10)),
            fxRateSell: cellNum(row.getCell(11)),
        });
    });
    return sales;
}

function readDividendsSheet(wb: ExcelJS.Workbook): Dividend[] {
    const ws = wb.getWorksheet('Дивиденти');
    if (!ws) return [];

    const dividends: Dividend[] = [];
    // Columns: Символ, Държава, Дата, Валута, Брутен дивидент, Удържан данък, ...
    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) return;
        const symbol = cellStr(row.getCell(1));
        if (!symbol) return;

        dividends.push({
            symbol,
            country: cellStr(row.getCell(2)),
            date: cellDate(row.getCell(3)),
            currency: cellStr(row.getCell(4)),
            grossAmount: cellNum(row.getCell(5)),
            withholdingTax: cellNum(row.getCell(6)),
            bgTaxDue: 0,
            whtCredit: 0,
        });
    });
    return dividends;
}

function readStockYieldSheet(wb: ExcelJS.Workbook): StockYieldEntry[] {
    const ws = wb.getWorksheet('IB Stock Yield');
    if (!ws) return [];

    const entries: StockYieldEntry[] = [];
    // Columns: Дата, Символ, Валута, Получено, ...
    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) return;
        const date = cellDate(row.getCell(1));
        const symbol = cellStr(row.getCell(2));
        if (!symbol) return;

        entries.push({
            date,
            symbol,
            currency: cellStr(row.getCell(3)),
            amount: cellNum(row.getCell(4)),
        });
    });
    return entries;
}

function readIbInterestSheet(wb: ExcelJS.Workbook): IBInterestEntry[] {
    const ws = wb.getWorksheet('IB Лихви');
    if (!ws) return [];

    const entries: IBInterestEntry[] = [];
    // Columns: Дата, Валута, Описание, Сума, ...
    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) return;
        const date = cellDate(row.getCell(1));
        if (!date) return;

        entries.push({
            date,
            currency: cellStr(row.getCell(2)),
            description: cellStr(row.getCell(3)),
            amount: cellNum(row.getCell(4)),
        });
    });
    return entries;
}

function readRevolutInterestSheets(wb: ExcelJS.Workbook): RevolutInterest[] {
    const result: RevolutInterest[] = [];

    // Detail sheets are named "Revolut USD", "Revolut GBP", "Revolut EUR", etc.
    for (const ws of wb.worksheets) {
        if (!ws.name.startsWith('Revolut ') || ws.name === 'Revolut Лихва') continue;
        const currency = ws.name.replace('Revolut ', '');

        const entries: RevolutInterestEntry[] = [];
        // Columns: Дата, Описание, Размер, ...
        ws.eachRow((row, rowNumber) => {
            if (rowNumber <= 1) return;
            const date = cellDate(row.getCell(1));
            if (!date) return;
            entries.push({
                date,
                description: cellStr(row.getCell(2)),
                amount: cellNum(row.getCell(3)),
            });
        });

        if (entries.length > 0) {
            result.push({ currency, entries });
        }
    }

    return result;
}
