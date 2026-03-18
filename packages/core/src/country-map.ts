/**
 * Hardcoded symbol → country map for fast sync resolution.
 * Add entries here for symbols that OpenFIGI can't resolve correctly
 * (e.g. ETFs where listing exchange ≠ domicile country).
 * Example: CSPX: 'Ирландия' — listed on London but domiciled in Ireland.
 *
 * For most stocks, leave empty and rely on the OpenFIGI API fallback
 * which resolves via exchange code → country mapping.
 */
const COUNTRY_MAP: Record<string, string> = {};

/** Provider listing exchange → Bulgarian country name.
 *  Supports both OpenFIGI codes (US, GY, LN...) and IB exchange names (NASDAQ, IBIS, SEHK...).
 *  Any broker/provider can contribute exchange→country mappings here. */
export const EXCHANGE_COUNTRY: Record<string, string> = {
    // IB exchange names
    NASDAQ: 'САЩ',
    NYSE: 'САЩ',
    AMEX: 'САЩ',
    ARCA: 'САЩ',
    BATS: 'САЩ',
    AEB: 'Нидерландия (Холандия)',
    IBIS: 'Германия',
    IBIS2: 'Германия',
    FWB: 'Германия',
    FWB2: 'Германия',
    SBF: 'Франция',
    SEHK: 'Хонконг',
    LSE: 'Великобритания',
    LSEETF: 'Великобритания',
    BM: 'Испания',
    BVME: 'Италия',
    'BVME.ETF': 'Италия',
    SIX: 'Швейцария',
    TSE: 'Япония',
    ASX: 'Австралия',
    ISE: 'Ирландия',
    KSE: 'Южна Корея',
    MOEX: 'Русия',
    OMXS: 'Швеция',
    CSE: 'Дания',
    OSE: 'Норвегия',
    WSE: 'Полша',
    // OpenFIGI exchange codes
    US: 'САЩ',
    UA: 'САЩ',
    UN: 'САЩ',
    UB: 'САЩ',
    UC: 'САЩ',
    UM: 'САЩ',
    UP: 'САЩ',
    NA: 'Нидерландия (Холандия)',
    GY: 'Германия',
    GR: 'Германия',
    GF: 'Германия',
    GD: 'Германия',
    GS: 'Германия',
    GM: 'Германия',
    GI: 'Германия',
    GH: 'Германия',
    GT: 'Германия',
    GZ: 'Германия',
    TH: 'Германия',
    QT: 'Германия',
    LA: 'Италия',
    LU: 'Люксембург',
    LN: 'Великобритания',
    HK: 'Хонконг',
    H1: 'Хонконг',
    H2: 'Хонконг',
    FP: 'Франция',
    IM: 'Италия',
    SM: 'Испания',
    SJ: 'Швейцария',
    AU: 'Австралия',
    JT: 'Япония',
    ID: 'Ирландия',
    SS: 'Швеция',
    DC: 'Дания',
    NO: 'Норвегия',
    PL: 'Полша',
};

/** Runtime cache for resolved symbols (persists for session) */
const resolvedCache: Record<string, string> = {};

/** Sync — checks hardcoded map only (for tests, non-async contexts) */
export function resolveCountrySync(symbol: string): string {
    return COUNTRY_MAP[symbol] ?? resolvedCache[symbol] ?? '';
}

/** Sync — alias for resolveCountrySync (backwards compatible) */
export function resolveCountry(symbol: string): string {
    return resolveCountrySync(symbol);
}

/** Batch async — resolves all at once via hardcoded map + OpenFIGI fallback.
 *  Pass a custom `fetchFn` to bypass CORS (e.g. Tauri HTTP plugin's fetch). */
export async function resolveCountries(
    symbols: { symbol: string; currency: string }[],
    fetchFn: typeof fetch = fetch,
    /** Provider-supplied symbol → exchange mapping (e.g. from IB's Financial Instrument Info) */
    symbolExchanges: Record<string, string> = {},
): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    // 1. Deduplicate
    const unique = new Map<string, { symbol: string; currency: string }>();

    for (const s of symbols) {
        if (!unique.has(s.symbol)) {
            unique.set(s.symbol, s);
        }
    }

    // 2. Check hardcoded map + cache + provider exchanges, collect unknowns
    const unknowns: { symbol: string; currency: string }[] = [];

    for (const [symbol, entry] of unique) {
        const known = COUNTRY_MAP[symbol] ?? resolvedCache[symbol];

        if (known) {
            result[symbol] = known;
            continue;
        }

        // Try provider-supplied exchange mapping
        const exchange = symbolExchanges[symbol];
        const fromExchange = exchange ? (EXCHANGE_COUNTRY[exchange] ?? '') : '';

        if (fromExchange) {
            result[symbol] = fromExchange;
            resolvedCache[symbol] = fromExchange;
        } else {
            unknowns.push(entry);
        }
    }

    // 3. If unknowns exist, batch call OpenFIGI
    if (unknowns.length > 0) {
        const resolved = await fetchOpenFigi(unknowns, fetchFn);

        for (const [symbol, country] of Object.entries(resolved)) {
            result[symbol] = country;

            if (country) {
                resolvedCache[symbol] = country;
            }
        }

        // Ensure every symbol has at least an empty string
        for (const u of unknowns) {
            if (!(u.symbol in result)) {
                result[u.symbol] = '';
            }
        }
    }

    return result;
}

/** Call OpenFIGI API to resolve symbols to countries (max 100 per batch) */
async function fetchOpenFigi(
    symbols: { symbol: string; currency: string }[],
    fetchFn: typeof fetch = fetch,
): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const s of symbols) {
        result[s.symbol] = '';
    }

    // OpenFIGI anonymous limit: 10 items per request
    const BATCH_SIZE = 10;

    for (let start = 0; start < symbols.length; start += BATCH_SIZE) {
        const batch = symbols.slice(start, start + BATCH_SIZE);

        try {
            const body = batch.map(s => ({
                idType: 'TICKER',
                idValue: s.symbol,
                currency: s.currency,
            }));

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetchFn('https://api.openfigi.com/v3/mapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!response.ok) {
                continue;
            }

            const data = await response.json() as Array<{ data?: Array<{ exchCode?: string }>; error?: string }>;

            for (let i = 0; i < batch.length && i < data.length; i++) {
                const entry = data[i];
                const exchCode = entry.data?.[0]?.exchCode;
                const country = exchCode ? (EXCHANGE_COUNTRY[exchCode] ?? '') : '';

                result[batch[i].symbol] = country;
            }
        } catch {
            // Network error, timeout — continue with next batch
        }
    }

    return result;
}
