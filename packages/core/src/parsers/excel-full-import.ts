import * as ExcelJS from 'exceljs';

import { importHoldingsFromExcel } from './excel-import.js';
import type {
    BrokerInterest,
    Dividend,
    ForeignAccountBalance,
    Holding,
    InterestEntry,
    Sale,
    Spb8PersonalData,
    Spb8Security,
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
    foreignAccounts: ForeignAccountBalance[];
    savingsSecurities: Spb8Security[];
    spb8PersonalData?: Spb8PersonalData;
    yearEndPrices: Record<string, number>;
    fxRates: Record<string, Record<string, number>>;
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
    const foreignAccounts = readSpb8AccountsSheet(wb);
    const savingsSecurities = readSavingsSecuritiesSheet(wb);
    const spb8PersonalData = readSpb8PersonalDataSheet(wb);
    const yearEndPrices = readSpb8SecuritiesSheet(wb);
    const fxRates = readFxSheets(wb);

    // Resolve consumedBy sale numbers to sale IDs
    for (const h of holdings) {
        const raw = (h as { _consumedByNums?: string })._consumedByNums;

        if (raw) {
            const nums = raw.split(/[,\s]+/).map(s => parseInt(s.replace('#', ''), 10)).filter(n => !isNaN(n));
            const saleIds = nums.map(n => sales[n - 1]?.id).filter(Boolean);

            if (saleIds.length > 0) {
                h.consumedBySaleIds = saleIds;
            }
            delete (h as { _consumedByNums?: string })._consumedByNums;
        }
    }

    return { holdings, sales, dividends, stockYield, brokerInterest, foreignAccounts, savingsSecurities, spb8PersonalData, yearEndPrices, fxRates };
}

function readSalesSheet(wb: ExcelJS.Workbook): Sale[] {
    const ws = wb.getWorksheet('Продажби');

    if (!ws) {
        return [];
    }

    const sales: Sale[] = [];
    const headerRow = ws.getRow(1);
    const headers = headerRow.values as Array<string | undefined>;
    const headerMap = new Map<string, number>();

    for (let i = 1; i < headers.length; i++) {
        const header = String(headers[i] ?? '').trim();

        if (header) {
            headerMap.set(header, i);
        }
    }

    const idx = (header: string, fallback: number): number => headerMap.get(header) ?? fallback;
    const brokerCol = idx('Брокер', 1);
    const symbolCol = idx('Символ', 2);
    const countryCol = idx('Държава', 3);
    const exchangeCol = idx('Борса', 0);
    const taxTreatmentCol = idx('Данъчно третиране', 0);
    const acquiredCol = idx('Дата покупка', 4);
    const soldCol = idx('Дата продажба', 5);
    const quantityCol = idx('Кол.', 6);
    const currencyCol = idx('Валута', 7);
    const buyPriceCol = idx('Цена покупка', 8);
    const sellPriceCol = idx('Цена продажба', 9);
    const fxBuyCol = idx('Курс покупка', 10);
    const fxSellCol = idx('Курс продажба', 11);

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const symbol = cellStr(row.getCell(symbolCol));
        const quantity = cellNum(row.getCell(quantityCol));

        if (!symbol || quantity <= 0) {
            return;
        }

        const taxTreatment = taxTreatmentCol > 0 ? cellStr(row.getCell(taxTreatmentCol)) : '';

        sales.push({
            id: randomUUID(),
            broker: cellStr(row.getCell(brokerCol)),
            symbol,
            country: cellStr(row.getCell(countryCol)),
            exchange: exchangeCol > 0 ? cellStr(row.getCell(exchangeCol)) || undefined : undefined,
            saleTaxClassification: taxTreatment === 'EU regulated market' ? 'eu-regulated-market' : undefined,
            dateAcquired: cellDate(row.getCell(acquiredCol)),
            dateSold: cellDate(row.getCell(soldCol)),
            quantity,
            currency: cellStr(row.getCell(currencyCol)),
            buyPrice: cellNum(row.getCell(buyPriceCol)),
            sellPrice: cellNum(row.getCell(sellPriceCol)),
            fxRateBuy: cellNum(row.getCell(fxBuyCol)) || null,
            fxRateSell: cellNum(row.getCell(fxSellCol)) || null,
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

function readSpb8AccountsSheet(wb: ExcelJS.Workbook): ForeignAccountBalance[] {
    const ws = wb.getWorksheet('СПБ-8 Сметки');

    if (!ws) {
        return [];
    }
    const accounts: ForeignAccountBalance[] = [];

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const broker = cellStr(row.getCell(1));

        if (!broker) {
            return;
        }
        accounts.push({
            broker,
            type: (cellStr(row.getCell(2)) || '03') as ForeignAccountBalance['type'],
            maturity: (cellStr(row.getCell(3)) || 'L') as ForeignAccountBalance['maturity'],
            country: cellStr(row.getCell(4)),
            currency: cellStr(row.getCell(5)),
            amountStartOfYear: cellNum(row.getCell(6)),
            amountEndOfYear: cellNum(row.getCell(7)),
        });
    });

    return accounts;
}

function readSavingsSecuritiesSheet(wb: ExcelJS.Workbook): Spb8Security[] {
    const ws = wb.getWorksheet('Спестовни Ценни Книжа');

    if (!ws) {
        return [];
    }
    const securities: Spb8Security[] = [];

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const isin = cellStr(row.getCell(1));

        if (!isin) {
            return;
        }
        securities.push({
            isin,
            currency: cellStr(row.getCell(2)),
            quantityStartOfYear: cellNum(row.getCell(3)),
            quantityEndOfYear: cellNum(row.getCell(4)),
        });
    });

    return securities;
}

