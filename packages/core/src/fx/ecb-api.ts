/**
 * Fetches FX rates from European Central Bank API.
 * ECB endpoint: https://data-api.ecb.europa.eu/service/data/EXR/D.{CCY}.EUR.SP00.A
 * Returns XML with generic:Obs elements containing date and rate.
 * ECB rates are EUR-native: 1 EUR = X currency
 */

/**
 * Fetch daily FX rates from ECB for a date range.
 * @param currency - ISO 4217 currency code (e.g., 'USD', 'GBP')
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Record mapping date strings to rates
 */
class RetryableError extends Error {
    readonly retryable = true;
    constructor(message: string) {
        super(message);
        this.name = 'RetryableError';
    }
}

export async function fetchEcbRates(
    currency: string,
    startDate: string,
    endDate: string,
): Promise<Record<string, number>> {
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new Error(`Invalid currency code: ${currency}`);
    }
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?startPeriod=${startDate}&endPeriod=${endDate}`;

    const maxRetries = 3;
    const timeoutMs = 15_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const resp = await fetch(url, { signal: controller.signal });

            if (resp.status === 429 || resp.status >= 500) {
                // Retryable server error — throw to trigger retry
                throw new RetryableError(`ECB API error ${resp.status}`);
            }

            if (!resp.ok) {
                // Client error (4xx) — don't retry
                throw new Error(`ECB API error ${resp.status}`);
            }

            const xml = await resp.text();

            return parseEcbXml(xml);
        } catch (err: unknown) {
            const isRetryable = err instanceof RetryableError
                || (err instanceof DOMException && err.name === 'AbortError');

            if (!isRetryable || attempt === maxRetries) {
                throw err;
            }
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(r => setTimeout(r, 1000 * (2 ** attempt)));
        } finally {
            clearTimeout(timer);
        }
    }

    throw new Error('ECB fetch failed after retries');
}

/** Parse ECB XML response — handles multi-line Obs elements */
export function parseEcbXml(xml: string): Record<string, number> {
    const rates: Record<string, number> = {};

    // Match ObsDimension and ObsValue which may be on separate lines
    // Pattern: <generic:ObsDimension value="DATE"/>  ...  <generic:ObsValue value="RATE"/>
    const obsBlocks = xml.split('<generic:Obs>');

    for (const block of obsBlocks) {
        const dateMatch = block.match(/<generic:ObsDimension\s+value="([^"]+)"/);
        const rateMatch = block.match(/<generic:ObsValue\s+value="([^"]+)"/);

        if (dateMatch && rateMatch) {
            const rate = parseFloat(rateMatch[1]);

            if (!isNaN(rate)) {
                rates[dateMatch[1]] = rate;
            }
        }
    }

    return rates;
}

/**
 * Fetch yearly rates from ECB in quarterly chunks (ECB has 3-month limit).
 * Makes 4 requests per currency per year and combines results.
 */
export async function fetchYearRates(
    currency: string,
    year: number,
): Promise<Record<string, number>> {
    const quarters = [
        [`${year}-01-01`, `${year}-03-31`],
        [`${year}-04-01`, `${year}-06-30`],
        [`${year}-07-01`, `${year}-09-30`],
        [`${year}-10-01`, `${year}-12-31`],
    ];
    // Fetch all 4 quarters in parallel
    const results = await Promise.allSettled(
        quarters.map(([start, end]) => fetchEcbRates(currency, start, end)),
    );
    const all: Record<string, number> = {};

    for (const result of results) {
        if (result.status === 'fulfilled') {
            Object.assign(all, result.value);
        }
    }

    return all;
}
