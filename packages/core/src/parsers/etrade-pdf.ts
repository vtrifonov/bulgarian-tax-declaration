import type { BrokerProviderResult } from '../providers/types.js';
import type {
    Dividend,
    IBOpenPosition,
    InterestEntry,
} from '../types/index.js';

export interface EtradePeriod {
    startDate: string;
    endDate: string;
    year: number;
}

const MONTH_MAP: Record<string, string> = {
    January: '01',
    February: '02',
    March: '03',
    April: '04',
    May: '05',
    June: '06',
    July: '07',
    August: '08',
    September: '09',
    October: '10',
    November: '11',
    December: '12',
};

/** Find all indices of a substring in text. */
function findAllIndices(text: string, needle: string): number[] {
    const indices: number[] = [];
    let pos = 0;

    for (;;) {
        pos = text.indexOf(needle, pos);

        if (pos === -1) {
            break;
        }

        indices.push(pos);
        pos += needle.length;
    }

    return indices;
}

/**
 * Extracts the earliest period from the text.
 * In a merged PDF, there are multiple "For the Period" lines — we pick the one covering the earliest start.
 */
export function extractPeriod(text: string): EtradePeriod | null {
    const regex = /For the Period\s+(\w+)\s+(\d{1,2})-\s*(\w+)\s+(\d{1,2}),\s*(\d{4})/g;
    let earliest: EtradePeriod | null = null;
    let latest: EtradePeriod | null = null;

    for (const match of text.matchAll(regex)) {
        const [, startMonth, startDay, endMonth, endDay, yearStr] = match;
        const year = parseInt(yearStr, 10);
        const sm = MONTH_MAP[startMonth];
        const em = MONTH_MAP[endMonth];

        if (!sm || !em) {
            continue;
        }

        const period: EtradePeriod = {
            startDate: `${year}-${sm}-${startDay.padStart(2, '0')}`,
            endDate: `${year}-${em}-${endDay.padStart(2, '0')}`,
            year,
        };

        if (!earliest || period.startDate < earliest.startDate) {
            earliest = period;
        }

        if (!latest || period.endDate > latest.endDate) {
            latest = period;
        }
    }

    if (!earliest || !latest) {
        return null;
    }

    // Return the full range: earliest start to latest end
    return {
        startDate: earliest.startDate,
        endDate: latest.endDate,
        year: earliest.year,
    };
}

const STOCK_REGEX = /([A-Z][A-Z\s]+?)\s*\(([A-Z]+)\)\s+([\d,.]+)\s+\$([\d,.]+)\s+\$([\d,.]+)\s+\$([\d,.]+)/g;

/**
 * Build a map from company name words to ticker symbol.
 * E.g., "PROGRESS SOFTWARE (PRGS)" → { "PROGRESS SOFTWARE": "PRGS", "PROGRESS": "PRGS", "SOFTWARE": "PRGS" }
 */
export function parseNameToTickerMap(text: string): Record<string, string> {
    const map: Record<string, string> = {};
    const sectionStarts = findAllIndices(text, 'COMMON STOCKS');

    for (const start of sectionStarts) {
        const sectionText = text.slice(start, start + 2000);

        for (const match of sectionText.matchAll(STOCK_REGEX)) {
            const companyName = match[1].trim();
            const ticker = match[2];

            // Map full name and each word to ticker
            map[companyName] = ticker;

            for (const word of companyName.split(/\s+/)) {
                if (word.length >= 3) {
                    map[word] = ticker;
                }
            }
        }
    }

    return map;
}

/**
 * Parse holdings from ALL "COMMON STOCKS" sections.
 * In a merged PDF, the same stock appears in each quarter.
 * We deduplicate by symbol, keeping the LAST occurrence (most recent quarter).
 */
