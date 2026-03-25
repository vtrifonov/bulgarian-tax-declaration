/**
 * Fetch year-end closing prices from Stooq for SPB-8 threshold calculation.
 * Stooq provides free historical price data via CSV with no API key and generous rate limits.
 * URL: https://stooq.com/q/d/l/?s={symbol}&d1=YYYYMMDD&d2=YYYYMMDD&i=d
 */

/** Result of a price fetch for a single symbol */
export interface YearEndPrice {
    symbol: string;
    isin: string;
    price: number;
    currency: string;
    date: string; // actual close date (may be last trading day before Dec 31)
}

/**
 * ISIN country prefix → Stooq exchange suffixes to try (in order of likelihood).
 * Securities can trade on multiple exchanges — we try each until one works.
 */
const ISIN_PREFIX_TO_STOOQ_SUFFIXES: Record<string, string[]> = {
    US: ['.us'],
    DE: ['.de', '.us'],
    NL: ['.us', '.nl', '.de'], // NL companies often US-listed (ASML, ESTC)
    IE: ['.de', '.uk', '.us'], // Irish ETFs on XETRA or LSE
    GB: ['.uk', '.us'],
    KY: ['.hk', '.us'],
    HK: ['.hk'],
    FR: ['.fr', '.us'],
    CH: ['.ch', '.us'],
};

/** All known Stooq exchange suffixes to try as last resort */
const ALL_STOOQ_SUFFIXES = ['.us', '.de', '.uk', '.hk', '.nl', '.fr', '.ch'];

/** Stooq suffix → currency */
const STOOQ_SUFFIX_CURRENCY: Record<string, string> = {
    '.us': 'USD',
    '.de': 'EUR',
    '.nl': 'EUR',
    '.uk': 'GBP',
    '.hk': 'HKD',
    '.fr': 'EUR',
    '.ch': 'CHF',
};

