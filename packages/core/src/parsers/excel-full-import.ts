import ExcelJS from 'exceljs';

import { importHoldingsFromExcel } from './excel-import.js';
import type {
    BrokerInterest,
    Dividend,
    Holding,
    InterestEntry,
    Sale,
    StockYieldEntry,
} from '../types/index.js';

const randomUUID = () => crypto.randomUUID();

/** Extract cell value as string */
function cellStr(cell: ExcelJS.Cell): string {
    const v = cell.value;

    if (v === null || v === undefined) {
        return '';
    }

    if (typeof v === 'object' && 'result' in v) {
        return String(v.result ?? '').trim();
    }

    if (v instanceof Date) {
        return v.toISOString().split('T')[0];
    }

    return String(v).trim();
}

/** Extract cell value as number */
function cellNum(cell: ExcelJS.Cell): number {
    const v = cell.value;

    if (v === null || v === undefined) {
        return 0;
    }

    if (typeof v === 'object' && 'result' in v) {
        return Number(v.result ?? 0);
    }

    return Number(v) || 0;
}

/** Extract cell as date string */
function cellDate(cell: ExcelJS.Cell): string {
    const v = cell.value;

    if (v instanceof Date) {
        return v.toISOString().split('T')[0];
    }

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
    brokerInterest: BrokerInterest[];
}

/**
 * Import all data from an app-generated Excel file.
 * Reads sheets: Притежания, Продажби, Дивиденти, IB Stock Yield,
 * and interest sheets matching "{Broker} Лихви {CCY}" pattern (+ backwards compat).
 */
export async function importFullExcel(buffer: ArrayBuffer): Promise<FullExcelImport> {
    const wb = new ExcelJS.Workbook();

    await wb.xlsx.load(buffer);

    const holdings = await importHoldingsFromExcel(buffer);
    const sales = readSalesSheet(wb);
    const dividends = readDividendsSheet(wb);
    const stockYield = readStockYieldSheet(wb);
    const brokerInterest = readBrokerInterestSheets(wb);

    return { holdings, sales, dividends, stockYield, brokerInterest };
}

function readSalesSheet(wb: ExcelJS.Workbook): Sale[] {
    const ws = wb.getWorksheet('Продажби');

    if (!ws) {
        return [];
    }

    const sales: Sale[] = [];

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const symbol = cellStr(row.getCell(2));
        const quantity = cellNum(row.getCell(6));

        if (!symbol || quantity <= 0) {
            return;
        }

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

    if (!ws) {
        return [];
    }

    const dividends: Dividend[] = [];

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const symbol = cellStr(row.getCell(1));

        if (!symbol) {
            return;
        }

        dividends.push({
            symbol,
            country: cellStr(row.getCell(2)),
            date: cellDate(row.getCell(3)),
            currency: cellStr(row.getCell(4)),
            grossAmount: cellNum(row.getCell(5)),
            withholdingTax: cellNum(row.getCell(6)),
            bgTaxDue: cellNum(row.getCell(11)),
            whtCredit: Math.min(cellNum(row.getCell(6)), cellNum(row.getCell(10))),
            notes: cellStr(row.getCell(12)) || undefined,
        });
    });

    return dividends;
}

function readStockYieldSheet(wb: ExcelJS.Workbook): StockYieldEntry[] {
    const ws = wb.getWorksheet('IB Stock Yield');

    if (!ws) {
        return [];
    }

    const entries: StockYieldEntry[] = [];

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const date = cellDate(row.getCell(1));
        const symbol = cellStr(row.getCell(2));

        if (!symbol) {
            return;
        }

        entries.push({
            date,
            symbol,
            currency: cellStr(row.getCell(3)),
            amount: cellNum(row.getCell(4)),
        });
    });

    return entries;
}

/**
 * Read interest sheets from workbook.
 * Supports both new "{Broker} Лихви {CCY}" format and old formats:
 * - "IB Лихви" (all currencies in one sheet with Валута column)
 * - "Revolut {CCY}" detail sheets
 */
function readBrokerInterestSheets(wb: ExcelJS.Workbook): BrokerInterest[] {
    const result: BrokerInterest[] = [];
    const handledBrokerCurrencies = new Set<string>();

    // 1. New format: "{Broker} Лихви {CCY}" — e.g. "IB Лихви USD", "Revolut Лихви EUR"
    for (const ws of wb.worksheets) {
        const match = ws.name.match(/^(.+)\s+Лихви\s+([A-Z]{3})$/);

        if (!match) {
            continue;
        }
        const broker = match[1];
        const currency = match[2];

        const entries = readInterestRows(ws, currency);

        if (entries.length > 0) {
            result.push({ broker, currency, entries });
            handledBrokerCurrencies.add(`${broker}:${currency}`);
        }
    }

    // 2. Old format: "IB Лихви" (no currency suffix, has Валута column)
    const oldIbSheet = wb.getWorksheet('IB Лихви');

    if (oldIbSheet) {
        const byCurrency = new Map<string, InterestEntry[]>();

        oldIbSheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 1) {
                return;
            }
            const date = cellDate(row.getCell(1));

            if (!date) {
                return;
            }
            const currency = cellStr(row.getCell(2));
            const description = cellStr(row.getCell(3));
            const amount = cellNum(row.getCell(4));

            // Skip if already handled by new format
            if (handledBrokerCurrencies.has(`IB:${currency}`)) {
                return;
            }

            const arr = byCurrency.get(currency) ?? [];

            arr.push({ currency, date, description, amount });
            byCurrency.set(currency, arr);
        });

        for (const [currency, entries] of byCurrency) {
            result.push({ broker: 'IB', currency, entries });
            handledBrokerCurrencies.add(`IB:${currency}`);
        }
    }

    // 3. Old format: "Revolut {CCY}" detail sheets
    for (const ws of wb.worksheets) {
        if (!ws.name.startsWith('Revolut ') || ws.name === 'Revolut Лихва') {
            continue;
        }

        // Skip if it matches new format
        if (ws.name.match(/^Revolut\s+Лихви\s+[A-Z]{3}$/)) {
            continue;
        }
        const currency = ws.name.replace('Revolut ', '');

        if (handledBrokerCurrencies.has(`Revolut:${currency}`)) {
            continue;
        }

        const entries: InterestEntry[] = [];

        ws.eachRow((row, rowNumber) => {
            if (rowNumber <= 1) {
                return;
            }
            const date = cellDate(row.getCell(1));

            if (!date) {
                return;
            }
            entries.push({
                currency,
                date,
                description: cellStr(row.getCell(2)),
                amount: cellNum(row.getCell(3)),
            });
        });

        if (entries.length > 0) {
            result.push({ broker: 'Revolut', currency, entries });
        }
    }

    return result;
}

/** Read interest rows from a "{Broker} Лихви {CCY}" sheet */
function readInterestRows(ws: ExcelJS.Worksheet, currency: string): InterestEntry[] {
    const entries: InterestEntry[] = [];

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const date = cellDate(row.getCell(1));

        if (!date) {
            return;
        }
        // Skip total rows
        const desc = cellStr(row.getCell(2));

        if (desc === 'Общо' || date === 'Общо') {
            return;
        }

        entries.push({
            currency,
            date,
            description: desc,
            amount: cellNum(row.getCell(3)),
        });
    });

    return entries;
}