export function parseHoldings(text: string): IBOpenPosition[] {
    const bySymbol = new Map<string, IBOpenPosition>();
    const sectionStarts = findAllIndices(text, 'COMMON STOCKS');

    if (sectionStarts.length === 0) {
        return [];
    }

    for (const start of sectionStarts) {
        const sectionText = text.slice(start, start + 2000);

        for (const match of sectionText.matchAll(STOCK_REGEX)) {
            const quantity = parseFloat(match[3].replace(/,/g, ''));

            if (quantity === 0) {
                continue;
            }

            const totalCost = parseFloat(match[5].replace(/,/g, ''));

            bySymbol.set(match[2], {
                symbol: match[2],
                currency: 'USD',
                quantity,
                costPrice: totalCost / quantity,
            });
        }
    }

    return [...bySymbol.values()];
}

const MMF_PATTERNS = ['LIQUIDITY FUND', 'MONEY MARKET', 'MMF'];

function isMMFDistribution(description: string): boolean {
    const upper = description.toUpperCase();

    return MMF_PATTERNS.some(p => upper.includes(p));
}

/** Resolve a company name to a ticker symbol using the name-to-ticker map, falling back to last word. */
function resolveTickerFromName(name: string, nameToTicker?: Record<string, string>): string {
    if (nameToTicker) {
        // Try full name first
        if (nameToTicker[name]) {
            return nameToTicker[name];
        }

        // Try each word
        for (const word of name.split(/\s+/)) {
            if (nameToTicker[word]) {
                return nameToTicker[word];
            }
        }
    }

    // Fall back to last word
    return name.split(/\s+/).pop() ?? name;
}

/**
 * Parse interest entries from ALL "CASH FLOW ACTIVITY BY DATE" sections.
 * Deduplicates by (date, amount) to handle any overlap.
 */
export function parseInterest(
    text: string,
    year: number,
): Omit<InterestEntry, 'source'>[] {
    const seen = new Set<string>();
    const entries: Omit<InterestEntry, 'source'>[] = [];
    const sectionStarts = findAllIndices(text, 'CASH FLOW ACTIVITY BY DATE');

    if (sectionStarts.length === 0) {
        return entries;
    }

    for (const start of sectionStarts) {
        // Find the end of this activity section
        const sectionEnd = text.indexOf('NET CREDITS/(DEBITS)', start);
        const sectionText = sectionEnd !== -1
            ? text.slice(start, sectionEnd)
            : text.slice(start, start + 3000);

        const lines = sectionText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const divMatch = line.match(/^(\d{1,2})\/(\d{1,2})\s+Dividend\s+(.+)/);

            if (!divMatch) {
                continue;
            }

            const [, month, day, rest] = divMatch;
            let description = rest;
            let amount: number | null = null;

            // Check if amount is on this same line
            const amountOnLine = rest.match(/\$?([\d,]+\.\d{2})\s*$/);

            if (amountOnLine) {
                amount = parseFloat(amountOnLine[1].replace(/,/g, ''));
                description = rest.slice(0, rest.lastIndexOf(amountOnLine[0])).trim();
            } else {
                // Amount is on a subsequent line
                for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    const nextLine = lines[j].trim();
                    const numMatch = nextLine.match(/^\$?([\d,]+\.\d{2})$/);

                    if (numMatch) {
                        amount = parseFloat(numMatch[1].replace(/,/g, ''));
                        break;
                    }
                }
            }

            if (amount === null) {
                continue;
            }

            const cleanDesc = description
                .replace(/Transaction Reportable.*$/i, '')
                .replace(/DIV PAYMENT/i, '')
                .trim();

            if (!isMMFDistribution(cleanDesc)) {
                continue;
            }

            const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            const key = `${dateStr}|${amount}`;

            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            entries.push({
                date: dateStr,
                amount,
                currency: 'USD',
                description: cleanDesc,
            });
        }
    }

    // Sort by date
    entries.sort((a, b) => a.date.localeCompare(b.date));

    return entries;
}

