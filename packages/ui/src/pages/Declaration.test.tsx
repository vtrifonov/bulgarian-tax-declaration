import {
    render,
    screen,
} from '@testing-library/react';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { Declaration } from './Declaration';

const mockStore = {
    holdings: [],
    sales: [
        {
            id: 'sale-1',
            broker: 'Revolut',
            country: 'Нидерландия',
            symbol: 'ASML',
            exchange: 'XAMS',
            saleTaxClassification: 'taxable' as 'taxable' | 'eu-regulated-market',
            dateAcquired: '2024-01-10',
            dateSold: '2025-02-10',
            quantity: 1,
            currency: 'EUR',
            buyPrice: 100,
            sellPrice: 120,
            fxRateBuy: 1.95583,
            fxRateSell: 1.95583,
        },
    ],
    dividends: [],
    stockYield: [],
    brokerInterest: [],
    fxRates: {},
    baseCurrency: 'BGN' as const,
    taxYear: 2025,
    foreignAccounts: [],
    savingsSecurities: [],
    spb8PersonalData: {},
    yearEndPrices: {},
    tableSorting: {},
};

vi.mock('../store/app-state', () => ({
    applySorting: <T,>(items: T[]) => items,
    useAppStore: Object.assign(
        (selector?: (state: typeof mockStore) => unknown) => selector ? selector(mockStore) : mockStore,
        { getState: () => mockStore },
    ),
}));

vi.mock('../hooks/useNraFiller.js', () => ({
    useNraFiller: () => ({
        status: 'idle',
        rowCount: 0,
        canUseBrowser: false,
        script: '',
        error: '',
        startFilling: vi.fn(),
        startBrowser: vi.fn(),
    }),
}));

vi.mock('@bg-tax/core', () => ({
    calcDividendRowTax: vi.fn(() => ({
        grossBase: 0,
        whtBase: 0,
        tax5pct: 0,
        bgTaxDue: 0,
    })),
    generateExcel: vi.fn(),
    generateNraAppendix8: vi.fn(),
    isEuRegulatedSale: vi.fn((sale: { saleTaxClassification?: string }) => sale.saleTaxClassification === 'eu-regulated-market'),
    t: vi.fn((key: string) => key),
    TaxCalculator: vi.fn(() => ({
        calcCapitalGains: vi.fn(() => ({ taxDue: 0 })),
        calcDividendsTax: vi.fn(() => ({ totalBgTax: 0 })),
    })),
    toBaseCurrency: vi.fn((amount: number) => amount),
}));

describe('Declaration', () => {
    beforeEach(() => {
        mockStore.sales = [{
            ...mockStore.sales[0],
            saleTaxClassification: 'taxable',
        }];
    });

    it('moves a sale between Appendix 5 and Appendix 13 when classification changes', () => {
        const { rerender } = render(<Declaration />);

        expect(screen.getByText('Приложение 5, Таблица 2')).toBeTruthy();
        expect(screen.queryByText('Приложение 13')).toBeNull();

        mockStore.sales = [{
            ...mockStore.sales[0],
            saleTaxClassification: 'eu-regulated-market',
        }];
        rerender(<Declaration />);

        expect(screen.queryByText('Приложение 5, Таблица 2')).toBeNull();
        expect(screen.getByText('Приложение 13')).toBeTruthy();
        expect(screen.getByText('ASML')).toBeTruthy();
    });
});
