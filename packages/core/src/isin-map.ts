/**
 * Hardcoded ISIN map for known symbols.
 * Seeded from SPB-8 specification reference table.
 */
export const ISIN_MAP: Record<string, string> = {
    '1810': 'KYG9830T1067',
    AAPL: 'US0378331005',
    AMD: 'US0079031078',
    AMZN: 'US0231351067',
    ASML: 'NL0010273215',
    AVGO: 'US11135F1012',
    BABA: 'US01609W1027',
    'BRK B': 'US0846707026',
    COIN: 'US19260Q1076',
    CSPX: 'IE00B5BMR087',
    DAL: 'US2473617023',
    ESTC: 'NL0013056914',
    ET: 'US29273V1008',
    GLDV: 'IE00B9CQXS71',
    GTLB: 'US37637K1088',
    GOOG: 'US02079K1079',
    ISPA: 'DE000A0F5UH1',
    ISPAd: 'DE000A0F5UH1',
    JGPI: 'IE0003UVYC20',
    LHA: 'DE0008232125',
    LHAd: 'DE0008232125',
    MDB: 'US60937P1066',
    META: 'US30303M1027',
    MSFT: 'US5949181045',
    NFLX: 'US64110L1061',
    NVDA: 'US67066G1040',
    PLTR: 'US69608A1088',
    PRGS: 'US7433121008',
    PYPL: 'US70450Y1038',
    QCOM: 'US7475251036',
    RIO: 'US7672041008',
    ROKU: 'US77543R1023',
    SAP: 'DE0007164600',
    SBUX: 'US8552441094',
    SXR8: 'IE00B5BMR087',
    TKWY: 'NL0012015705',
    TMV: 'DE000A2YN900',
    VCLT: 'US92206C8139',
    VHYL: 'IE00B8GKDB10',
    VWCE: 'IE00BK5BQT80',
    XOM: 'US30231G1022',
    ZPRG: 'IE00B9CQXS71',
};

const resolvedCache: Record<string, string> = {};

/** ISIN format: 2 uppercase letters + 9 alphanumeric + 1 digit */
const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Validate ISIN format (does not check the check digit algorithm) */
export function validateIsin(isin: string): boolean {
    return ISIN_REGEX.test(isin);
}

/** Sync lookup — hardcoded map + cache from previous async calls */
export function resolveIsinSync(symbol: string): string {
    return ISIN_MAP[symbol] ?? resolvedCache[symbol] ?? '';
}

/** Store ISIN in cache (called after parser extraction or async resolution) */
export function cacheIsin(symbol: string, isin: string): void {
    if (isin && validateIsin(isin)) {
        resolvedCache[symbol] = isin;
    }
}

/** Batch resolve ISINs from a parser-provided map (e.g., IB Financial Instrument Info) */
export function cacheIsinsFromMap(isinMap: Record<string, string>): void {
    for (const [symbol, isin] of Object.entries(isinMap)) {
        cacheIsin(symbol, isin);
    }
}
