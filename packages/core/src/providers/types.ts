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

export interface TextFileHandler {
    id: string;
    kind: 'text';
    detectFile(content: string, filename: string): boolean;
    parseFile(content: string): BrokerProviderResult;
}

export interface BinaryFileHandler {
    id: string;
    kind: 'binary';
    detectBinary(buffer: ArrayBuffer, filename: string): boolean;
    parseBinary(buffer: ArrayBuffer): Promise<BrokerProviderResult>;
}

export type FileHandler = TextFileHandler | BinaryFileHandler;

export function isTextHandler(h: FileHandler): h is TextFileHandler {
    return h.kind === 'text';
}

export function isBinaryHandler(h: FileHandler): h is BinaryFileHandler {
    return h.kind === 'binary';
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
