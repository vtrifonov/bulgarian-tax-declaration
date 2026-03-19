import type {
    BrokerInterest,
    Dividend,
    ForeignAccountBalance,
    IBOpenPosition,
    InterestEntry,
    StockYieldEntry,
    Trade,
} from '../types/index.js';

export interface BrokerProviderResult {
    trades?: Trade[];
    dividends?: Dividend[];
    interest?: InterestEntry[];
    stockYield?: StockYieldEntry[];
    savingsInterest?: BrokerInterest;
    openPositions?: IBOpenPosition[];
    warnings?: string[];
    foreignAccounts?: ForeignAccountBalance[];
    isinMap?: Record<string, string>;
}

export interface FileHandler {
    id: string;
    detectFile(content: string, filename: string): boolean;
    parseFile(content: string): BrokerProviderResult;
}

export interface ExportInstruction {
    label: string;
    steps: string[];
}

export interface BrokerProvider {
    name: string;
    fileHandlers: FileHandler[];
    exportInstructions: ExportInstruction[];
}
