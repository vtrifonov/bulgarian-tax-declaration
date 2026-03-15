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
export async function fetchEcbRates(
    currency: string,
    startDate: string,
    endDate: string,
): Promise<Record<string, number>> {
    const url = new URL('https://data-api.ecb.europa.eu/service/data/EXR/');
    url.searchParams.set('detail', 'dataonly');
    url.searchParams.set('startPeriod', startDate);
    url.searchParams.set('endPeriod', endDate);
    url.searchParams.set('dimensions', `FREQ=D,CURRENCY=${currency}`);
    url.searchParams.set('format', 'sdmx-xml');

    const resp = await fetch(url.toString());
    if (!resp.ok) {
        throw new Error(`ECB API error ${resp.status}`);
    }

    const xml = await resp.text();
    const rates: Record<string, number> = {};

    // Parse XML: look for <generic:Obs> elements
    // ECB XML has ObsDimension value="YYYY-MM-DD" and ObsValue value="X.XXXX"
    const obsRegex = /<generic:Obs><generic:ObsDimension value="([^"]+)"[^>]*><generic:ObsValue value="([^"]+)"/g;
    let match;
    while ((match = obsRegex.exec(xml)) !== null) {
        const date = match[1];
        const rate = parseFloat(match[2]);
        if (!isNaN(rate)) {
            rates[date] = rate;
        }
    }

    if (Object.keys(rates).length === 0) {
        throw new Error('No rates found in ECB response');
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
    const all: Record<string, number> = {};
    for (const [start, end] of quarters) {
        const rates = await fetchEcbRates(currency, start, end);
        Object.assign(all, rates);
    }
    return all;
}
