import {
    useMemo,
    useState,
} from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
    t,
    validate,
} from '@bg-tax/core';
import { useAppStore } from '../store/app-state';
import { DataTable } from '../components/DataTable';
import type {
    Dividend,
    Holding,
    IBInterestEntry,
    RevolutInterest,
    RevolutInterestEntry,
    Sale,
    StockYieldEntry,
    ValidationWarning,
} from '@bg-tax/core';

type TabType = 'holdings' | 'sales' | 'dividends' | 'ibInterest' | 'revolutInterest' | 'fxRates';

// Helper to create an editable column definition
function createEditableColumn<T extends Record<string, any>>(
    accessorKey: keyof T,
    header: string,
    options?: {
        align?: 'left' | 'right' | 'center';
        format?: (value: any) => string;
        onSave?: (rowIndex: number, value: string) => void;
    },
): ColumnDef<T> {
    return {
        accessorKey: accessorKey as string,
        header,
        cell: (info) => {
            const formatted = options?.format ? options.format(info.getValue()) : String(info.getValue() ?? '');
            return formatted;
        },
        meta: {
            align: options?.align,
            editable: true,
            onSave: options?.onSave,
        },
    };
}

// Helper to convert amounts to base currency
function createToBaseCcy(fxRates: Record<string, Record<string, number>>, baseCurrency: 'BGN' | 'EUR') {
    return (amount: number, currency: string, date: string): string => {
        if (currency === baseCurrency) return amount.toFixed(2);
        if (currency === 'EUR' && baseCurrency === 'BGN') return (amount * 1.95583).toFixed(2);
        if (currency === 'BGN' && baseCurrency === 'EUR') return (amount / 1.95583).toFixed(2);
        const ecbRate = fxRates[currency]?.[date];
        if (!ecbRate) return '—';
        if (baseCurrency === 'EUR') return (amount / ecbRate).toFixed(2);
        return (amount * 1.95583 / ecbRate).toFixed(2);
    };
}

/** Display the FX rate for a currency on a date (handles EUR/BGN fixed rate) */
function getFxRateDisplay(fxRates: Record<string, Record<string, number>>, baseCurrency: 'BGN' | 'EUR', currency: string, date: string): string {
    if (currency === baseCurrency) return '1';
    if (currency === 'EUR' && baseCurrency === 'BGN') return '1.95583';
    if (currency === 'BGN' && baseCurrency === 'EUR') return (1 / 1.95583).toFixed(6);
    const ecbRate = fxRates[currency]?.[date];
    if (!ecbRate) return '—';
    // Show rate as "1 currency = X baseCurrency"
    if (baseCurrency === 'EUR') return (1 / ecbRate).toFixed(6);
    return (1.95583 / ecbRate).toFixed(6);
}

