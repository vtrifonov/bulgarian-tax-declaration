import type { Holding } from '../types/index.js';
import { resolveCountry } from '../country-map.js';

interface RevolutTrade {
    date: string;
    ticker: string;
    type: string;
    quantity: number;
    pricePerShare: number;
    totalAmount: number;
    currency: string;
    fxRate: number;
}

/**
 * Parse Revolut Investments yearly statement CSV.
 * Format: Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
 * Amounts are prefixed with currency code, e.g. "USD 6".
 *
 * Returns aggregated holdings (BUY entries grouped by ticker).
 */
export function parseRevolutInvestmentsCsv(csv: string): { trades: RevolutTrade[]; holdings: Holding[] } {
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { trades: [], holdings: [] };

    const trades: RevolutTrade[] = [];

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVLine(lines[i]);
        if (fields.length < 8) continue;

        const [dateStr, ticker, type, quantityStr, priceStr, totalStr, currency, fxRateStr] = fields;

        // Skip non-trade rows (top-ups, promotions without ticker)
        if (!ticker || !type.includes('BUY') && !type.includes('SELL')) continue;

        const quantity = parseFloat(quantityStr) || 0;
        const pricePerShare = parseCurrencyAmount(priceStr);
        const totalAmount = parseCurrencyAmount(totalStr);
        const fxRate = parseFloat(fxRateStr) || 1;
        const date = dateStr.split('T')[0]; // ISO date only

        trades.push({ date, ticker, type, quantity, pricePerShare, totalAmount, currency, fxRate });
    }

    // Aggregate into holdings: group BUY entries by ticker, sum quantities, weighted avg price
    const holdingMap = new Map<string, { totalQty: number; totalCost: number; currency: string; firstDate: string }>();

    for (const t of trades) {
        if (!t.type.includes('BUY')) continue;

        const existing = holdingMap.get(t.ticker);
        if (existing) {
            existing.totalQty += t.quantity;
            existing.totalCost += t.totalAmount;
            if (t.date < existing.firstDate) existing.firstDate = t.date;
        } else {
            holdingMap.set(t.ticker, {
                totalQty: t.quantity,
                totalCost: t.totalAmount,
                currency: t.currency,
                firstDate: t.date,
            });
        }
    }

    // Subtract SELL quantities — reduce cost proportionally (avg cost per share)
    for (const t of trades) {
        if (!t.type.includes('SELL')) continue;
        const existing = holdingMap.get(t.ticker);
        if (existing && existing.totalQty > 0) {
            const avgCost = existing.totalCost / existing.totalQty;
            existing.totalQty -= t.quantity;
            existing.totalCost = existing.totalQty > 0 ? existing.totalQty * avgCost : 0;
        }
    }

    const holdings: Holding[] = [];
    for (const [ticker, data] of holdingMap) {
        if (data.totalQty <= 0) continue;
        const avgPrice = data.totalQty > 0 ? data.totalCost / data.totalQty : 0;
        holdings.push({
            id: `revolut-${ticker}-${Date.now()}`,
            broker: 'Revolut',
            country: resolveCountry(ticker),
            symbol: ticker,
            dateAcquired: data.firstDate,
            quantity: data.totalQty,
            currency: data.currency,
            unitPrice: avgPrice,
        });
    }

    return { trades, holdings };
}

/** Parse "USD 6" or "USD 321.02" → 6 or 321.02 */
function parseCurrencyAmount(str: string): number {
    const match = str.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
}

/** Simple CSV line parser handling quoted fields */
function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
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
