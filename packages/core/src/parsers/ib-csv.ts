import type {
    IBDividend,
    IBOpenPosition,
    IBParsedData,
    IBWithholdingTax,
    InterestEntry,
    StockYieldEntry,
    Trade,
} from '../types/index.js';

type ColMap = Record<string, number>;

/** Build a column-name → index map from a header row */
function buildColumnMap(fields: string[]): ColMap {
    const map: ColMap = {};

    for (let i = 0; i < fields.length; i++) {
        const name = fields[i].trim();

        if (name) {
            map[name] = i;
        }
    }

    return map;
}

/** Safe field accessor — returns empty string if column not found */
function col(fields: string[], colMap: ColMap, name: string): string {
    const idx = colMap[name];

    return idx !== undefined ? (fields[idx] ?? '') : '';
}

/**
 * Check if a row's asset category matches the expected value.
 * IB headers vary — sometimes the category is under 'Asset Category',
 * sometimes under 'DataDiscriminator', depending on the section/export format.
 */
function hasAssetCategory(fields: string[], colMap: ColMap, expected: string): boolean {
    return col(fields, colMap, 'Asset Category') === expected || col(fields, colMap, 'DataDiscriminator') === expected;
}

export function parseIBCsv(csv: string): IBParsedData {
    const lines = parseCsvLines(csv);
    const trades: Trade[] = [];
    const rawDividends: IBDividend[] = [];
    const withholdingTax: IBWithholdingTax[] = [];
    const stockYield: StockYieldEntry[] = [];
    const interest: InterestEntry[] = [];
    const openPositions: IBOpenPosition[] = [];
    const instrumentAliases: Array<{ symbols: string[]; primarySymbol: string }> = [];
    const symbolExchanges: Record<string, string> = {};
    const columnMaps: Record<string, ColMap> = {};
    let brokerName: string | undefined;
    const cashBalances: { currency: string; amountStartOfYear: number; amountEndOfYear: number }[] = [];
    const isinMap: Record<string, string> = {};

    for (const fields of lines) {
        const section = fields[0];
        const rowType = fields[1]; // Header, Data, SubTotal, Total

        if (rowType === 'Header') {
            columnMaps[section] = buildColumnMap(fields);
            continue;
        }

        if (rowType !== 'Data') {
            continue;
        }

        const colMap = columnMaps[section];

        // Fall back to raw index access if no header was seen (shouldn't happen in valid IB CSVs)
        if (!colMap) {
            continue;
        }

        if (section === 'Statement' && rowType === 'Data') {
            const fieldName = col(fields, colMap, 'Field Name');

            if (fieldName === 'BrokerName') {
                brokerName = col(fields, colMap, 'Field Value');
            }
        } else if (section === 'Cash Report' && rowType === 'Data') {
            const summary = col(fields, colMap, 'Currency Summary');
            const currency = col(fields, colMap, 'Currency');

            if (currency === 'Base Currency Summary') {
                continue;
            }

            if (summary === 'Starting Cash' || summary === 'Ending Cash') {
                const amount = parseFloat(col(fields, colMap, 'Total'));

                if (isNaN(amount)) {
                    continue;
                }
                let entry = cashBalances.find(b => b.currency === currency);

                if (!entry) {
                    entry = { currency, amountStartOfYear: 0, amountEndOfYear: 0 };
                    cashBalances.push(entry);
                }

                if (summary === 'Starting Cash') {
                    entry.amountStartOfYear = amount;
                } else {
                    entry.amountEndOfYear = amount;
                }
            }
        } else if (section === 'Financial Instrument Information' && col(fields, colMap, 'Asset Category') === 'Stocks') {
            // field "Symbol" = "CSPX, SXR8" or "ZPRG, GLDV" or just "AAPL" or "ISPAd"
            // field "Underlying" = underlying/primary symbol (e.g. "ISPA" for "ISPAd")
            // field "Listing Exch" = listing exchange (e.g. "NASDAQ", "IBIS", "SEHK")
            const rawSymbols = col(fields, colMap, 'Symbol');
            const primarySymbol = col(fields, colMap, 'Underlying') || rawSymbols;
            const exchange = col(fields, colMap, 'Listing Exch');
            const securityId = col(fields, colMap, 'Security ID');
            const symbols = rawSymbols.split(',').map(s => s.trim()).filter(Boolean);

            if (symbols.length > 1 || (symbols.length === 1 && symbols[0] !== primarySymbol)) {
                instrumentAliases.push({ symbols, primarySymbol });
            }

            // Map primary symbol to exchange
            if (primarySymbol && exchange) {
                symbolExchanges[primarySymbol] = exchange;
            }

            // Extract ISIN mapping for SPB-8
            if (securityId) {
                for (const sym of symbols) {
                    isinMap[sym] = securityId;
                }
            }
        } else if (section === 'Open Positions' && col(fields, colMap, 'DataDiscriminator') === 'Summary' && col(fields, colMap, 'Asset Category') === 'Stocks') {
            const pos = parseOpenPosition(fields, colMap);

            if (pos) {
                openPositions.push(pos);
            }
        } else if (section === 'Trades' && col(fields, colMap, 'DataDiscriminator') === 'Order' && col(fields, colMap, 'Asset Category') === 'Stocks') {
            trades.push(parseTrade(fields, colMap));
        } else if (section === 'Dividends' && isDataRow(col(fields, colMap, 'Currency'))) {
            // This also captures "Payment in Lieu of Dividend" entries
            const div = parseDividendLine(fields, colMap);

            if (div) {
                rawDividends.push(div);
            }
        } else if (section === 'Withholding Tax' && isDataRow(col(fields, colMap, 'Currency'))) {
            const wht = parseWhtLine(fields, colMap);

            if (wht) {
                withholdingTax.push(wht);
            }
        } else if (section.startsWith('Stock Yield Enhancement Program Securities Lent Interest Details') && isDataRow(col(fields, colMap, 'Currency'))) {
            const sy = parseStockYieldLine(fields, colMap);

            if (sy) {
                stockYield.push(sy);
            }
        } else if (section === 'Interest' && isDataRow(col(fields, colMap, 'Currency'))) {
            // Cash interest: SYEP interest, debit interest, etc.
            const entry = parseInterestLine(fields, colMap);

            if (entry) {
                interest.push(entry);
            }
        } else if (section === 'Transfers' && hasAssetCategory(fields, colMap, 'Stocks') && col(fields, colMap, 'Direction') === 'In') {
            // Position transfers in — treat as buy lots so FIFO can match sells
            const transfer = parseTransferLine(fields, colMap);

            if (transfer) {
                trades.push(transfer);
            }
        }
    }

    // Build symbol alias map: every alias → primary symbol (the one in Open Positions)
    const openSymbols = new Set(openPositions.map(p => p.symbol));
    const symbolAliases: Record<string, string> = {};

    for (const info of instrumentAliases) {
        let primary: string;

        if (info.symbols.length === 1) {
            // Single symbol with exchange suffix (ISPAd → ISPA): use the clean underlying
            primary = info.primarySymbol;
        } else {
            // Multi-alias (CSPX, SXR8): prefer the one in Open Positions
            primary = info.symbols.find(s => openSymbols.has(s)) ?? info.primarySymbol;
        }

        for (const sym of info.symbols) {
            if (sym !== primary) {
                symbolAliases[sym] = primary;
            }
        }
    }

    // Normalize all symbols to their primary (exchange) name BEFORE combining
    const normalizeSymbol = (sym: string) => symbolAliases[sym] ?? sym;

    for (const t of trades) {
        t.symbol = normalizeSymbol(t.symbol);
    }

    for (const d of rawDividends) {
        d.symbol = normalizeSymbol(d.symbol);
    }

    for (const w of withholdingTax) {
        w.symbol = normalizeSymbol(w.symbol);
    }

    for (const s of stockYield) {
        s.symbol = normalizeSymbol(s.symbol);
    }

    for (const p of openPositions) {
        p.symbol = normalizeSymbol(p.symbol);
    }

    const dividends = combineDividends(rawDividends);

    return {
        trades,
        dividends,
        withholdingTax,
        stockYield,
        interest,
        openPositions,
        symbolAliases,
        symbolExchanges,
        brokerName: brokerName || undefined,
        cashBalances: cashBalances.length > 0 ? cashBalances : undefined,
        isinMap: Object.keys(isinMap).length > 0 ? isinMap : undefined,
    };
}

