export interface DataSource {
    type: string;
    file?: string;
}

export interface Holding {
    id: string;
    broker: string;
    country: string;
    symbol: string;
    dateAcquired: string; // YYYY-MM-DD
    quantity: number;
    currency: string;
    unitPrice: number;
    notes?: string;
    isin?: string;
    source?: DataSource;
    /** Marked true when FIFO matching fully consumed this lot */
    consumedByFifo?: boolean;
    /** IDs of the sale(s) that consumed this lot */
    consumedBySaleIds?: string[];
}

export interface Sale {
    id: string;
    broker: string;
    country: string;
    symbol: string;
    dateAcquired: string;
    dateSold: string;
    quantity: number;
    currency: string;
    buyPrice: number;
    sellPrice: number;
    fxRateBuy: number | null;
    fxRateSell: number | null;
    source?: DataSource;
}

export interface Dividend {
    symbol: string;
    country: string;
    date: string;
    currency: string;
    grossAmount: number;
    withholdingTax: number;
    bgTaxDue: number;
    whtCredit: number;
    notes?: string;
    source?: DataSource;
}

export interface StockYieldEntry {
    date: string;
    symbol: string;
    currency: string;
    amount: number;
    source?: DataSource;
}

export interface BrokerInterest {
    broker: string;
    currency: string;
    entries: InterestEntry[];
}

export interface ManualEntry {
    id: string;
    type: 'holding' | 'sale' | 'dividend';
    data: Holding | Sale | Dividend;
}

export type BaseCurrency = 'BGN' | 'EUR';
export type Language = 'en' | 'bg';

export interface AppState {
    taxYear: number;
    baseCurrency: BaseCurrency;
    language: Language;
    holdings: Holding[];
    sales: Sale[];
    dividends: Dividend[];
    stockYield: StockYieldEntry[];
    brokerInterest: BrokerInterest[];
    fxRates: Record<string, Record<string, number>>; // currency → date → rate
    manualEntries: ManualEntry[];
    foreignAccounts?: ForeignAccountBalance[];
    spb8PersonalData?: Spb8PersonalData;
}

/** Validation warning — non-blocking */
export interface ValidationWarning {
    type: 'negative-holdings' | 'unmatched-wht' | 'missing-fx' | 'duplicate-holding' | 'year-mismatch' | 'incomplete-row';
    message: string;
    tab: string;
    rowId?: string;
    rowIndex?: number;
}

/** Broker interest entry (IB SYEP/debit interest, Revolut savings interest, etc.) */
export interface InterestEntry {
    currency: string;
    date: string;
    description: string;
    amount: number;
    source?: DataSource;
}

/** IB CSV raw parsed data before FIFO processing */
export interface IBOpenPosition {
    symbol: string;
    currency: string;
    quantity: number;
    costPrice: number;
}

export interface IBParsedData {
    trades: Trade[];
    dividends: IBDividend[];
    withholdingTax: IBWithholdingTax[];
    stockYield: StockYieldEntry[];
    interest: InterestEntry[];
    openPositions: IBOpenPosition[];
    /** Maps every symbol alias to the primary symbol used in Open Positions */
    symbolAliases: Record<string, string>;
    /** Maps primary symbol → listing exchange (e.g. "NASDAQ", "IBIS", "SEHK") */
    symbolExchanges: Record<string, string>;
    brokerName?: string;
    cashBalances?: { currency: string; amountStartOfYear: number; amountEndOfYear: number }[];
    isinMap?: Record<string, string>;
}

export interface Trade {
    currency: string;
    symbol: string;
    dateTime: string; // YYYY-MM-DD, HH:MM:SS
    quantity: number; // positive=buy, negative=sell
    price: number;
    proceeds: number;
    commission: number;
    basis?: number; // IB's total cost basis for the position
}

export interface IBDividend {
    currency: string;
    date: string;
    symbol: string;
    description: string;
    amount: number;
}

export interface IBWithholdingTax {
    currency: string;
    date: string;
    symbol: string;
    description: string;
    amount: number; // negative = tax paid
}

/** Foreign account balance for SPB-8 Section 03 */
export interface ForeignAccountBalance {
    broker: string;
    type: '01' | '02' | '03';
    maturity: 'L' | 'S';
    country: string;
    currency: string;
    amountStartOfYear: number;
    amountEndOfYear: number;
    /** Computed: end-of-year value in BGN (for threshold display, not exported) */
    amountEndOfYearBgn?: number;
}

/** Securities holding snapshot for SPB-8 Section 04 */
export interface Spb8Security {
    isin: string;
    currency: string;
    quantityStartOfYear: number;
    quantityEndOfYear: number;
    /** Market price per unit at year-end (user-provided for threshold calculation) */
    priceEndOfYear?: number;
    /** Computed: end-of-year value in base currency (for threshold display, not exported) */
    amountEndOfYearBgn?: number;
}

/** Personal data for SPB-8 Section 1 (all optional) */
export interface Spb8PersonalData {
    name?: string;
    egn?: string;
    address?: {
        city?: string;
        postalCode?: string;
        district?: string;
        street?: string;
        number?: string;
        entrance?: string;
    };
    phone?: string;
    email?: string;
}

/** Complete SPB-8 form data (computed, not stored) */
export interface Spb8FormData {
    year: number;
    reportType: 'P' | 'R';
    personalData: Spb8PersonalData;
    accounts: ForeignAccountBalance[];
    securities: Spb8Security[];
    thresholdMet: boolean;
    totalBgn: number;
}

/** Parse error — non-fatal, collected alongside parsed data */
export interface ParseError {
    line: number;
    message: string;
    severity: 'warning' | 'error';
}

/** Parser result — always returns data + errors (never throws) */
export interface ParseResult<T> {
    data: T;
    errors: ParseError[];
}