/**
 * Parse equity dividends (Qualified Dividend / Dividend) and Tax Withholding from activity sections.
 * MMF distributions are excluded (handled by parseInterest).
 * WHT entries are matched to dividends by date + symbol.
 */
export function parseDividends(
    text: string,
    year: number,
    nameToTicker?: Record<string, string>,
): Omit<Dividend, 'source' | 'bgTaxDue' | 'whtCredit' | 'country'>[] {
    const seen = new Set<string>();
    const dividends: Omit<Dividend, 'source' | 'bgTaxDue' | 'whtCredit' | 'country'>[] = [];
    const whtEntries: { date: string; symbol: string; amount: number }[] = [];
    const sectionStarts = findAllIndices(text, 'CASH FLOW ACTIVITY BY DATE');

    if (sectionStarts.length === 0) {
        return dividends;
    }

    for (const start of sectionStarts) {
        const sectionEnd = text.indexOf('NET CREDITS/(DEBITS)', start);
        const sectionText = sectionEnd !== -1
            ? text.slice(start, sectionEnd)
            : text.slice(start, start + 3000);

        const lines = sectionText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Match "M/D Qualified Dividend DESCRIPTION amount" or "M/D Dividend DESCRIPTION amount"
            const divMatch = line.match(/^(\d{1,2})\/(\d{1,2})\s+(?:Qualified )?Dividend\s+(.+)/);

            if (divMatch) {
                const [, month, day, rest] = divMatch;
                let description = rest;
                let amount: number | null = null;

                const amountOnLine = rest.match(/\$?([\d,]+\.\d{2})\s*$/);

                if (amountOnLine) {
                    amount = parseFloat(amountOnLine[1].replace(/,/g, ''));
                    description = rest.slice(0, rest.lastIndexOf(amountOnLine[0])).trim();
                } else {
                    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                        const nextLine = lines[j].trim();
                        const numMatch = nextLine.match(/^\$?([\d,]+\.\d{2})$/);

                        if (numMatch) {
                            amount = parseFloat(numMatch[1].replace(/,/g, ''));
                            break;
                        }
                    }
                }

                if (amount === null) {
                    continue;
                }

                const cleanDesc = description
                    .replace(/Transaction Reportable.*$/i, '')
                    .replace(/DIV PAYMENT/i, '')
                    .trim();

                // Skip MMF distributions (those go to parseInterest)
                if (isMMFDistribution(cleanDesc)) {
                    continue;
                }

                const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                const key = `${dateStr}|${cleanDesc}|${amount}`;

                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);

                // Resolve ticker symbol: try name-to-ticker map, then fall back to last word
                const symbol = resolveTickerFromName(cleanDesc, nameToTicker);

                dividends.push({
                    symbol,
                    date: dateStr,
                    currency: 'USD',
                    grossAmount: amount,
                    withholdingTax: 0,
                });
            }

            // Match "M/D Tax Withholding DESCRIPTION (amount)" — negative amount in parens
            const whtMatch = line.match(/^(\d{1,2})\/(\d{1,2})\s+Tax Withholding\s+(.+)/);

            if (whtMatch) {
                const [, month, day, rest] = whtMatch;
                // Amount in parentheses means negative: (28.05)
                const amountMatch = rest.match(/\((\d[\d,.]*)\)/);

                if (amountMatch) {
                    const whtAmount = parseFloat(amountMatch[1].replace(/,/g, ''));
                    const whtDesc = rest.slice(0, rest.indexOf('(')).trim();
                    const symbol = resolveTickerFromName(whtDesc, nameToTicker);
                    const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

                    whtEntries.push({ date: dateStr, symbol, amount: whtAmount });
                }
            }
        }
    }

    // Match WHT to dividends by date + symbol
    for (const div of dividends) {
        const matchingWht = whtEntries.find(w => w.date === div.date && w.symbol === div.symbol);

        if (matchingWht) {
            div.withholdingTax = Math.abs(matchingWht.amount);
        }
    }

    dividends.sort((a, b) => a.date.localeCompare(b.date));

    return dividends;
}

