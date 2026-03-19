import { parseCSVRow } from './revolut-csv.js';
import type { ForeignAccountBalance } from '../types/index.js';

/**
 * Parse Revolut current account statement to extract cash balance
 * for SPB-8 Section 03.
 *
 * Header: Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
 */
export function parseRevolutAccountStatement(csv: string): ForeignAccountBalance {
    const lines = csv.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
        throw new Error('Empty CSV');
    }

    const header = parseCSVRow(lines[0]);
    const colIndex = (name: string) => header.findIndex(h => h.trim() === name);

    const iProduct = colIndex('Product');
    const iAmount = colIndex('Amount');
    const iCurrency = colIndex('Currency');
    const iState = colIndex('State');
    const iBalance = colIndex('Balance');

    let firstBalance: number | null = null;
    let firstAmount: number | null = null;
    let lastBalance: number | null = null;
    let currency = '';

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVRow(lines[i]);
        const product = fields[iProduct]?.trim();
        const state = fields[iState]?.trim();

        // Only Current account, COMPLETED transactions
        if (product !== 'Current' || state !== 'COMPLETED') {
            continue;
        }

        const balance = parseFloat(fields[iBalance]?.trim() ?? '');
        const amount = parseFloat(fields[iAmount]?.trim() ?? '');

        if (isNaN(balance)) {
            continue;
        }

        if (!currency) {
            currency = fields[iCurrency]?.trim() ?? '';
        }

        if (firstBalance === null) {
            firstBalance = balance;
            firstAmount = isNaN(amount) ? 0 : amount;
        }
        lastBalance = balance;
    }

    const startOfYear = firstBalance !== null && firstAmount !== null
        ? firstBalance - firstAmount
        : 0;

    return {
        broker: 'Revolut',
        type: '03',
        maturity: 'S',
        country: 'LT',
        currency,
        amountStartOfYear: startOfYear,
        amountEndOfYear: lastBalance ?? 0,
    };
}