export function Workspace() {
    const [activeTab, setActiveTab] = useState<TabType>('holdings');
    const [fxTab, setFxTab] = useState<string | null>(null);
    const [revolutTab, setRevolutTab] = useState<string | null>(null);
    const [showWarnings, setShowWarnings] = useState(false);
    const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
    const [warningFilter, setWarningFilter] = useState<string>('all');

    const {
        holdings,
        sales,
        dividends,
        stockYield,
        ibInterest,
        revolutInterest,
        fxRates,
        baseCurrency,
        taxYear,
        language,
        updateHolding,
        deleteHolding,
        addHolding,
        updateSale,
        deleteSale,
        addSale,
        updateDividend,
        deleteDividend,
        addDividend,
        updateStockYield,
        deleteStockYield,
        addStockYield,
        updateIbInterest,
        deleteIbInterest,
        addIbInterest,
        updateRevolutInterest,
        deleteRevolutInterest,
        addRevolutInterest,
    } = useAppStore();

    // Compute validation warnings
    const warnings: ValidationWarning[] = useMemo(() => {
        const appState = {
            taxYear,
            baseCurrency,
            language,
            holdings,
            sales,
            dividends,
            stockYield,
            ibInterest,
            revolutInterest,
            fxRates,
            manualEntries: [],
        };
        return validate(appState);
    }, [taxYear, baseCurrency, language, holdings, sales, dividends, stockYield, ibInterest, revolutInterest, fxRates]);

    const getTabs = () => {
        // Count warnings per tab
        const warningsByTab = warnings.reduce(
            (acc, warning) => {
                const normalizedTab = warning.tab.toLowerCase();
                acc[normalizedTab] = (acc[normalizedTab] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>,
        );

        // Always show: Holdings, Sales, Dividends (user can fill manually)
        const tabs: { id: string; labelKey: string; count: number; warningCount: number; tooltip?: string }[] = [
            { id: 'holdings', labelKey: 'tab.holdings', count: holdings.length, warningCount: warningsByTab['holdings'] || 0 },
            { id: 'sales', labelKey: 'tab.sales', count: sales.length, warningCount: warningsByTab['sales'] || 0 },
            { id: 'dividends', labelKey: 'tab.dividends', count: dividends.length, warningCount: warningsByTab['dividends'] || 0 },
        ];
        // Show only if data exists (populated from IB/Revolut import)
        if (ibInterest.length > 0) {
            tabs.push({
                id: 'ibInterest',
                labelKey: 'tab.ibInterest',
                count: ibInterest.length,
                warningCount: warningsByTab['ib interest'] || 0,
                tooltip: 'IB interest income — securities lending (SYEP), cash deposits, debit interest',
            });
        }
        if (revolutInterest.length > 0) {
            tabs.push({ id: 'revolutInterest', labelKey: 'tab.revolutInterest', count: revolutInterest.length, warningCount: warningsByTab['revolut interest'] || 0 });
        }
        if (Object.keys(fxRates).length > 0) {
            tabs.push({ id: 'fxRates', labelKey: 'tab.fxRates', count: Object.keys(fxRates).length, warningCount: warningsByTab['fx rates'] || 0 });
        }
        return tabs;
    };

    // Holdings columns
    const holdingsColumns: ColumnDef<Holding>[] = [
        createEditableColumn<Holding>('broker', t('col.broker'), {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], broker: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('country', t('col.country'), {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], country: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('symbol', t('col.symbol'), {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], symbol: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('dateAcquired', t('col.dateAcquired'), {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], dateAcquired: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('quantity', t('col.quantity'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], quantity: parseFloat(value) || 0 };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('currency', t('col.currency'), {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], currency: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('unitPrice', t('col.unitPrice'), {
            align: 'right',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], unitPrice: parseFloat(value) || 0 };
                updateHolding(rowIndex, updated);
            },
        }),
        {
            id: 'totalCcy',
            header: t('col.totalCcy'),
            accessorFn: (row: Holding) => (row.quantity * row.unitPrice).toFixed(2),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'fxRate',
            header: t('col.fxRate'),
            accessorFn: (row: Holding) => getFxRateDisplay(fxRates, baseCurrency, row.currency, row.dateAcquired),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'totalBase',
            header: `${t('col.totalBase')} (${baseCurrency})`,
            accessorFn: (row: Holding) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.quantity * row.unitPrice, row.currency, row.dateAcquired);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        createEditableColumn<Holding>('notes', t('col.notes'), {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], notes: value };
                updateHolding(rowIndex, updated);
            },
        }),
        {
            id: 'delete',
            header: '',
            cell: ({ row }) => (
                <button
                    className='delete-button'
                    onClick={() => {
                        const index = holdings.indexOf(row.original);
                        if (index >= 0) deleteHolding(index);
                    }}
                >
                    {t('button.delete')}
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Sales columns
    const salesColumns: ColumnDef<Sale>[] = [
        createEditableColumn<Sale>('broker', t('col.broker'), {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], broker: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('country', t('col.country'), {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], country: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('symbol', t('col.symbol'), {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], symbol: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('dateAcquired', t('col.dateAcquired'), {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], dateAcquired: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('dateSold', t('col.dateSold'), {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], dateSold: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('quantity', t('col.qty'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], quantity: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('currency', t('col.currency'), {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], currency: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('buyPrice', t('col.buyPrice'), {
            align: 'right',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], buyPrice: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('sellPrice', t('col.sellPrice'), {
            align: 'right',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], sellPrice: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('fxRateBuy', t('col.fxRateBuy'), {
            align: 'right',
            format: (v) => (v as number).toFixed(6),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], fxRateBuy: parseFloat(value) || 1 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('fxRateSell', t('col.fxRateSell'), {
            align: 'right',
            format: (v) => (v as number).toFixed(6),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], fxRateSell: parseFloat(value) || 1 };
                updateSale(rowIndex, updated);
            },
        }),
        {
            id: 'proceedsBase',
            header: `${t('col.proceedsBase')} (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.quantity * row.sellPrice, row.currency, row.dateSold);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'costBase',
            header: `${t('col.costBase')} (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.quantity * row.buyPrice, row.currency, row.dateAcquired);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'plBase',
            header: `${t('col.plBase')} (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                const proceeds = parseFloat(toBaseCcy(row.quantity * row.sellPrice, row.currency, row.dateSold));
                const cost = parseFloat(toBaseCcy(row.quantity * row.buyPrice, row.currency, row.dateAcquired));
                if (isNaN(proceeds) || isNaN(cost)) return '—';
                return (proceeds - cost).toFixed(2);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: ({ row }) => (
                <button
                    className='delete-button'
                    onClick={() => {
                        const index = sales.indexOf(row.original);
                        if (index >= 0) deleteSale(index);
                    }}
                >
                    {t('button.delete')}
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Dividends columns
    const dividendsColumns: ColumnDef<Dividend>[] = [
        createEditableColumn<Dividend>('symbol', t('col.symbol'), {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], symbol: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('country', t('col.country'), {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], country: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('date', t('col.date'), {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], date: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('currency', t('col.currency'), {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], currency: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('grossAmount', t('col.grossAmount'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], grossAmount: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('withholdingTax', t('col.wht'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], withholdingTax: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        {
            id: 'fxRate',
            header: t('col.fxRate'),
            accessorFn: (row: Dividend) => getFxRateDisplay(fxRates, baseCurrency, row.currency, row.date),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'grossBase',
            header: `${t('col.grossBase')} (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.grossAmount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'whtBase',
            header: `${t('col.whtBase')} (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.withholdingTax, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'tax5pct',
            header: t('col.tax5pct'),
            accessorFn: (row: Dividend) => row.grossAmount * 0.05,
            cell: (info) => (info.getValue() as number).toFixed(2),
            meta: { align: 'right' as const, editable: false },
        },
        createEditableColumn<Dividend>('whtCredit', t('col.whtCredit'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], whtCredit: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('bgTaxDue', t('col.bgTaxDue'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], bgTaxDue: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('notes', t('col.notes'), {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], notes: value };
                updateDividend(rowIndex, updated);
            },
        }),
        {
            id: 'delete',
            header: '',
            cell: ({ row }) => (
                <button
                    className='delete-button'
                    onClick={() => {
                        const index = dividends.indexOf(row.original);
                        if (index >= 0) deleteDividend(index);
                    }}
                >
                    {t('button.delete')}
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // IB Interest columns
    const ibInterestColumns: ColumnDef<IBInterestEntry>[] = [
        createEditableColumn<IBInterestEntry>('date', t('col.date'), {
            onSave: (rowIndex, value) => {
                const updated = { ...ibInterest[rowIndex], date: value };
                updateIbInterest(rowIndex, updated);
            },
        }),
        createEditableColumn<IBInterestEntry>('currency', t('col.currency'), {
            onSave: (rowIndex, value) => {
                const updated = { ...ibInterest[rowIndex], currency: value };
                updateIbInterest(rowIndex, updated);
            },
        }),
        createEditableColumn<IBInterestEntry>('description', t('col.description'), {
            onSave: (rowIndex, value) => {
                const updated = { ...ibInterest[rowIndex], description: value };
                updateIbInterest(rowIndex, updated);
            },
        }),
        createEditableColumn<IBInterestEntry>('amount', t('col.amount'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...ibInterest[rowIndex], amount: parseFloat(value) || 0 };
                updateIbInterest(rowIndex, updated);
            },
        }),
        {
            id: 'fxRate',
            header: t('col.fxRate'),
            accessorFn: (row: IBInterestEntry) => {
                return getFxRateDisplay(fxRates, baseCurrency, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `${t('col.amountBase')} (${baseCurrency})`,
            accessorFn: (row: IBInterestEntry) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.amount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: ({ row }) => (
                <button
                    className='delete-button'
                    onClick={() => {
                        const index = ibInterest.indexOf(row.original);
                        if (index >= 0) deleteIbInterest(index);
                    }}
                >
                    {t('button.delete')}
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Stock Yield columns
    const stockYieldColumns: ColumnDef<StockYieldEntry>[] = [
        createEditableColumn<StockYieldEntry>('date', t('col.date'), {
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], date: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('symbol', t('col.symbol'), {
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], symbol: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('currency', t('col.currency'), {
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], currency: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('amount', t('col.amount'), {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], amount: parseFloat(value) || 0 };
                updateStockYield(rowIndex, updated);
            },
        }),
        {
            id: 'fxRate',
            header: t('col.fxRate'),
            accessorFn: (row: StockYieldEntry) => {
                return getFxRateDisplay(fxRates, baseCurrency, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `${t('col.amountBase')} (${baseCurrency})`,
            accessorFn: (row: StockYieldEntry) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.amount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: ({ row }) => (
                <button
                    className='delete-button'
                    onClick={() => {
                        const index = stockYield.indexOf(row.original);
                        if (index >= 0) deleteStockYield(index);
                    }}
                >
                    {t('button.delete')}
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Revolut Interest Entry columns
    const getRevolutEntryColumns = (currency: string): ColumnDef<RevolutInterestEntry>[] => [
        {
            accessorKey: 'date',
            header: t('col.date'),
            meta: { editable: true },
        },
        {
            accessorKey: 'description',
            header: t('col.description'),
            meta: { editable: true },
        },
        {
            accessorKey: 'amount',
            header: `${t('col.amountBase')} (${currency})`,
            meta: { align: 'right' as const, editable: true },
            cell: (info) => (info.getValue() as number).toFixed(4),
        },
        {
            id: 'fxRate',
            header: t('col.fxRate'),
            accessorFn: (row: RevolutInterestEntry) => getFxRateDisplay(fxRates, baseCurrency, currency, row.date),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `${t('col.amountBase')} (${baseCurrency})`,
            accessorFn: (row: RevolutInterestEntry) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.amount, currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
    ];

    const renderHoldingsContent = () => (
        <DataTable
            columns={holdingsColumns}
            data={holdings}
            onAddRow={() => {
                const newHolding: Holding = {
                    id: `holding-${Date.now()}`,
                    broker: '',
                    country: '',
                    symbol: '',
                    dateAcquired: new Date().toISOString().split('T')[0],
                    quantity: 0,
                    currency: 'USD',
                    unitPrice: 0,
                    notes: '',
                };
                addHolding(newHolding);
            }}
            addRowLabel={t('button.addHolding')}
        />
    );

    const renderSalesContent = () => (
        <DataTable
            columns={salesColumns}
            data={sales}
            onAddRow={() => {
                const newSale: Sale = {
                    id: `sale-${Date.now()}`,
                    broker: '',
                    country: '',
                    symbol: '',
                    dateAcquired: new Date().toISOString().split('T')[0],
                    dateSold: new Date().toISOString().split('T')[0],
                    quantity: 0,
                    currency: 'USD',
                    buyPrice: 0,
                    sellPrice: 0,
                    fxRateBuy: 1,
                    fxRateSell: 1,
                };
                addSale(newSale);
            }}
            addRowLabel={t('button.addSale')}
        />
    );

    const sortedDividends = [...dividends].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));

    // Build warning data for dividends table
    const [showDividendWarningsOnly, setShowDividendWarningsOnly] = useState(false);
    const dividendWarningRows = useMemo(() => {
        const divWarnings = warnings.filter(w => w.tab === 'Dividends' && w.rowIndex !== undefined);
        const rows = new Set<number>();
        const messages = new Map<number, string[]>();

        // Map original indices to sorted indices
        const originalToSorted = new Map<number, number>();
        sortedDividends.forEach((sd, sortedIdx) => {
            const origIdx = dividends.indexOf(sd);
            if (origIdx >= 0) originalToSorted.set(origIdx, sortedIdx);
        });

        for (const w of divWarnings) {
            const sortedIdx = originalToSorted.get(w.rowIndex!);
            if (sortedIdx !== undefined) {
                rows.add(sortedIdx);
                const msgs = messages.get(sortedIdx) ?? [];
                msgs.push(w.message);
                messages.set(sortedIdx, msgs);
            }
        }
        return { rows, messages };
    }, [warnings, sortedDividends, dividends]);

    const renderDividendsContent = () => (
        <DataTable
            columns={dividendsColumns}
            data={sortedDividends}
            warningRows={dividendWarningRows.rows}
            warningMessages={dividendWarningRows.messages}
            warningCount={dividendWarningRows.rows.size}
            showWarningsOnly={showDividendWarningsOnly}
            onToggleWarningsOnly={() => setShowDividendWarningsOnly(!showDividendWarningsOnly)}
            onAddRow={() => {
                const newDividend: Dividend = {
                    symbol: '',
                    country: '',
                    date: new Date().toISOString().split('T')[0],
                    currency: 'USD',
                    grossAmount: 0,
                    withholdingTax: 0,
                    bgTaxDue: 0,
                    whtCredit: 0,
                    notes: '',
                };
                addDividend(newDividend);
            }}
            addRowLabel={t('button.addDividend')}
        />
    );

    const renderStockYieldContent = () => (
        <DataTable
            columns={stockYieldColumns}
            data={stockYield}
            onAddRow={() => {
                const newEntry: StockYieldEntry = {
                    date: new Date().toISOString().split('T')[0],
                    symbol: '',
                    currency: 'USD',
                    amount: 0,
                };
                addStockYield(newEntry);
            }}
            addRowLabel='Add Stock Yield Entry'
        />
    );

    const renderIbInterestContent = () => (
        <DataTable
            columns={ibInterestColumns}
            data={ibInterest}
            onAddRow={() => {
                const newEntry: IBInterestEntry = {
                    date: new Date().toISOString().split('T')[0],
                    currency: 'USD',
                    description: '',
                    amount: 0,
                };
                addIbInterest(newEntry);
            }}
            addRowLabel={t('button.addInterest')}
        />
    );

    const renderRevolutInterestContent = () => {
        const currencies = revolutInterest.map((r) => r.currency).sort();

        if (currencies.length === 0) {
            return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No data</div>;
        }

        if (!revolutTab) {
            setRevolutTab('total');
        }

        const currentTab = revolutTab || 'total';
        const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
        const midDate = `${useAppStore.getState().taxYear}-06-30`;

        // Compute per-currency summaries for total tab
        const currencySummaries = currencies.map(ccy => {
            const data = revolutInterest.find(r => r.currency === ccy)!;
            const net = data.entries.reduce((sum, e) => sum + e.amount, 0);
            const netBaseStr = toBaseCcy(net, ccy, midDate);
            const netBaseNum = netBaseStr !== '—' ? parseFloat(netBaseStr) : 0;
            return { currency: ccy, entries: data.entries.length, net, netBase: netBaseNum, netBaseStr };
        });
        const totalEntries = currencySummaries.reduce((s, c) => s + c.entries, 0);
        const totalNetBase = currencySummaries.reduce((s, c) => s + c.netBase, 0);
        const totalTaxBase = totalNetBase * 0.1;

        const renderSummaryCard = (label: string, ccyLabel: string, net: number, netBase: string, tax: number, taxBase: string, entries: number) => (
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: '1rem',
                    marginBottom: '1rem',
                    padding: '1rem',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '4px',
                }}
            >
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.currency')}</div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{label}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.entries')}</div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{entries}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.netInterest')} ({ccyLabel})</div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{net.toFixed(2)}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.netInterest')} ({baseCurrency})</div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{netBase}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.tax10pct')} ({ccyLabel})</div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{tax.toFixed(2)}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.tax10pct')} ({baseCurrency})</div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{taxBase}</div>
                </div>
            </div>
        );

        const currentData = revolutInterest.find((r) => r.currency === currentTab);

        return (
            <div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button
                        onClick={() => setRevolutTab('total')}
                        style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: currentTab === 'total' ? 'var(--accent)' : 'var(--bg-secondary)',
                            color: currentTab === 'total' ? 'white' : 'var(--text)',
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontWeight: 600,
                        }}
                    >
                        {t('summary.total') || 'Total'}
                    </button>
                    {currencies.map((curr) => (
                        <button
                            key={curr}
                            onClick={() => setRevolutTab(curr)}
                            style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: currentTab === curr ? 'var(--accent)' : 'var(--bg-secondary)',
                                color: currentTab === curr ? 'white' : 'var(--text)',
                                border: 'none',
                                cursor: 'pointer',
                                borderRadius: '4px',
                            }}
                        >
                            {curr}
                        </button>
                    ))}
                </div>

                {currentTab === 'total'
                    ? (
                        <div>
                            {currencySummaries.map(s =>
                                renderSummaryCard(
                                    s.currency,
                                    s.currency,
                                    s.net,
                                    s.netBaseStr,
                                    s.net * 0.1,
                                    (s.netBase * 0.1).toFixed(2),
                                    s.entries,
                                )
                            )}
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(6, 1fr)',
                                    gap: '1rem',
                                    padding: '1rem',
                                    backgroundColor: 'var(--accent)',
                                    color: 'white',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                }}
                            >
                                <div>
                                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{t('summary.total') || 'Total'}</div>
                                    <div style={{ fontSize: '1.1rem' }}>{currencies.join(' + ')}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{t('summary.entries')}</div>
                                    <div style={{ fontSize: '1.1rem' }}>{totalEntries}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>&nbsp;</div>
                                    <div>&nbsp;</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{t('summary.netInterest')} ({baseCurrency})</div>
                                    <div style={{ fontSize: '1.1rem' }}>{totalNetBase.toFixed(2)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>&nbsp;</div>
                                    <div>&nbsp;</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{t('summary.tax10pct')} ({baseCurrency})</div>
                                    <div style={{ fontSize: '1.1rem' }}>{totalTaxBase.toFixed(2)}</div>
                                </div>
                            </div>
                        </div>
                    )
                    : currentData
                    ? (
                        <div>
                            {renderSummaryCard(
                                currentTab,
                                currentTab,
                                currentData.entries.reduce((s, e) => s + e.amount, 0),
                                toBaseCcy(currentData.entries.reduce((s, e) => s + e.amount, 0), currentTab, midDate),
                                currentData.entries.reduce((s, e) => s + e.amount, 0) * 0.1,
                                (() => {
                                    const nb = toBaseCcy(currentData.entries.reduce((s, e) => s + e.amount, 0), currentTab, midDate);
                                    return nb !== '—' ? (parseFloat(nb) * 0.1).toFixed(2) : '—';
                                })(),
                                currentData.entries.length,
                            )}
                            <DataTable columns={getRevolutEntryColumns(currentTab)} data={currentData.entries} />
                        </div>
                    )
                    : null}
            </div>
        );
    };

    const renderFxRatesContent = () => {
        const currencies = Object.keys(fxRates).sort();

        if (currencies.length === 0) {
            return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No FX rates</div>;
        }

        if (!fxTab) {
            setFxTab(currencies[0]);
        }

        const currentCurrency = fxTab || currencies[0];
        const ratesForCurrency = fxRates[currentCurrency] || {};
        const dateEntries = Object.entries(ratesForCurrency)
            .map(([date, rate]) => ({ date, rate }))
            .sort((a, b) => b.date.localeCompare(a.date));

        const ratesColumns: ColumnDef<{ date: string; rate: number }>[] = [
            {
                accessorKey: 'date',
                header: t('col.date'),
            },
            {
                accessorKey: 'rate',
                header: `Rate (to ${baseCurrency})`,
                cell: (info) => (info.getValue() as number).toFixed(6),
                meta: { align: 'right' },
            },
        ];

        return (
            <div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {currencies.map((curr) => (
                        <button
                            key={curr}
                            onClick={() => setFxTab(curr)}
                            style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: currentCurrency === curr ? 'var(--accent)' : 'var(--bg-secondary)',
                                color: currentCurrency === curr ? 'white' : 'var(--text)',
                                border: 'none',
                                cursor: 'pointer',
                                borderRadius: '4px',
                            }}
                        >
                            {curr} ({Object.keys(ratesForCurrency).length})
                        </button>
                    ))}
                </div>

                <DataTable columns={ratesColumns} data={dateEntries} />
            </div>
        );
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'holdings':
                return renderHoldingsContent();
            case 'sales':
                return renderSalesContent();
            case 'dividends':
                return renderDividendsContent();
            case 'ibInterest':
                return renderIbInterestContent();
            case 'revolutInterest':
                return renderRevolutInterestContent();
            case 'fxRates':
                return renderFxRatesContent();
            default:
                return null;
        }
    };

    const tabs = getTabs();

    return (
        <div style={{ padding: '2rem' }}>
            <h1>{t('page.workspace')}</h1>

            {/* Warnings Panel */}
            {warnings.length > 0 && (() => {
                const visibleWarnings = warnings.filter(w => {
                    const key = `${w.type}:${w.message}`;
                    if (dismissedWarnings.has(key)) return false;
                    if (warningFilter !== 'all' && w.type !== warningFilter) return false;
                    return true;
                });
                const warningTypes = [...new Set(warnings.map(w => w.type))];

                return (
                    <div
                        style={{
                            marginBottom: '2rem',
                            padding: '1rem',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                        }}
                    >
                        <div
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                            onClick={() => setShowWarnings(!showWarnings)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontWeight: 600 }}>
                                    {t('label.validationWarnings')} ({visibleWarnings.length}
                                    {dismissedWarnings.size > 0 ? ` / ${warnings.length} total` : ''})
                                </span>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {showWarnings ? '▼' : '▶'}
                                </span>
                            </div>
                            {dismissedWarnings.size > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDismissedWarnings(new Set());
                                    }}
                                    style={{
                                        fontSize: '0.8rem',
                                        color: 'var(--accent)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                    }}
                                >
                                    {t('button.showAll')}
                                </button>
                            )}
                        </div>
                        {showWarnings && (
                            <div style={{ marginTop: '1rem' }}>
                                {/* Filter buttons */}
                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                    <button
                                        onClick={() => setWarningFilter('all')}
                                        style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '12px',
                                            fontSize: '0.8rem',
                                            border: '1px solid var(--border)',
                                            cursor: 'pointer',
                                            backgroundColor: warningFilter === 'all' ? 'var(--accent)' : 'transparent',
                                            color: warningFilter === 'all' ? 'white' : 'var(--text-secondary)',
                                        }}
                                    >
                                        All ({visibleWarnings.length})
                                    </button>
                                    {warningTypes.map(type => {
                                        const count = warnings.filter(w => w.type === type && !dismissedWarnings.has(`${w.type}:${w.message}`)).length;
                                        return (
                                            <button
                                                key={type}
                                                onClick={() => setWarningFilter(warningFilter === type ? 'all' : type)}
                                                style={{
                                                    padding: '0.25rem 0.75rem',
                                                    borderRadius: '12px',
                                                    fontSize: '0.8rem',
                                                    border: '1px solid var(--border)',
                                                    cursor: 'pointer',
                                                    backgroundColor: warningFilter === type ? 'var(--accent)' : 'transparent',
                                                    color: warningFilter === type ? 'white' : 'var(--text-secondary)',
                                                }}
                                            >
                                                {type.replace(/-/g, ' ')} ({count})
                                            </button>
                                        );
                                    })}
                                </div>
                                {/* Warning list */}
                                {visibleWarnings.map((warning, idx) => (
                                    <div
                                        key={idx}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '0.5rem',
                                            fontSize: '0.9rem',
                                            color: 'var(--text-secondary)',
                                            padding: '0.4rem 0.5rem',
                                            borderRadius: '4px',
                                            backgroundColor: idx % 2 === 0 ? 'transparent' : 'var(--bg)',
                                        }}
                                    >
                                        <span>
                                            <strong>[{warning.tab}]</strong> {warning.message}
                                        </span>
                                        <button
                                            onClick={() => setDismissedWarnings(prev => new Set([...prev, `${warning.type}:${warning.message}`]))}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: 'var(--text-secondary)',
                                                fontSize: '1rem',
                                                padding: '0 0.25rem',
                                            }}
                                            title='Dismiss'
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                                {visibleWarnings.length === 0 && (
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                        {t('label.allDismissed')}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Tabs */}
            <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        title={tab.tooltip}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        style={{
                            marginRight: '1rem',
                            padding: '0.5rem 1rem',
                            backgroundColor: activeTab === tab.id ? 'var(--accent)' : 'var(--bg-secondary)',
                            color: activeTab === tab.id ? 'white' : 'var(--text)',
                            border: 'none',
                            cursor: 'pointer',
                            position: 'relative',
                        }}
                    >
                        {t(tab.labelKey)} ({tab.count})
                        {tab.warningCount > 0 && (
                            <span
                                style={{
                                    display: 'inline-block',
                                    marginLeft: '0.5rem',
                                    backgroundColor: '#ff6b6b',
                                    color: 'white',
                                    borderRadius: '50%',
                                    width: '20px',
                                    height: '20px',
                                    textAlign: 'center',
                                    fontSize: '0.75rem',
                                    lineHeight: '20px',
                                    fontWeight: 600,
                                }}
                            >
                                {tab.warningCount}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div>{renderContent()}</div>
        </div>
    );
}
