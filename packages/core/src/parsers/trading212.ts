import { parseCSVRow } from './revolut-csv.js';
import type {
    Dividend,
    InterestEntry,
    Trade,
} from '../types/index.js';

export interface Trading212ParsedData {
    trades: Trade[];
    dividends: Dividend[];
    interest: InterestEntry[];
    isinMap: Record<string, string>;
    cashAccountCurrencies: string[];
}

const REQUIRED_HEADERS = [
    'Action',
    'Time',
    'ISIN',
    'Ticker',
    'No. of shares',
    'Price / share',
    'Currency (Price / share)',
    'Total',
    'Currency (Total)',
];

function isValidTicker(ticker: string): boolean {
    return /^[A-Za-z0-9 .-]+$/.test(ticker);
}

function parseNumber(value: string): number | null {
    const parsed = Number.parseFloat(value);

    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateTime(value: string): string {
    const [date = '', time = ''] = value.trim().split(/\s+/);

    return date && time ? `${date}, ${time}` : date;
}

function normalizeDate(value: string): string {
    return value.trim().split(/\s+/)[0] ?? '';
}

function headerIndexMap(header: string[]): Record<string, number> {
    return Object.fromEntries(header.map((name, index) => [name, index]));
}

function field(fields: string[], indexes: Record<string, number>, name: string): string {
    const index = indexes[name];

    return index === undefined ? '' : (fields[index] ?? '').trim();
}

export function isTrading212Csv(content: string): boolean {
    try {
        const firstLine = content.replace(/^\uFEFF/, '').split('\n')[0] ?? '';

        if (!firstLine) {
            return false;
        }
        const header = parseCSVRow(firstLine);

        return REQUIRED_HEADERS.every(name => header.includes(name));
    } catch {
        return false;
    }
}

export function parseTrading212Csv(csv: string): Trading212ParsedData {
    const normalized = csv.replace(/^\uFEFF/, '');
    const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);

    if (lines.length < 2 || !isTrading212Csv(normalized)) {
        return { trades: [], dividends: [], interest: [], isinMap: {}, cashAccountCurrencies: [] };
    }

    const header = parseCSVRow(lines[0]);
    const indexes = headerIndexMap(header);
    const trades: Trade[] = [];
    const dividends: Dividend[] = [];
    const interest: InterestEntry[] = [];
    const isinMap: Record<string, string> = {};
    const cashAccountCurrencies = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
        try {
            const fields = parseCSVRow(lines[i]);
            const action = field(fields, indexes, 'Action');
            const ticker = field(fields, indexes, 'Ticker');
            const isin = field(fields, indexes, 'ISIN');
            const dateTime = normalizeDateTime(field(fields, indexes, 'Time'));
            const date = normalizeDate(field(fields, indexes, 'Time'));

            if (ticker && isin && isValidTicker(ticker)) {
                isinMap[ticker] = isin;
            }

            if (action === 'Interest on cash') {
                const amount = parseNumber(field(fields, indexes, 'Total'));
                const currency = field(fields, indexes, 'Currency (Total)');

                if (amount === null || !currency) {
                    continue;
                }
                cashAccountCurrencies.add(currency);
                interest.push({
                    date,
                    currency,
                    description: 'Interest on cash',
                    amount,
                });
                continue;
            }

            if (action === 'Deposit' || action === 'Withdrawal') {
                const currency = field(fields, indexes, 'Currency (Total)');

                if (currency) {
                    cashAccountCurrencies.add(currency);
                }
                continue;
            }

            if (!ticker || !isValidTicker(ticker) || !dateTime) {
                continue;
            }

            if (action === 'Market buy' || action === 'Market sell') {
                const quantity = parseNumber(field(fields, indexes, 'No. of shares'));
                const price = parseNumber(field(fields, indexes, 'Price / share'));
                const total = parseNumber(field(fields, indexes, 'Total'));
                const currency = field(fields, indexes, 'Currency (Price / share)');
                const totalCurrency = field(fields, indexes, 'Currency (Total)');

                if (quantity === null || price === null || total === null || !currency) {
                    continue;
                }
                const proceeds = totalCurrency === currency
                    ? total
                    : quantity * price;

                trades.push({
                    symbol: ticker,
                    dateTime,
                    quantity: action === 'Market sell' ? -quantity : quantity,
                    price,
                    proceeds: action === 'Market sell' ? proceeds : 0,
                    commission: 0,
                    currency,
                });
                continue;
            }

            if (action === 'Dividend (Dividend)') {
                const quantity = parseNumber(field(fields, indexes, 'No. of shares'));
                const amountPerShare = parseNumber(field(fields, indexes, 'Price / share'));
                const total = parseNumber(field(fields, indexes, 'Total'));
                const withholdingTax = parseNumber(field(fields, indexes, 'Withholding tax')) ?? 0;
                const priceCurrency = field(fields, indexes, 'Currency (Price / share)');
                const totalCurrency = field(fields, indexes, 'Currency (Total)');
                const currency = priceCurrency || totalCurrency;
                const grossAmount = quantity !== null && amountPerShare !== null
                    ? quantity * amountPerShare
                    : total;

                if (grossAmount === null || !currency) {
                    continue;
                }
                dividends.push({
                    symbol: ticker,
                    country: '',
                    date,
                    currency,
                    grossAmount,
                    withholdingTax: Math.abs(withholdingTax),
                    bgTaxDue: 0,
                    whtCredit: 0,
                });
            }
        } catch {
            continue;
        }
    }

    return { trades, dividends, interest, isinMap, cashAccountCurrencies: [...cashAccountCurrencies] };
}
