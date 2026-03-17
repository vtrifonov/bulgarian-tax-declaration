import { create } from 'zustand';
import type {
    BrokerInterest,
    Dividend,
    Holding,
    Sale,
    StockYieldEntry,
} from '@bg-tax/core';

export interface ImportedFile {
    name: string;
    type: 'ib' | 'revolut' | 'revolut-investments';
    status: 'success' | 'error';
    message: string;
}

export interface AppState {
    // Settings
    taxYear: number;
    baseCurrency: 'BGN' | 'EUR';
    language: 'en' | 'bg';

    // Data
    holdings: Holding[];
    sales: Sale[];
    dividends: Dividend[];
    stockYield: StockYieldEntry[];
    brokerInterest: BrokerInterest[];
    fxRates: Record<string, Record<string, number>>; // currency → date → rate
    importedFiles: ImportedFile[];

    // Actions
    setTaxYear: (year: number) => void;
    setBaseCurrency: (currency: 'BGN' | 'EUR') => void;
    setLanguage: (lang: 'en' | 'bg') => void;

    // Holdings
    addHolding: (holding: Holding) => void;
    updateHolding: (index: number, holding: Holding) => void;
    deleteHolding: (index: number) => void;
    importHoldings: (holdings: Holding[]) => void;

    // Sales
    addSale: (sale: Sale) => void;
    updateSale: (index: number, sale: Sale) => void;
    deleteSale: (index: number) => void;
    importSales: (sales: Sale[]) => void;

    // Dividends
    addDividend: (dividend: Dividend) => void;
    updateDividend: (index: number, dividend: Dividend) => void;
    deleteDividend: (index: number) => void;
    importDividends: (dividends: Dividend[]) => void;

    // Stock Yield
    addStockYield: (item: StockYieldEntry) => void;
    updateStockYield: (index: number, item: StockYieldEntry) => void;
    deleteStockYield: (index: number) => void;
    importStockYield: (items: StockYieldEntry[]) => void;

    // Broker Interest
    addBrokerInterest: (interest: BrokerInterest) => void;
    updateBrokerInterest: (index: number, interest: BrokerInterest) => void;
    deleteBrokerInterest: (index: number) => void;
    importBrokerInterest: (interests: BrokerInterest[]) => void;

    // FX Rates
    setFxRates: (rates: Record<string, Record<string, number>>) => void;

    // Imported files log
    addImportedFile: (file: ImportedFile) => void;
    clearImportedFiles: () => void;

    // Reset
    reset: () => void;
}

const initialState = {
    taxYear: new Date().getFullYear() - 1,
    baseCurrency: (new Date().getFullYear() - 1) <= 2025 ? ('BGN' as const) : ('EUR' as const),
    language: 'bg' as const,
    holdings: [] as Holding[],
    sales: [] as Sale[],
    dividends: [] as Dividend[],
    stockYield: [] as StockYieldEntry[],
    brokerInterest: [] as BrokerInterest[],
    fxRates: {} as Record<string, Record<string, number>>,
    importedFiles: [] as ImportedFile[],
};

export const useAppStore = create<AppState>((set) => ({
    ...initialState,

    setTaxYear: (year: number) => set({ taxYear: year, baseCurrency: year <= 2025 ? 'BGN' : 'EUR' }),
    setBaseCurrency: (currency: 'BGN' | 'EUR') => set({ baseCurrency: currency }),
    setLanguage: (lang: 'en' | 'bg') => set({ language: lang }),

    addHolding: (holding: Holding) => set((state) => ({ holdings: [...state.holdings, holding] })),
    updateHolding: (index: number, holding: Holding) =>
        set((state) => {
            const holdings = [...state.holdings];
            holdings[index] = holding;
            return { holdings };
        }),
    deleteHolding: (index: number) =>
        set((state) => ({
            holdings: state.holdings.filter((_, i) => i !== index),
        })),
    importHoldings: (holdings: Holding[]) => set({ holdings }),

    addSale: (sale: Sale) => set((state) => ({ sales: [...state.sales, sale] })),
    updateSale: (index: number, sale: Sale) =>
        set((state) => {
            const sales = [...state.sales];
            sales[index] = sale;
            return { sales };
        }),
    deleteSale: (index: number) =>
        set((state) => ({
            sales: state.sales.filter((_, i) => i !== index),
        })),
    importSales: (sales: Sale[]) => set({ sales }),

    addDividend: (dividend: Dividend) => set((state) => ({ dividends: [...state.dividends, dividend] })),
    updateDividend: (index: number, dividend: Dividend) =>
        set((state) => {
            const dividends = [...state.dividends];
            dividends[index] = dividend;
            return { dividends };
        }),
    deleteDividend: (index: number) =>
        set((state) => ({
            dividends: state.dividends.filter((_, i) => i !== index),
        })),
    importDividends: (dividends: Dividend[]) => set({ dividends }),

    addStockYield: (item: StockYieldEntry) => set((state) => ({ stockYield: [...state.stockYield, item] })),
    updateStockYield: (index: number, item: StockYieldEntry) =>
        set((state) => {
            const stockYield = [...state.stockYield];
            stockYield[index] = item;
            return { stockYield };
        }),
    deleteStockYield: (index: number) =>
        set((state) => ({
            stockYield: state.stockYield.filter((_, i) => i !== index),
        })),
    importStockYield: (items: StockYieldEntry[]) => set({ stockYield: items }),

    addBrokerInterest: (interest: BrokerInterest) =>
        set((state) => ({
            brokerInterest: [...state.brokerInterest, interest],
        })),
    updateBrokerInterest: (index: number, interest: BrokerInterest) =>
        set((state) => {
            const brokerInterest = [...state.brokerInterest];
            brokerInterest[index] = interest;
            return { brokerInterest };
        }),
    deleteBrokerInterest: (index: number) =>
        set((state) => ({
            brokerInterest: state.brokerInterest.filter((_, i) => i !== index),
        })),
    importBrokerInterest: (interests: BrokerInterest[]) => set({ brokerInterest: interests }),

    setFxRates: (rates: Record<string, Record<string, number>>) =>
        set((state) => {
            const merged: Record<string, Record<string, number>> = { ...state.fxRates };
            for (const currency in rates) {
                merged[currency] = { ...merged[currency], ...rates[currency] };
            }
            return { fxRates: merged };
        }),

    addImportedFile: (file: ImportedFile) => set((state) => ({ importedFiles: [...state.importedFiles, file] })),
    clearImportedFiles: () => set({ importedFiles: [] }),

    reset: () => set(initialState),
}));