function normalizeForStooq(symbol: string): string {
    return symbol.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Get ordered list of Stooq tickers to try for a symbol + ISIN.
 * Returns most likely exchange first, based on ISIN country prefix.
 */
function getStooqCandidates(symbol: string, isin: string): string[] {
    const base = normalizeForStooq(symbol);
    const isinPrefix = (isin ?? '').substring(0, 2);
    const suffixes = ISIN_PREFIX_TO_STOOQ_SUFFIXES[isinPrefix] ?? ALL_STOOQ_SUFFIXES;

    return suffixes.map(s => `${base}${s}`);
}

/** Infer currency from Stooq ticker suffix */
function inferCurrency(stooqTicker: string): string {
    for (const [suffix, ccy] of Object.entries(STOOQ_SUFFIX_CURRENCY)) {
        if (stooqTicker.endsWith(suffix)) {
            return ccy;
        }
    }

    return 'USD';
}

/**
 * Fetch the closing price for a symbol on the last trading day of the given year.
 * Stooq CSV format: Date,Open,High,Low,Close,Volume
 */
async function fetchStooqPrice(
    stooqTicker: string,
    year: number,
    fetchFn: typeof fetch,
): Promise<{ price: number; currency: string; date: string } | null> {
    // Fetch last 2 weeks of the year to catch the last trading day
    const d1 = `${year}1215`;
    const d2 = `${year}1231`;
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqTicker)}&d1=${d1}&d2=${d2}&i=d`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const response = await fetchFn(url, { signal: controller.signal });

        clearTimeout(timeout);

        if (!response.ok) {
            return null;
        }

        const csv = await response.text();

        // Detect rate limiting — return special marker
        if (csv.includes('Exceeded') || csv.includes('limit')) {
            throw new Error('RATE_LIMITED');
        }

        const lines = csv.trim().split('\n');

        // First line is header: Date,Open,High,Low,Close,Volume
        if (lines.length < 2) {
            return null;
        }

        // Last data line = last trading day
        const lastLine = lines[lines.length - 1];
        const fields = lastLine.split(',');

        if (fields.length < 5) {
            return null;
        }

        const date = fields[0]; // YYYY-MM-DD
        const close = parseFloat(fields[4]);

        if (isNaN(close) || close <= 0) {
            return null;
        }

        return {
            price: close,
            currency: inferCurrency(stooqTicker),
            date,
        };
    } catch (e) {
        if (e instanceof Error && e.message === 'RATE_LIMITED') {
            throw e; // Propagate rate limit to caller
        }

        return null;
    }
}

/** ISIN prefix → Yahoo exchange suffix */
const ISIN_TO_YAHOO: Record<string, string> = {
    US: '',
    DE: '.DE',
    NL: '.AS',
    IE: '.L',
    GB: '.L',
    KY: '.HK',
    HK: '.HK',
    FR: '.PA',
    CH: '.SW',
};

/**
 * Fallback: fetch from Yahoo Finance v8 chart API.
 * Tries plain symbol first (US-listed), then with exchange suffix from ISIN.
 */
async function fetchYahooPrice(
    symbol: string,
    isin: string,
    year: number,
    fetchFn: typeof fetch,
): Promise<{ price: number; currency: string; date: string } | null> {
    const plain = symbol.replace(/\s+/g, '-');
    const prefix = (isin ?? '').substring(0, 2);
    const suffix = prefix ? (ISIN_TO_YAHOO[prefix] ?? '') : '';
    const candidates = suffix ? [plain, `${plain}${suffix}`] : [plain];

    for (const ticker of candidates) {
        const start = Math.floor(new Date(`${year}-12-15T00:00:00Z`).getTime() / 1000);
        const end = Math.floor(new Date(`${year + 1}-01-03T00:00:00Z`).getTime() / 1000);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
            + `?period1=${start}&period2=${end}&interval=1d`;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const response = await fetchFn(url, { signal: controller.signal });

            clearTimeout(timeout);

            if (response.status === 429) {
                throw new Error('YAHOO_RATE_LIMITED');
            }

            if (!response.ok) {
                continue;
            }

            const data = await response.json() as {
                chart?: {
                    result?: Array<{
                        meta?: { currency?: string };
                        timestamp?: number[];
                        indicators?: { quote?: Array<{ close?: (number | null)[] }> };
                    }>;
                };
            };
            const result = data.chart?.result?.[0];

            if (!result?.timestamp?.length) {
                continue;
            }

            const timestamps = result.timestamp;
            const closes = result.indicators?.quote?.[0]?.close ?? [];
            const currency = result.meta?.currency ?? 'USD';

            for (let i = timestamps.length - 1; i >= 0; i--) {
                const close = closes[i];

                if (close !== null && close !== undefined && close > 0) {
                    const d = new Date(timestamps[i] * 1000);

                    if (d.getFullYear() === year) {
                        return { price: close, currency, date: d.toISOString().substring(0, 10) };
                    }
                }
            }
        } catch (e) {
            if (e instanceof Error && e.message === 'YAHOO_RATE_LIMITED') {
                throw e;
            }
        }
    }

    return null;
}

/**
 * Fetch year-end prices for multiple securities via Stooq.
 * Tries multiple exchange suffixes per symbol based on ISIN country prefix.
 * Skips securities that already have prices (pass existingPrices to filter).
 */
export async function fetchYearEndPrices(
    securities: Array<{ symbol: string; isin: string; currency: string; alternativeSymbols?: string[] }>,
    year: number,
    fetchFn: typeof fetch = fetch,
    onProgress?: (done: number, total: number, symbol: string) => void,
    existingPrices?: Record<string, number>,
): Promise<YearEndPrice[]> {
    // Filter to only securities that don't already have prices and have a symbol to look up
    const toFetch = securities.filter(s => s.symbol && (!existingPrices || !existingPrices[s.isin]));

    const results: YearEndPrice[] = [];
    const tried = new Set<string>();
    const cache = new Map<string, { price: number; currency: string; date: string } | null>();
    let stooqRateLimited = false;
    let yahooRateLimited = false;

    const tryStooq = async (ticker: string) => {
        if (stooqRateLimited || tried.has(ticker)) {
            return cache.get(ticker) ?? null;
        }

        tried.add(ticker);

        try {
            const result = await fetchStooqPrice(ticker, year, fetchFn);

            cache.set(ticker, result);

            return result;
        } catch (e) {
            if (e instanceof Error && e.message === 'RATE_LIMITED') {
                stooqRateLimited = true;
            }

            return null;
        }
    };

    for (let i = 0; i < toFetch.length; i++) {
        const sec = toFetch[i];
        const source = stooqRateLimited && yahooRateLimited
            ? ' (rate limited)'
            : stooqRateLimited
            ? ' (Yahoo)'
            : '';

        onProgress?.(i, toFetch.length, `${sec.symbol}${source}`);

        // Both rate-limited — stop trying
        if (stooqRateLimited && yahooRateLimited) {
            break;
        }

        const allSymbols = [sec.symbol, ...(sec.alternativeSymbols ?? [])];
        let priceData: { price: number; currency: string; date: string } | null = null;

        // Try Stooq first
        if (!stooqRateLimited) {
            for (const sym of allSymbols) {
                if (priceData) {
                    break;
                }

                for (const ticker of getStooqCandidates(sym, sec.isin)) {
                    priceData = await tryStooq(ticker);

                    if (priceData) {
                        break;
                    }
                }
            }
        }

        // Fallback to Yahoo if Stooq failed
        if (!priceData && !yahooRateLimited) {
            try {
                priceData = await fetchYahooPrice(sec.symbol, sec.isin, year, fetchFn);
            } catch (e) {
                if (e instanceof Error && e.message === 'YAHOO_RATE_LIMITED') {
                    yahooRateLimited = true;
                }
            }
        }

        if (priceData) {
            results.push({
                symbol: sec.symbol,
                isin: sec.isin,
                price: priceData.price,
                currency: priceData.currency,
                date: priceData.date,
            });
        }

        // 2s delay between securities to avoid rate limiting
        if (i < toFetch.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    onProgress?.(toFetch.length, toFetch.length, 'Done');

    return results;
}
