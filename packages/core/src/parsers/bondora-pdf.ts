import type {
    BrokerInterest,
    ForeignAccountBalance,
    InterestEntry,
} from '../types/index.js';

export interface BondoraPdfResult {
    interest: BrokerInterest;
    foreignAccount: ForeignAccountBalance;
    warnings: string[];
}

/**
 * Extract a date from text like "01/01/2025 - 12/31/2025" → { start: '2025-01-01', end: '2025-12-31' }
 */
function extractPeriod(text: string): { start: string; end: string } | null {
    const match = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(text);

    if (!match) {
        return null;
    }

    return {
        start: `${match[3]}-${match[1]}-${match[2]}`,
        end: `${match[6]}-${match[4]}-${match[5]}`,
    };
}

export function detectBondoraPdf(text: string): boolean {
    return text.includes('Bondora') && (
        text.includes('Income statement for period')
        || text.includes('Account Statement')
    );
}

export function parseBondoraPdf(text: string): BondoraPdfResult {
    if (!text || !text.includes('Bondora')) {
        throw new Error('Not a Bondora Tax Report PDF');
    }

    const warnings: string[] = [];
    const entries: InterestEntry[] = [];

    // Extract period
    const period = extractPeriod(text);
    const periodEnd = period?.end ?? new Date().toISOString().slice(0, 10);

    // Page 1: Income statement — interest income lines
    const interestPatterns: { label: string; regex: RegExp }[] = [
        { label: 'Interest - current loans', regex: /Получена лихва - текущи заеми\s+€(-?\d+(?:[.,]\d+)?)/ },
        { label: 'Interest - overdue loans', regex: /Получена лихва - просрочени кредити\s+€(-?\d+(?:[.,]\d+)?)/ },
        { label: 'Go & Grow interest', regex: /Go & Grow получена лихва\s+€(-?\d+(?:[.,]\d+)?)/ },
    ];

    for (const { label, regex } of interestPatterns) {
        const match = regex.exec(text);

        if (match) {
            const amount = parseFloat(match[1].replace(',', '.'));

            if (amount !== 0) {
                entries.push({
                    currency: 'EUR',
                    date: periodEnd,
                    description: label,
                    amount,
                });
            }
        }
    }

    // Also try English labels for non-Bulgarian PDFs
    const enPatterns: { label: string; regex: RegExp }[] = [
        { label: 'Interest - current loans', regex: /Interest received - current loans\s+€(-?\d+(?:[.,]\d+)?)/ },
        { label: 'Interest - overdue loans', regex: /Interest received - overdue loans\s+€(-?\d+(?:[.,]\d+)?)/ },
        { label: 'Go & Grow interest', regex: /Go & Grow interest received\s+€(-?\d+(?:[.,]\d+)?)/ },
    ];

    // Only use English patterns if no Bulgarian ones matched
    if (entries.length === 0) {
        for (const { label, regex } of enPatterns) {
            const match = regex.exec(text);

            if (match) {
                const amount = parseFloat(match[1].replace(',', '.'));

                if (amount !== 0) {
                    entries.push({
                        currency: 'EUR',
                        date: periodEnd,
                        description: label,
                        amount,
                    });
                }
            }
        }
    }

    // Page 2: Account statement — balances
    let amountStartOfYear = 0;
    let amountEndOfYear = 0;

    // "Стойност на акаунта 01/01/2025 €279.01" and "Стойност на акаунта 12/31/2025 €283.45"
    const allAccountValues = [...text.matchAll(/Стойност на акаунта \d{2}\/\d{2}\/\d{4}\s+€(-?\d+(?:[.,]\d+)?)/g)];

    if (allAccountValues.length >= 2) {
        amountStartOfYear = parseFloat(allAccountValues[0][1].replace(',', '.'));
        amountEndOfYear = parseFloat(allAccountValues[1][1].replace(',', '.'));
    } else if (allAccountValues.length === 1) {
        amountEndOfYear = parseFloat(allAccountValues[0][1].replace(',', '.'));
        warnings.push('Only one account value found — start-of-year balance set to 0');
    } else {
        // Try English: "Account value 01/01/2025 €279.01"
        const enValues = [...text.matchAll(/Account value \d{2}\/\d{2}\/\d{4}\s+€(-?\d+(?:[.,]\d+)?)/g)];

        if (enValues.length >= 2) {
            amountStartOfYear = parseFloat(enValues[0][1].replace(',', '.'));
            amountEndOfYear = parseFloat(enValues[1][1].replace(',', '.'));
        } else if (enValues.length === 1) {
            amountEndOfYear = parseFloat(enValues[0][1].replace(',', '.'));
            warnings.push('Only one account value found — start-of-year balance set to 0');
        } else {
            // Fallback: try "Начално салдо" (opening balance)
            const openingMatch = /Начално салдо\s+€(-?\d+(?:[.,]\d+)?)/.exec(text);
            const closingMatch = /Окончателно салдо\s+€(-?\d+(?:[.,]\d+)?)/.exec(text);

            if (openingMatch) {
                amountStartOfYear = parseFloat(openingMatch[1].replace(',', '.'));
            }

            if (closingMatch) {
                amountEndOfYear = parseFloat(closingMatch[1].replace(',', '.'));
            }

            if (!openingMatch && !closingMatch) {
                warnings.push('Could not extract account balances from PDF');
            }
        }
    }

    if (entries.length === 0) {
        warnings.push('No interest income found in PDF — all amounts may be zero');
    }

    return {
        interest: {
            broker: 'Bondora',
            currency: 'EUR',
            entries,
        },
        foreignAccount: {
            broker: 'Bondora',
            type: '03',
            maturity: 'S',
            country: 'EE',
            currency: 'EUR',
            amountStartOfYear,
            amountEndOfYear,
        },
        warnings,
    };
}