function readSpb8PersonalDataSheet(wb: ExcelJS.Workbook): Spb8PersonalData | undefined {
    const ws = wb.getWorksheet('СПБ-8 Лични Данни');

    if (!ws) {
        return undefined;
    }
    const result: Spb8PersonalData = {};

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const key = cellStr(row.getCell(1));
        const value = cellStr(row.getCell(2));

        if (!key || !value) {
            return;
        }

        if (key === 'name') {
            result.name = value;
        } else if (key === 'egn') {
            result.egn = value;
        } else if (key === 'phone') {
            result.phone = value;
        } else if (key === 'email') {
            result.email = value;
        } else if (key.startsWith('address.')) {
            result.address ??= {};
            const addressKey = key.replace('address.', '') as keyof NonNullable<Spb8PersonalData['address']>;

            result.address[addressKey] = value;
        }
    });

    const hasData = Boolean(
        result.name
            || result.egn
            || result.phone
            || result.email
            || result.address?.city
            || result.address?.postalCode
            || result.address?.district
            || result.address?.street
            || result.address?.number
            || result.address?.entrance,
    );

    return hasData ? result : undefined;
}

function readSpb8SecuritiesSheet(wb: ExcelJS.Workbook): Record<string, number> {
    const ws = wb.getWorksheet('СПБ-8 Ценни Книжа');

    if (!ws) {
        return {};
    }

    const prices: Record<string, number> = {};

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) {
            return;
        }
        const isin = cellStr(row.getCell(1));
        const price = cellNum(row.getCell(6));

        if (!isin || price <= 0) {
            return;
        }

        prices[isin] = price;
    });

    return prices;
}

function readFxSheets(wb: ExcelJS.Workbook): Record<string, Record<string, number>> {
    const fxRates: Record<string, Record<string, number>> = {};
    const excludedSheetNames = new Set([
        'Притежания',
        'Продажби',
        'Дивиденти',
        'IB Stock Yield',
        'СПБ-8 Сметки',
        'СПБ-8 Ценни Книжа',
        'Спестовни Ценни Книжа',
        'СПБ-8 Лични Данни',
    ]);

    for (const ws of wb.worksheets) {
        if (excludedSheetNames.has(ws.name) || !/^[A-Z]{3}$/.test(ws.name)) {
            continue;
        }

        const rates: Record<string, number> = {};

        ws.eachRow((row, rowNumber) => {
            if (rowNumber <= 1) {
                return;
            }
            const date = cellDate(row.getCell(1));
            const rate = cellNum(row.getCell(2));

            if (!date || rate <= 0) {
                return;
            }

            rates[date] = rate;
        });

        if (Object.keys(rates).length > 0) {
            fxRates[ws.name] = rates;
        }
    }

    return fxRates;
}