export interface CashBalance {
    amountStartOfYear: number;
    amountEndOfYear: number;
}

/**
 * Parse cash balance from ALL "BALANCE SHEET" sections.
 * In a merged PDF, each quarter has its own balance sheet.
 * We find Q1's "Last Period" (start of year) and Q4's "This Period" (end of year).
 * The balance sheet has two "as of" dates — the first is "Last Period", the second is "This Period".
 */
export function parseCashBalance(text: string): CashBalance | null {
    const sectionStarts = findAllIndices(text, 'BALANCE SHEET');

    if (sectionStarts.length === 0) {
        return null;
    }

    const balances: { start: number; end: number; lastPeriodDate: string; thisPeriodDate: string }[] = [];

    for (const idx of sectionStarts) {
        const sectionText = text.slice(idx, idx + 500);
        const cashMatch = sectionText.match(/Cash,\s*BDP,\s*MMFs\s+\$?([\d,.]+)\s+\$?([\d,.]+)/);

        if (!cashMatch) {
            continue;
        }

        const start = parseFloat(cashMatch[1].replace(/,/g, ''));
        const end = parseFloat(cashMatch[2].replace(/,/g, ''));

        // Extract both "as of" dates: first = Last Period, second = This Period
        const dateMatches = [...sectionText.matchAll(/\(as of (\d{1,2}\/\d{1,2}\/\d{2,4})\)/g)];
        const lastPeriodDate = dateMatches[0]?.[1] ?? '';
        const thisPeriodDate = dateMatches[1]?.[1] ?? '';

        balances.push({ start, end, lastPeriodDate, thisPeriodDate });
    }

    if (balances.length === 0) {
        return null;
    }

    if (balances.length === 1) {
        return { amountStartOfYear: balances[0].start, amountEndOfYear: balances[0].end };
    }

    // Q1 balance has "Last Period" from prior year (12/31/XX) — its start = start of year
    // Q4 balance has "This Period" of 12/31/XX — its end = end of year
    const q1Balance = balances.find(b => b.lastPeriodDate.includes('12/31'));
    const q4Balance = balances.find(b => b.thisPeriodDate.includes('12/31'));

    return {
        amountStartOfYear: q1Balance?.start ?? balances[0].start,
        amountEndOfYear: q4Balance?.end ?? balances[balances.length - 1].end,
    };
}

export function parseEtradePdf(text: string): BrokerProviderResult {
    const warnings: string[] = [];
    const period = extractPeriod(text);

    if (!period) {
        warnings.push('Could not detect statement period');
    }

    const year = period?.year ?? new Date().getFullYear();
    const nameToTicker = parseNameToTickerMap(text);
    const holdings = parseHoldings(text);
    const interestEntries = parseInterest(text, year);
    const rawDividends = parseDividends(text, year, nameToTicker);
    const cashBalance = parseCashBalance(text);

    const interest: InterestEntry[] = interestEntries.map(e => ({
        currency: e.currency,
        date: e.date,
        amount: e.amount,
        description: e.description,
    }));

    // Convert raw dividends to full Dividend type (bgTaxDue/whtCredit/country set by UI)
    const dividends: Dividend[] = rawDividends.map(d => ({
        ...d,
        country: '',
        bgTaxDue: 0,
        whtCredit: 0,
    }));

    const foreignAccounts = cashBalance
        ? [
            {
                broker: 'E*TRADE',
                type: '03' as const,
                maturity: 'L' as const,
                country: 'US',
                currency: 'USD',
                amountStartOfYear: cashBalance.amountStartOfYear,
                amountEndOfYear: cashBalance.amountEndOfYear,
            },
        ]
        : [];

    return {
        openPositions: holdings,
        dividends: dividends.length > 0 ? dividends : undefined,
        interest,
        foreignAccounts,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}
