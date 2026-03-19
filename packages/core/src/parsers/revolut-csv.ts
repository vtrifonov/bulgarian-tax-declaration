import type {
    BrokerInterest,
    InterestEntry,
} from '../types/index.js';

export function parseRevolutCsv(csv: string): BrokerInterest {
    const lines = csv.split('\n').filter(l => l.trim());

    if (lines.length === 0) {
        throw new Error('Empty CSV');
    }

    const header = lines[0];
    const currency = detectCurrency(header);
    const valueColIndex = getValueColumnIndex(header, currency);

    const entries: InterestEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVRow(lines[i]);
        const description = fields[1]?.trim() ?? '';

        // Only keep Interest PAID and Service Fee Charged
        const descType = classifyDescription(description);

        if (!descType) {
            continue;
        }

        const date = parseRevolutDate(fields[0]);
        const amount = parseFloat(fields[valueColIndex]);

        if (isNaN(amount)) {
            continue;
        }

        entries.push({ currency, date, description: descType, amount });
    }

    return { broker: 'Revolut', currency, entries };
}

function detectCurrency(header: string): string {
    // "Value, EUR" or "Value, USD" or "Value, GBP"
    const match = header.match(/Value, (\w{3})/);

    if (!match) {
        throw new Error('Cannot detect currency from header: ' + header);
    }

    return match[1];
}

function getValueColumnIndex(header: string, currency: string): number {
    const fields = parseCSVRow(header);
    const index = fields.findIndex(f => f.includes(`Value, ${currency}`));

    if (index === -1) {
        throw new Error(`Cannot find "Value, ${currency}" column in header: ${header}`);
    }

    return index;
}

function classifyDescription(desc: string): string | null {
    if (desc.startsWith('Interest PAID')) {
        return 'Interest PAID';
    }

    if (desc.startsWith('Service Fee Charged')) {
        return 'Service Fee Charged';
    }

    return null; // Skip BUY, SELL, Reinvested, etc.
}

function parseRevolutDate(raw: string): string {
    // "Jan 3, 2025, 2:46:51 AM" → "2025-01-03"
    // Remove time part: everything after the year
    const cleaned = raw.replace(/"/g, '').trim();
    const match = cleaned.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})/);

    if (!match) {
        throw new Error('Cannot parse date: ' + raw);
    }
    const [, monthStr, day, year] = match;
    const months: Record<string, string> = {
        Jan: '01',
        Feb: '02',
        Mar: '03',
        Apr: '04',
        May: '05',
        Jun: '06',
        Jul: '07',
        Aug: '08',
        Sep: '09',
        Oct: '10',
        Nov: '11',
        Dec: '12',
    };
    const month = months[monthStr];

    if (!month) {
        throw new Error('Unknown month: ' + monthStr);
    }

    return `${year}-${month}-${day.padStart(2, '0')}`;
}

const ISIN_REGEX = /[A-Z]{2}[A-Z0-9]{9}[0-9]/;

export interface RevolutSavingsPosition {
    isin: string;
    currency: string;
    quantityStartOfYear: number;
    quantityEndOfYear: number;
}

export function parseRevolutSavingsPositions(csv: string): RevolutSavingsPosition {
    const lines = csv.split('\n').filter(l => l.trim());

    if (lines.length === 0) {
        throw new Error('Empty CSV');
    }

    const currency = detectCurrency(lines[0]);
    let isin = '';
    let totalBought = 0;
    let totalSold = 0;

    // Lines are in reverse chronological order (newest first)
    for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVRow(lines[i]);
        const description = fields[1]?.trim() ?? '';

        // Extract ISIN from first matching line
        if (!isin) {
            const match = description.match(ISIN_REGEX);

            if (match) {
                isin = match[0];
            }
        }

        if (description.startsWith('BUY')) {
            const qtyStr = fields[4]?.trim() ?? '';
            const qty = parseFloat(qtyStr.replace(/,/g, ''));

            if (!isNaN(qty)) {
                totalBought += qty;
            }
        } else if (description.startsWith('SELL')) {
            const qtyStr = fields[4]?.trim() ?? '';
            const qty = parseFloat(qtyStr.replace(/,/g, ''));

            if (!isNaN(qty)) {
                totalSold += qty;
            }
        }
    }

    return {
        isin,
        currency,
        quantityStartOfYear: 0,
        quantityEndOfYear: totalBought - totalSold,
    };
}

export function parseCSVRow(row: string): string[] {
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