/** Check if field is a currency code (data row), not a Total/SubTotal line */
function isDataRow(field: string): boolean {
    if (!field) {
        return false;
    }

    // Skip Total, SubTotal, and "Total in XXX" lines
    const lower = field.toLowerCase();

    if (lower === 'total' || lower.startsWith('total')) {
        return false;
    }

    // Valid currency codes are 3 uppercase letters
    return /^[A-Z]{3}$/.test(field);
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

function parseOpenPosition(fields: string[], colMap: ColMap): IBOpenPosition | null {
    const quantity = parseFloat(col(fields, colMap, 'Quantity').replace(/,/g, '') || 'NaN');
    const costPrice = parseFloat(col(fields, colMap, 'Cost Price') || 'NaN');

    if (isNaN(quantity) || quantity <= 0 || isNaN(costPrice)) {
        return null;
    }

    return {
        symbol: col(fields, colMap, 'Symbol'),
        currency: col(fields, colMap, 'Currency'),
        quantity,
        costPrice,
    };
}

function parseTrade(fields: string[], colMap: ColMap): Trade {
    const basisStr = col(fields, colMap, 'Basis');

    return {
        currency: col(fields, colMap, 'Currency'),
        symbol: col(fields, colMap, 'Symbol'),
        dateTime: col(fields, colMap, 'Date/Time'),
        quantity: parseFloat(col(fields, colMap, 'Quantity').replace(/,/g, '')),
        price: parseFloat(col(fields, colMap, 'T. Price')),
        proceeds: parseFloat(col(fields, colMap, 'Proceeds')),
        commission: parseFloat(col(fields, colMap, 'Comm/Fee')),
        basis: basisStr.length > 0 ? parseFloat(basisStr) : undefined,
    };
}

function parseDividendLine(fields: string[], colMap: ColMap): IBDividend | null {
    const currency = col(fields, colMap, 'Currency');
    const date = col(fields, colMap, 'Date');
    const description = col(fields, colMap, 'Description');
    const amount = parseFloat(col(fields, colMap, 'Amount'));

    if (isNaN(amount)) {
        return null;
    }

    return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseWhtLine(fields: string[], colMap: ColMap): IBWithholdingTax | null {
    const currency = col(fields, colMap, 'Currency');
    const date = col(fields, colMap, 'Date');
    const description = col(fields, colMap, 'Description');
    const amount = parseFloat(col(fields, colMap, 'Amount'));

    if (isNaN(amount)) {
        return null;
    }

    // Skip non-dividend WHT (e.g. "Withholding @ 20% on Credit Interest...")
    // Dividend WHT always has SYMBOL(ISIN) pattern
    if (!description.includes('(')) {
        return null;
    }

    return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseStockYieldLine(fields: string[], colMap: ColMap): StockYieldEntry | null {
    const currency = col(fields, colMap, 'Currency');
    const date = col(fields, colMap, 'Value Date');
    const symbol = col(fields, colMap, 'Symbol');
    const amount = parseFloat(col(fields, colMap, 'Interest Paid to Customer'));

    if (isNaN(amount)) {
        return null;
    }

    return { date, symbol, currency, amount };
}

function parseInterestLine(fields: string[], colMap: ColMap): InterestEntry | null {
    const currency = col(fields, colMap, 'Currency');
    const date = col(fields, colMap, 'Date');
    const description = col(fields, colMap, 'Description');
    const amount = parseFloat(col(fields, colMap, 'Amount'));

    if (isNaN(amount)) {
        return null;
    }

    return { currency, date, description, amount };
}

/**
 * Parse a Transfers row (position transfer in) as a synthetic buy trade.
 * Date and price are left empty — user must fill in the original acquisition details.
 */
function parseTransferLine(fields: string[], colMap: ColMap): Trade | null {
    const currency = col(fields, colMap, 'Currency');
    const symbol = col(fields, colMap, 'Symbol');
    const qtyStr = col(fields, colMap, 'Qty') || col(fields, colMap, 'Quantity');
    const qty = parseFloat(qtyStr.replace(/,/g, '') || 'NaN');

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
