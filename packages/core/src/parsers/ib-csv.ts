import type {
    IBDividend,
    IBParsedData,
    IBTrade,
    IBWithholdingTax,
    StockYieldEntry,
} from '../types/index.js';

export function parseIBCsv(csv: string): IBParsedData {
    const lines = parseCsvLines(csv);
    const trades: IBTrade[] = [];
    const rawDividends: IBDividend[] = [];
    const withholdingTax: IBWithholdingTax[] = [];
    const stockYield: StockYieldEntry[] = [];

    for (const fields of lines) {
        const section = fields[0];
        const rowType = fields[1]; // Header, Data, SubTotal, Total

        if (rowType !== 'Data') continue;

        if (section === 'Trades' && fields[2] === 'Order' && fields[3] === 'Stocks') {
            trades.push(parseTrade(fields));
        } else if (section === 'Dividends' && isDataRow(fields[2])) {
            // This also captures "Payment in Lieu of Dividend" entries — they appear
            // in the Dividends section with description like "VCLT(...) Payment in Lieu of Dividend"
            // and are treated identically to regular dividends for tax purposes (5% rate + WHT credit)
            const div = parseDividendLine(fields);
            if (div) rawDividends.push(div);
        } else if (section === 'Withholding Tax' && isDataRow(fields[2])) {
            const wht = parseWhtLine(fields);
            if (wht) withholdingTax.push(wht);
        } else if (section.startsWith('Stock Yield Enhancement Program Securities Lent Interest Details') && isDataRow(fields[2])) {
            const sy = parseStockYieldLine(fields);
            if (sy) stockYield.push(sy);
        }
    }

    const dividends = combineDividends(rawDividends);
    return { trades, dividends, withholdingTax, stockYield };
}

/** Check if field[2] is a currency code (data row), not a Total/SubTotal line */
function isDataRow(field2: string): boolean {
    if (!field2) return false;
    const lower = field2.toLowerCase();
    // Skip Total, SubTotal, and "Total in XXX" lines
    if (lower === 'total' || lower.startsWith('total')) return false;
    // Valid currency codes are 3 uppercase letters
    return /^[A-Z]{3}$/.test(field2);
}

function parseCsvLines(csv: string): string[][] {
    return csv.split('\n')
        .filter(line => line.trim())
        .map(line => parseCSVRow(line));
}

function parseCSVRow(row: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields;
}

function extractSymbol(description: string): string {
    // "AAPL(US0378331005) Cash Dividend..." → "AAPL"
    // "SBUX (US8552441094) Cash Dividend..." → "SBUX" (note space before paren)
    const match = description.match(/^(\S+?)[\s(]/);
    return match ? match[1] : description.split('(')[0].trim();
}

function parseTrade(fields: string[]): IBTrade {
    return {
        currency: fields[4],
        symbol: fields[5],
        dateTime: fields[6],
        quantity: parseFloat(fields[7].replace(/,/g, '')),
        price: parseFloat(fields[8]),
        proceeds: parseFloat(fields[10]),
        commission: parseFloat(fields[11]),
    };
}

function parseDividendLine(fields: string[]): IBDividend | null {
    const currency = fields[2];
    const date = fields[3];
    const description = fields[4];
    const amount = parseFloat(fields[5]);
    if (isNaN(amount)) return null;
    return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseWhtLine(fields: string[]): IBWithholdingTax | null {
    const currency = fields[2];
    const date = fields[3];
    const description = fields[4];
    const amount = parseFloat(fields[5]);
    if (isNaN(amount)) return null;
    return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseStockYieldLine(fields: string[]): StockYieldEntry | null {
    const currency = fields[2];
    const date = fields[3];
    const symbol = fields[4];
    const amount = parseFloat(fields[10]);
    if (isNaN(amount)) return null;
    return { date, symbol, currency, amount };
}

/** Combine dividends by symbol+date+currency (sum amounts) */
function combineDividends(raw: IBDividend[]): IBDividend[] {
    const map = new Map<string, IBDividend>();
    for (const d of raw) {
        const key = `${d.symbol}|${d.date}|${d.currency}`;
        const existing = map.get(key);
        if (existing) {
            existing.amount += d.amount;
        } else {
            map.set(key, { ...d });
        }
    }
    return [...map.values()].filter(d => Math.abs(d.amount) > 0.001);
}
