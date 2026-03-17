import type {
    IBDividend,
    IBOpenPosition,
    IBParsedData,
    IBWithholdingTax,
    InterestEntry,
    StockYieldEntry,
    Trade,
} from '../types/index.js';

export function parseIBCsv(csv: string): IBParsedData {
    const lines = parseCsvLines(csv);
    const trades: Trade[] = [];
    const rawDividends: IBDividend[] = [];
    const withholdingTax: IBWithholdingTax[] = [];
    const stockYield: StockYieldEntry[] = [];
    const interest: InterestEntry[] = [];
    const openPositions: IBOpenPosition[] = [];
    const instrumentAliases: Array<{ symbols: string[]; primarySymbol: string }> = [];

    for (const fields of lines) {
        const section = fields[0];
        const rowType = fields[1]; // Header, Data, SubTotal, Total

        if (rowType !== 'Data') {
            continue;
        }

        if (section === 'Financial Instrument Information' && fields[2] === 'Stocks') {
            // field[3] = "CSPX, SXR8" or "ZPRG, GLDV" or just "AAPL"
            // field[7] = primary symbol (used in Open Positions exchange listings)
            const rawSymbols = fields[3];
            const primarySymbol = fields[7] ?? rawSymbols;
            const symbols = rawSymbols.split(',').map(s => s.trim()).filter(Boolean);
            if (symbols.length > 1) {
                instrumentAliases.push({ symbols, primarySymbol });
            }
        } else if (section === 'Open Positions' && fields[2] === 'Summary' && fields[3] === 'Stocks') {
            const pos = parseOpenPosition(fields);
            if (pos) openPositions.push(pos);
        } else if (section === 'Trades' && fields[2] === 'Order' && fields[3] === 'Stocks') {
            trades.push(parseTrade(fields));
        } else if (section === 'Dividends' && isDataRow(fields[2])) {
            // This also captures "Payment in Lieu of Dividend" entries
            const div = parseDividendLine(fields);

            if (div) {
                rawDividends.push(div);
            }
        } else if (section === 'Withholding Tax' && isDataRow(fields[2])) {
            const wht = parseWhtLine(fields);

            if (wht) {
                withholdingTax.push(wht);
            }
        } else if (section.startsWith('Stock Yield Enhancement Program Securities Lent Interest Details') && isDataRow(fields[2])) {
            const sy = parseStockYieldLine(fields);

            if (sy) {
                stockYield.push(sy);
            }
        } else if (section === 'Interest' && isDataRow(fields[2])) {
            // Cash interest: SYEP interest, debit interest, etc.
            const entry = parseInterestLine(fields);

            if (entry) {
                interest.push(entry);
            }
        } else if (section === 'Transfers' && fields[2] === 'Stocks' && fields[7] === 'In') {
            // Position transfers in — treat as buy lots so FIFO can match sells
            const transfer = parseTransferLine(fields);

            if (transfer) {
                trades.push(transfer);
            }
        }
    }

    // Build symbol alias map: every alias → primary symbol (the one in Open Positions)
    const openSymbols = new Set(openPositions.map(p => p.symbol));
    const symbolAliases: Record<string, string> = {};

    for (const info of instrumentAliases) {
        const primary = info.symbols.find(s => openSymbols.has(s)) ?? info.primarySymbol;

        for (const sym of info.symbols) {
            if (sym !== primary) {
                symbolAliases[sym] = primary;
            }
        }
    }

    // Normalize all symbols to their primary (exchange) name BEFORE combining
    const normalizeSymbol = (sym: string) => symbolAliases[sym] ?? sym;

    for (const t of trades) t.symbol = normalizeSymbol(t.symbol);
    for (const d of rawDividends) d.symbol = normalizeSymbol(d.symbol);
    for (const w of withholdingTax) w.symbol = normalizeSymbol(w.symbol);
    for (const s of stockYield) s.symbol = normalizeSymbol(s.symbol);

    const dividends = combineDividends(rawDividends);

    return { trades, dividends, withholdingTax, stockYield, interest, openPositions, symbolAliases };
}

/** Check if field[2] is a currency code (data row), not a Total/SubTotal line */
function isDataRow(field2: string): boolean {
    if (!field2) return false;

    // Skip Total, SubTotal, and "Total in XXX" lines
    const lower = field2.toLowerCase();
    if (lower === 'total' || lower.startsWith('total')) {
        return false;
    }

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

function parseOpenPosition(fields: string[]): IBOpenPosition | null {
    const quantity = parseFloat(fields[6]?.replace(/,/g, '') ?? '');
    const costPrice = parseFloat(fields[8] ?? '');

    if (isNaN(quantity) || quantity <= 0 || isNaN(costPrice)) {
        return null;
    }

    return {
        symbol: fields[5],
        currency: fields[4],
        quantity,
        costPrice,
    };
}

function parseTrade(fields: string[]): Trade {
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

    if (isNaN(amount)) {
        return null;
    }

    return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseWhtLine(fields: string[]): IBWithholdingTax | null {
    const currency = fields[2];
    const date = fields[3];
    const description = fields[4];
    const amount = parseFloat(fields[5]);

    if (isNaN(amount)) {
        return null;
    }

    return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseStockYieldLine(fields: string[]): StockYieldEntry | null {
    const currency = fields[2];
    const date = fields[3];
    const symbol = fields[4];
    const amount = parseFloat(fields[10]);

    if (isNaN(amount)) {
        return null;
    }

    return { date, symbol, currency, amount };
}

function parseInterestLine(fields: string[]): InterestEntry | null {
    // Interest,Data,{currency},{date},{description},{amount}
    const currency = fields[2];
    const date = fields[3];
    const description = fields[4];
    const amount = parseFloat(fields[5]);

    if (isNaN(amount)) {
        return null;
    }

    return { currency, date, description, amount };
}

/**
 * Parse a Transfers row (position transfer in) as a synthetic buy trade.
 * Format: Transfers,Data,Stocks,{ccy},{symbol},{date},{type},{dir},{co},{acct},{qty},{price},{mktVal},...
 * Date and price are left empty — user must fill in the original acquisition details.
 */
function parseTransferLine(fields: string[]): Trade | null {
    const currency = fields[3];
    const symbol = fields[4];
    const qty = parseFloat(fields[10]?.replace(/,/g, ''));

    if (!symbol || isNaN(qty) || qty <= 0) {
        return null;
    }

    return {
        currency,
        symbol,
        dateTime: '', // Unknown — user fills in original acquisition date
        quantity: qty,
        price: 0, // Unknown — user fills in original buy price
        proceeds: 0,
        commission: 0,
    };
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
