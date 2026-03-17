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

/** OpenFIGI exchange code → Bulgarian country name */
export const EXCHANGE_COUNTRY: Record<string, string> = {
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

/** Batch async — resolves all at once via hardcoded map + OpenFIGI fallback */
export async function resolveCountries(
    symbols: { symbol: string; currency: string }[],
): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    // 1. Deduplicate
    const unique = new Map<string, { symbol: string; currency: string }>();

    for (const s of symbols) {
        if (!unique.has(s.symbol)) {
            unique.set(s.symbol, s);
        }
    }

    // 2. Check hardcoded map + cache, collect unknowns
    const unknowns: { symbol: string; currency: string }[] = [];

    for (const [symbol, entry] of unique) {
        const known = COUNTRY_MAP[symbol] ?? resolvedCache[symbol];

        if (known) {
            result[symbol] = known;
        } else {
            unknowns.push(entry);
        }
    }

    // 3. If unknowns exist, batch call OpenFIGI
    if (unknowns.length > 0) {
        const resolved = await fetchOpenFigi(unknowns);

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
): Promise<Record<string, string>> {
    // Initialize all results with empty strings (fallback for errors)
    const result: Record<string, string> = {};
    for (const s of symbols) {
        result[s.symbol] = '';
    }

    try {
        const body = symbols.map(s => ({
            idType: 'TICKER',
            idValue: s.symbol,
            currency: s.currency,
        }));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('https://api.openfigi.com/v3/mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return result;
        }

        const data = await response.json() as Array<{ data?: Array<{ exchCode?: string }>; error?: string }>;

        for (let i = 0; i < symbols.length && i < data.length; i++) {
            const entry = data[i];
            const exchCode = entry.data?.[0]?.exchCode;
            const country = exchCode ? (EXCHANGE_COUNTRY[exchCode] ?? '') : '';

            result[symbols[i].symbol] = country;
        }
    } catch {
        // Network error, timeout, etc. — result already initialized with empty strings
    }

    return result;
}
