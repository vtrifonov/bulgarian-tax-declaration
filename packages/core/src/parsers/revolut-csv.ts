import type { RevolutInterest } from '../types/index.js';

export function parseRevolutCsv(csv: string): RevolutInterest {
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length === 0) throw new Error('Empty CSV');

    const header = lines[0];
    const currency = detectCurrency(header);
    const valueColIndex = getValueColumnIndex(header, currency);

    const entries: RevolutInterest['entries'] = [];

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVRow(lines[i]);
        const description = fields[1]?.trim() ?? '';

        // Only keep Interest PAID and Service Fee Charged
        const descType = classifyDescription(description);
        if (!descType) continue;

        const date = parseRevolutDate(fields[0]);
        const amount = parseFloat(fields[valueColIndex]);
        if (isNaN(amount)) continue;

        entries.push({ date, description: descType, amount });
    }

    return { currency, entries };
}

function detectCurrency(header: string): string {
    // "Value, EUR" or "Value, USD" or "Value, GBP"
    const match = header.match(/Value, (\w{3})/);
    if (!match) throw new Error('Cannot detect currency from header: ' + header);
    return match[1];
}

function getValueColumnIndex(header: string, currency: string): number {
    const fields = parseCSVRow(header);
    // Find the column "Value, {currency}"
    return fields.findIndex(f => f.includes(`Value, ${currency}`));
}

function classifyDescription(desc: string): string | null {
    if (desc.startsWith('Interest PAID')) return 'Interest PAID';
    if (desc.startsWith('Service Fee Charged')) return 'Service Fee Charged';
    return null; // Skip BUY, SELL, Reinvested, etc.
}

function parseRevolutDate(raw: string): string {
    // "Jan 3, 2025, 2:46:51 AM" → "2025-01-03"
    // Remove time part: everything after the year
    const cleaned = raw.replace(/"/g, '').trim();
    const match = cleaned.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})/);
    if (!match) throw new Error('Cannot parse date: ' + raw);
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
    if (!month) throw new Error('Unknown month: ' + monthStr);
    return `${year}-${month}-${day.padStart(2, '0')}`;
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
