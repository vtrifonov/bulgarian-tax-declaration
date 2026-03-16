export interface DataSource {
    type: 'Initial import' | 'IB' | 'Revolut' | 'Manual';
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
    source?: DataSource;
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
    fxRateBuy: number;
    fxRateSell: number;
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

export interface RevolutInterestEntry {
    date: string;
    description: string;
    amount: number;
}

export interface RevolutInterest {
    currency: string;
    entries: RevolutInterestEntry[];
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
    ibInterest: IBInterestEntry[];
    revolutInterest: RevolutInterest[];
    fxRates: Record<string, Record<string, number>>; // currency → date → rate
    manualEntries: ManualEntry[];
}

/** Validation warning — non-blocking */
export interface ValidationWarning {
    type: 'negative-holdings' | 'unmatched-wht' | 'missing-fx' | 'duplicate-holding' | 'year-mismatch' | 'incomplete-row';
    message: string;
    tab: string;
    rowId?: string;
    rowIndex?: number;
}

/** IB cash interest entry (SYEP interest, debit interest, etc.) */
export interface IBInterestEntry {
    currency: string;
    date: string;
    description: string;
    amount: number;
    source?: DataSource;
}

/** IB CSV raw parsed data before FIFO processing */
export interface IBParsedData {
    trades: IBTrade[];
    dividends: IBDividend[];
    withholdingTax: IBWithholdingTax[];
    stockYield: StockYieldEntry[];
    interest: IBInterestEntry[];
}

export interface IBTrade {
    currency: string;
    symbol: string;
    dateTime: string; // YYYY-MM-DD, HH:MM:SS
    quantity: number; // positive=buy, negative=sell
    price: number;
    proceeds: number;
    commission: number;
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
