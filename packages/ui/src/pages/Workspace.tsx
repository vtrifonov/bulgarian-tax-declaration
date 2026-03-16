import {
    useMemo,
    useState,
} from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
    calcDividendRowTax,
    getFxRate,
    t,
    toBaseCurrencyStr,
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

/** Show up to 8 decimals, trimming trailing zeros */
function formatQuantity(n: number): string {
    if (n === 0) return '0';
    const s = n.toFixed(8);
    // Remove trailing zeros but keep at least 2 decimals
    const trimmed = s.replace(/0+$/, '');
    const dotIdx = trimmed.indexOf('.');
    if (dotIdx === -1) return trimmed;
    const decimals = trimmed.length - dotIdx - 1;
    return decimals < 2 ? n.toFixed(2) : trimmed;
}

// Helper to create an editable column definition
function createEditableColumn<T extends Record<string, any>>(
    accessorKey: keyof T,
    header: string,
    options?: {
        align?: 'left' | 'right' | 'center';
        format?: (value: any) => string;
        onSave?: (rowIndex: number, value: string) => void;
        inputType?: 'text' | 'number' | 'date' | 'select';
        selectOptions?: string[];
    },
): ColumnDef<T> {
    return {
        accessorKey: accessorKey as string,
        header,
        cell: (info) => {
            const raw = info.getValue();
            if (options?.format) return options.format(raw);
            // Format ISO dates as DD.MM.YYYY for display
            if (options?.inputType === 'date' && typeof raw === 'string') {
                const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (m) return `${m[3]}.${m[2]}.${m[1]}`;
            }
            return String(raw ?? '');
        },
        meta: {
            align: options?.align,
            editable: true,
            inputType: options?.inputType ?? 'text',
            selectOptions: options?.selectOptions,
            onSave: options?.onSave,
        },
    };
}

// Row number column — shows array position, sortable to restore import order
function createRowNumColumn<T>(): ColumnDef<T> {
    return {
        id: '#',
        header: '#',
        cell: (info) => info.row.index + 1,
        meta: { editable: false, align: 'center' },
        size: 45,
        enableResizing: false,
    };
}

// Wrappers using centralized core functions (bound to current fxRates/baseCurrency)
function useConversionHelpers(fxRates: Record<string, Record<string, number>>, baseCurrency: 'BGN' | 'EUR') {
    return useMemo(() => ({
        toBaseCcy: (amount: number, currency: string, date: string) => toBaseCurrencyStr(amount, currency, date, baseCurrency, fxRates),
        fxRate: (currency: string, date: string) => getFxRate(currency, date, baseCurrency, fxRates),
    }), [fxRates, baseCurrency]);
}

export function Workspace() {
    const [activeTab, setActiveTab] = useState<TabType>('holdings');
    const [fxTab, setFxTab] = useState<string | null>(null);
    const [revolutTab, setRevolutTab] = useState<string | null>(null);
    const [showWarnings, setShowWarnings] = useState(false);
    const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
    const [warningFilter, setWarningFilter] = useState<string>('all');
    const [editNewRow, setEditNewRow] = useState<{ index: number; nonce: number } | undefined>(undefined);

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

    const { toBaseCcy, fxRate: fxRateDisplay } = useConversionHelpers(fxRates, baseCurrency);

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

    // Collect unique values for select dropdowns
    const brokerOptions = [
        ...new Set([
            ...holdings.map(h => h.broker),
            ...sales.map(s => s.broker),
        ]),
    ].filter(Boolean).sort();

    const countryOptions = [
        ...new Set([
            'САЩ',
            'Ирландия',
            'Германия',
            'Великобритания',
            'Хонконг',
            'Нидерландия (Холандия)',
            ...holdings.map(h => h.country),
            ...sales.map(s => s.country),
            ...dividends.map(d => d.country),
        ]),
    ].filter(Boolean).sort();

    const currencyOptions = [
        ...new Set([
            'USD',
            'EUR',
            'GBP',
            'HKD',
            'BGN',
            ...holdings.map(h => h.currency),
            ...sales.map(s => s.currency),
            ...dividends.map(d => d.currency),
        ]),
    ].filter(Boolean).sort();

    const symbolOptions = [
        ...new Set([
            ...holdings.map(h => h.symbol),
            ...sales.map(s => s.symbol),
            ...dividends.map(d => d.symbol),
        ]),
    ].filter(Boolean).sort();

    // Symbol → country lookup from existing data (first match wins)
    const symbolCountryMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const h of holdings) if (h.symbol && h.country && !map.has(h.symbol)) map.set(h.symbol, h.country);
        for (const s of sales) if (s.symbol && s.country && !map.has(s.symbol)) map.set(s.symbol, s.country);
        for (const d of dividends) if (d.symbol && d.country && !map.has(d.symbol)) map.set(d.symbol, d.country);
        return map;
    }, [holdings, sales, dividends]);

    /** Auto-fill handler: when symbol is selected, fill country */
    const handleAutoFill = (columnId: string, selectedValue: string): Record<string, string> | undefined => {
        if (columnId === 'symbol') {
            const country = symbolCountryMap.get(selectedValue);
            if (country) return { country };
        }
        return undefined;
    };

    // Holdings columns
    const holdingsColumns: ColumnDef<Holding>[] = [
        createRowNumColumn<Holding>(),
        createEditableColumn<Holding>('broker', t('col.broker'), {
            inputType: 'select',
            selectOptions: brokerOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], broker: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('symbol', t('col.symbol'), {
            inputType: 'select',
            selectOptions: symbolOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], symbol: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('country', t('col.country'), {
            inputType: 'select',
            selectOptions: countryOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], country: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('dateAcquired', t('col.dateAcquired'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], dateAcquired: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('quantity', t('col.quantity'), {
            align: 'right',
            inputType: 'number',
            format: (v) => formatQuantity(v as number),
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], quantity: parseFloat(value) || 0 };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('currency', t('col.currency'), {
            inputType: 'select',
            selectOptions: currencyOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], currency: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('unitPrice', t('col.unitPrice'), {
            align: 'right',
            inputType: 'number',
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
            accessorFn: (row: Holding) => fxRateDisplay(row.currency, row.dateAcquired),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'totalBase',
            header: `${t('col.totalBase')} (${baseCurrency})`,
            accessorFn: (row: Holding) => {
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
            id: 'source',
            header: t('col.source'),
            accessorFn: (row: Holding) => row.source?.type ?? '',
            cell: (info) => {
                const row = info.row.original;
                return <span title={row.source?.file ?? undefined}>{info.getValue() as string}</span>;
            },
            meta: { editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: () => null,
            meta: { editable: false },
        },
    ];

    // Sales columns
    const salesColumns: ColumnDef<Sale>[] = [
        createRowNumColumn<Sale>(),
        createEditableColumn<Sale>('broker', t('col.broker'), {
            inputType: 'select',
            selectOptions: brokerOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], broker: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('symbol', t('col.symbol'), {
            inputType: 'select',
            selectOptions: symbolOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], symbol: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('country', t('col.country'), {
            inputType: 'select',
            selectOptions: countryOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], country: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('dateAcquired', t('col.dateAcquired'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], dateAcquired: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('dateSold', t('col.dateSold'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], dateSold: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('quantity', t('col.qty'), {
            align: 'right',
            inputType: 'number',
            format: (v) => formatQuantity(v as number),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], quantity: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('currency', t('col.currency'), {
            inputType: 'select',
            selectOptions: currencyOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], currency: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('buyPrice', t('col.buyPrice'), {
            align: 'right',
            inputType: 'number',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], buyPrice: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('sellPrice', t('col.sellPrice'), {
            align: 'right',
            inputType: 'number',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], sellPrice: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('fxRateBuy', t('col.fxRateBuy'), {
            align: 'right',
            inputType: 'number',
            format: (v) => (v as number).toFixed(6),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], fxRateBuy: parseFloat(value) || 1 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('fxRateSell', t('col.fxRateSell'), {
            align: 'right',
            inputType: 'number',
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
                return toBaseCcy(row.quantity * row.sellPrice, row.currency, row.dateSold);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'costBase',
            header: `${t('col.costBase')} (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                return toBaseCcy(row.quantity * row.buyPrice, row.currency, row.dateAcquired);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'plBase',
            header: `${t('col.plBase')} (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                const proceeds = parseFloat(toBaseCcy(row.quantity * row.sellPrice, row.currency, row.dateSold));
                const cost = parseFloat(toBaseCcy(row.quantity * row.buyPrice, row.currency, row.dateAcquired));
                if (isNaN(proceeds) || isNaN(cost)) return '—';
                return (proceeds - cost).toFixed(2);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'source',
            header: t('col.source'),
            accessorFn: (row: Sale) => row.source?.type ?? '',
            cell: (info) => {
                const row = info.row.original;
                return <span title={row.source?.file ?? undefined}>{info.getValue() as string}</span>;
            },
            meta: { editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: () => null,
            meta: { editable: false },
        },
    ];

    // Dividends columns
    const dividendsColumns: ColumnDef<Dividend>[] = [
        createRowNumColumn<Dividend>(),
        createEditableColumn<Dividend>('symbol', t('col.symbol'), {
            inputType: 'select',
            selectOptions: symbolOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], symbol: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('country', t('col.country'), {
            inputType: 'select',
            selectOptions: countryOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], country: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('date', t('col.date'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], date: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('currency', t('col.currency'), {
            inputType: 'select',
            selectOptions: currencyOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], currency: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('grossAmount', t('col.grossAmount'), {
            align: 'right',
            inputType: 'number',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], grossAmount: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('withholdingTax', t('col.wht'), {
            align: 'right',
            inputType: 'number',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], withholdingTax: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        {
            id: 'fxRate',
            header: t('col.fxRate'),
            accessorFn: (row: Dividend) => fxRateDisplay(row.currency, row.date),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'grossBase',
            header: `${t('col.grossBase')} (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                return toBaseCcy(row.grossAmount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'whtBase',
            header: `${t('col.whtBase')} (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                return toBaseCcy(row.withholdingTax, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'tax5pct',
            header: `${t('col.tax5pct')} (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                const grossStr = toBaseCcy(row.grossAmount, row.currency, row.date);
                const grossBase = grossStr !== '—' ? parseFloat(grossStr) : 0;
                return (grossBase * 0.05).toFixed(2);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'bgTaxDue',
            header: `${t('col.bgTaxDue')} (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                const grossStr = toBaseCcy(row.grossAmount, row.currency, row.date);
                const whtStr = toBaseCcy(row.withholdingTax, row.currency, row.date);
                const grossBase = grossStr !== '—' ? parseFloat(grossStr) : 0;
                const whtBase = whtStr !== '—' ? parseFloat(whtStr) : 0;
                return Math.max(0, grossBase * 0.05 - whtBase).toFixed(2);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        createEditableColumn<Dividend>('notes', t('col.notes'), {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], notes: value };
                updateDividend(rowIndex, updated);
            },
        }),
        {
            id: 'source',
            header: t('col.source'),
            accessorFn: (row: Dividend) => row.source?.type ?? '',
            cell: (info) => {
                const row = info.row.original;
                return <span title={row.source?.file ?? undefined}>{info.getValue() as string}</span>;
            },
            meta: { editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: () => null,
            meta: { editable: false },
        },
    ];

    // IB Interest columns
    const ibInterestColumns: ColumnDef<IBInterestEntry>[] = [
        createRowNumColumn<IBInterestEntry>(),
        createEditableColumn<IBInterestEntry>('date', t('col.date'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                const updated = { ...ibInterest[rowIndex], date: value };
                updateIbInterest(rowIndex, updated);
            },
        }),
        createEditableColumn<IBInterestEntry>('currency', t('col.currency'), {
            inputType: 'select',
            selectOptions: currencyOptions,
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
            inputType: 'number',
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
                return fxRateDisplay(row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `${t('col.amountBase')} (${baseCurrency})`,
            accessorFn: (row: IBInterestEntry) => {
                return toBaseCcy(row.amount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'source',
            header: t('col.source'),
            accessorFn: (row: IBInterestEntry) => row.source?.type ?? '',
            cell: (info) => {
                const row = info.row.original;
                return <span title={row.source?.file ?? undefined}>{info.getValue() as string}</span>;
            },
            meta: { editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: () => null,
            meta: { editable: false },
        },
    ];

    // Stock Yield columns
    const stockYieldColumns: ColumnDef<StockYieldEntry>[] = [
        createRowNumColumn<StockYieldEntry>(),
        createEditableColumn<StockYieldEntry>('date', t('col.date'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], date: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('symbol', t('col.symbol'), {
            inputType: 'select',
            selectOptions: symbolOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], symbol: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('currency', t('col.currency'), {
            inputType: 'select',
            selectOptions: currencyOptions,
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], currency: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('amount', t('col.amount'), {
            align: 'right',
            inputType: 'number',
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
                return fxRateDisplay(row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `${t('col.amountBase')} (${baseCurrency})`,
            accessorFn: (row: StockYieldEntry) => {
                return toBaseCcy(row.amount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'delete',
            header: '',
            cell: () => null,
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
            accessorFn: (row: RevolutInterestEntry) => fxRateDisplay(currency, row.date),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `${t('col.amountBase')} (${baseCurrency})`,
            accessorFn: (row: RevolutInterestEntry) => {
                return toBaseCcy(row.amount, currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
    ];

    const renderHoldingsContent = () => {
        // Calculate footer sums for holdings
        let totalQuantity = 0;
        let totalInCcy = 0;
        let totalInBase = 0;

        holdings.forEach(holding => {
            totalQuantity += holding.quantity;
            const cyyTotal = holding.quantity * holding.unitPrice;
            totalInCcy += cyyTotal;
            const baseStr = toBaseCcy(cyyTotal, holding.currency, holding.dateAcquired);
            const baseNum = baseStr !== '—' ? parseFloat(baseStr) : 0;
            totalInBase += baseNum;
        });

        const footerRow: Record<string, string> = {
            broker: t('summary.total'),
            quantity: formatQuantity(totalQuantity),
            totalCcy: totalInCcy.toFixed(2),
            totalBase: totalInBase.toFixed(2),
        };

        return (
            <DataTable
                columns={holdingsColumns}
                data={holdings}
                footerRow={footerRow}
                warningRows={holdingsWarnings.rows}
                warningMessages={holdingsWarnings.messages}
                warningCount={holdingsWarnings.rows.size}
                showWarningsOnly={showHoldingsWarningsOnly}
                onToggleWarningsOnly={() => setShowHoldingsWarningsOnly(!showHoldingsWarningsOnly)}
                editRowOnMount={editNewRow}
                onAutoFill={handleAutoFill}
                focusColumnOnEdit='symbol'
                onSaveRow={(rowIndex, values) => {
                    const original = holdings[rowIndex];
                    if (!original) return;
                    updateHolding(rowIndex, {
                        ...original,
                        broker: values.broker ?? original.broker,
                        country: values.country ?? original.country,
                        symbol: values.symbol ?? original.symbol,
                        dateAcquired: values.dateAcquired ?? original.dateAcquired,
                        quantity: values.quantity !== undefined ? parseFloat(values.quantity) || 0 : original.quantity,
                        currency: values.currency ?? original.currency,
                        unitPrice: values.unitPrice !== undefined ? parseFloat(values.unitPrice) || 0 : original.unitPrice,
                        notes: values.notes ?? original.notes,
                    });
                    setEditNewRow(undefined);
                }}
                onDeleteRow={(idx) => deleteHolding(idx)}
                onAddRow={() => {
                    const lastBroker = (holdings.length > 0 ? holdings[holdings.length - 1].broker : '')
                        || (sales.length > 0 ? sales[sales.length - 1].broker : '');
                    const newHolding: Holding = {
                        id: `holding-${Date.now()}`,
                        broker: lastBroker,
                        country: '',
                        symbol: '',
                        dateAcquired: '',
                        quantity: 0,
                        currency: 'USD',
                        unitPrice: 0,
                        notes: '',
                        source: { type: 'Manual' },
                    };
                    addHolding(newHolding);
                    setEditNewRow({ index: holdings.length, nonce: Date.now() });
                }}
                addRowLabel={t('button.addHolding')}
            />
        );
    };

    const renderSalesContent = () => {
        // Calculate summary totals
        let totalProceeds = 0;
        let totalCost = 0;
        let totalProfit = 0;
        let totalTax = 0;
        let totalQuantity = 0;

        sales.forEach(sale => {
            const proceedsStr = toBaseCcy(sale.quantity * sale.sellPrice, sale.currency, sale.dateSold);
            const costStr = toBaseCcy(sale.quantity * sale.buyPrice, sale.currency, sale.dateAcquired);

            const proceeds = proceedsStr !== '—' ? parseFloat(proceedsStr) : 0;
            const cost = costStr !== '—' ? parseFloat(costStr) : 0;
            const profit = proceeds - cost;

            totalQuantity += sale.quantity;
            totalProceeds += proceeds;
            totalCost += cost;
            totalProfit += profit;
            totalTax += profit > 0 ? profit * 0.1 : 0;
        });

        const footerRow: Record<string, string> = {
            broker: t('summary.total'),
            quantity: formatQuantity(totalQuantity),
            proceedsBase: totalProceeds.toFixed(2),
            costBase: totalCost.toFixed(2),
            plBase: totalProfit.toFixed(2),
        };

        return (
            <div>
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
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.totalProceeds')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalProceeds.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.totalCost')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalCost.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.totalPL')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalProfit.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.tax10pctCapGains')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalTax.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.count')}</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{sales.length}</div>
                    </div>
                    <div />
                </div>
                <DataTable
                    columns={salesColumns}
                    data={sales}
                    footerRow={footerRow}
                    warningRows={salesWarnings.rows}
                    warningMessages={salesWarnings.messages}
                    warningCount={salesWarnings.rows.size}
                    showWarningsOnly={showSalesWarningsOnly}
                    onToggleWarningsOnly={() => setShowSalesWarningsOnly(!showSalesWarningsOnly)}
                    editRowOnMount={editNewRow}
                    onAutoFill={handleAutoFill}
                    focusColumnOnEdit='symbol'
                    onSaveRow={(rowIndex, values) => {
                        const original = sales[rowIndex];
                        if (!original) return;
                        updateSale(rowIndex, {
                            ...original,
                            broker: values.broker ?? original.broker,
                            country: values.country ?? original.country,
                            symbol: values.symbol ?? original.symbol,
                            dateAcquired: values.dateAcquired ?? original.dateAcquired,
                            dateSold: values.dateSold ?? original.dateSold,
                            quantity: values.quantity !== undefined ? parseFloat(values.quantity) || 0 : original.quantity,
                            currency: values.currency ?? original.currency,
                            buyPrice: values.buyPrice !== undefined ? parseFloat(values.buyPrice) || 0 : original.buyPrice,
                            sellPrice: values.sellPrice !== undefined ? parseFloat(values.sellPrice) || 0 : original.sellPrice,
                            fxRateBuy: values.fxRateBuy !== undefined ? parseFloat(values.fxRateBuy) || 1 : original.fxRateBuy,
                            fxRateSell: values.fxRateSell !== undefined ? parseFloat(values.fxRateSell) || 1 : original.fxRateSell,
                        });
                        setEditNewRow(undefined);
                    }}
                    onDeleteRow={(idx) => deleteSale(idx)}
                    onAddRow={() => {
                        const lastBroker = (sales.length > 0 ? sales[sales.length - 1].broker : '')
                            || (holdings.length > 0 ? holdings[holdings.length - 1].broker : '');
                        const newSale: Sale = {
                            id: `sale-${Date.now()}`,
                            broker: lastBroker,
                            country: '',
                            symbol: '',
                            dateAcquired: '',
                            dateSold: '',
                            quantity: 0,
                            currency: 'USD',
                            buyPrice: 0,
                            sellPrice: 0,
                            fxRateBuy: 1,
                            fxRateSell: 1,
                            source: { type: 'Manual' },
                        };
                        addSale(newSale);
                        setEditNewRow({ index: sales.length, nonce: Date.now() });
                    }}
                    addRowLabel={t('button.addSale')}
                />
            </div>
        );
    };

    // Build warning rows/messages for a given tab name
    const buildWarningData = (tabName: string) => {
        const tabWarnings = warnings.filter(w => w.tab === tabName && w.rowIndex !== undefined);
        const rows = new Set<number>();
        const messages = new Map<number, string[]>();
        for (const w of tabWarnings) {
            rows.add(w.rowIndex!);
            const msgs = messages.get(w.rowIndex!) ?? [];
            msgs.push(w.message);
            messages.set(w.rowIndex!, msgs);
        }
        return { rows, messages };
    };

    const holdingsWarnings = useMemo(() => buildWarningData('Holdings'), [warnings]);
    const salesWarnings = useMemo(() => buildWarningData('Sales'), [warnings]);
    const ibInterestWarnings = useMemo(() => buildWarningData('IB Interest'), [warnings]);
    const stockYieldWarnings = useMemo(() => buildWarningData('Stock Yield'), [warnings]);

    const [showHoldingsWarningsOnly, setShowHoldingsWarningsOnly] = useState(false);
    const [showSalesWarningsOnly, setShowSalesWarningsOnly] = useState(false);

    const sortedDividends = useMemo(() => {
        const indexed = dividends.map((d, origIdx) => ({ d, origIdx }));
        indexed.sort((a, b) => {
            if (!a.d.symbol) return 1;
            if (!b.d.symbol) return -1;
            return a.d.symbol.localeCompare(b.d.symbol) || a.d.date.localeCompare(b.d.date);
        });
        return indexed;
    }, [dividends]);

    const sortedDividendData = useMemo(() => sortedDividends.map(s => s.d), [sortedDividends]);

    // Build warning data for dividends table
    const [showDividendWarningsOnly, setShowDividendWarningsOnly] = useState(false);
    const dividendWarningRows = useMemo(() => {
        const divWarnings = warnings.filter(w => w.tab === 'Dividends' && w.rowIndex !== undefined);
        const rows = new Set<number>();
        const messages = new Map<number, string[]>();

        // Map original indices to sorted indices (O(n), no indexOf)
        const originalToSorted = new Map<number, number>();
        sortedDividends.forEach((item, sortedIdx) => {
            originalToSorted.set(item.origIdx, sortedIdx);
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

    const renderDividendsContent = () => {
        // Calculate summary totals — sum each column as displayed
        let totalGrossBase = 0;
        let totalWhtBase = 0;
        let totalTax5pct = 0;
        let totalBgTaxDue = 0;
        let totalGrossOrig = 0;
        let totalWhtOrig = 0;

        dividends.forEach(dividend => {
            const grossStr = toBaseCcy(dividend.grossAmount, dividend.currency, dividend.date);
            const whtStr = toBaseCcy(dividend.withholdingTax, dividend.currency, dividend.date);
            const grossBase = grossStr !== '—' ? parseFloat(grossStr) : 0;
            const whtBase = whtStr !== '—' ? parseFloat(whtStr) : 0;
            totalGrossBase += grossBase;
            totalWhtBase += whtBase;
            const tax5pct = grossBase * 0.05;
            totalTax5pct += tax5pct;
            // BG Tax Due = max(0, Tax 5% - WHT)
            totalBgTaxDue += Math.max(0, tax5pct - whtBase);
            totalGrossOrig += dividend.grossAmount;
            totalWhtOrig += dividend.withholdingTax;
        });

        const footerRow: Record<string, string> = {
            symbol: t('summary.total'),
            grossAmount: totalGrossOrig.toFixed(2),
            withholdingTax: totalWhtOrig.toFixed(2),
            grossBase: totalGrossBase.toFixed(2),
            whtBase: totalWhtBase.toFixed(2),
            tax5pct: totalTax5pct.toFixed(2),
            bgTaxDue: totalBgTaxDue.toFixed(2),
        };

        return (
            <div>
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
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.totalGross')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalGrossBase.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.totalWht')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalWhtBase.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.tax5pct')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalTax5pct.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>BG Tax Due ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalBgTaxDue.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.count')}</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{dividends.length}</div>
                    </div>
                </div>
                <DataTable
                    columns={dividendsColumns}
                    data={sortedDividendData}
                    footerRow={footerRow}
                    onAutoFill={handleAutoFill}
                    warningRows={dividendWarningRows.rows}
                    warningMessages={dividendWarningRows.messages}
                    warningCount={dividendWarningRows.rows.size}
                    showWarningsOnly={showDividendWarningsOnly}
                    onToggleWarningsOnly={() => setShowDividendWarningsOnly(!showDividendWarningsOnly)}
                    editRowOnMount={editNewRow}
                    onSaveRow={(sortedIdx, values) => {
                        const item = sortedDividends[sortedIdx];
                        if (!item) return;
                        const d = item.d;
                        updateDividend(item.origIdx, {
                            ...d,
                            symbol: values.symbol ?? d.symbol,
                            country: values.country ?? d.country,
                            date: values.date ?? d.date,
                            currency: values.currency ?? d.currency,
                            grossAmount: values.grossAmount !== undefined ? parseFloat(values.grossAmount) || 0 : d.grossAmount,
                            withholdingTax: values.withholdingTax !== undefined ? parseFloat(values.withholdingTax) || 0 : d.withholdingTax,
                            notes: values.notes ?? d.notes,
                        });
                        setEditNewRow(undefined);
                    }}
                    onDeleteRow={(sortedIdx) => {
                        const item = sortedDividends[sortedIdx];
                        if (!item) return;
                        deleteDividend(item.origIdx);
                    }}
                    onAddRow={() => {
                        const newDividend: Dividend = {
                            symbol: '',
                            country: '',
                            date: '',
                            currency: 'USD',
                            grossAmount: 0,
                            withholdingTax: 0,
                            bgTaxDue: 0,
                            whtCredit: 0,
                            notes: '',
                            source: { type: 'Manual' },
                        };
                        addDividend(newDividend);
                        setEditNewRow({ index: dividends.length, nonce: Date.now() });
                    }}
                    addRowLabel={t('button.addDividend')}
                />
            </div>
        );
    };

    const renderStockYieldContent = () => (
        <DataTable
            columns={stockYieldColumns}
            data={stockYield}
            warningRows={stockYieldWarnings.rows}
            warningMessages={stockYieldWarnings.messages}
            warningCount={stockYieldWarnings.rows.size}
            editRowOnMount={editNewRow}
            onSaveRow={(rowIndex, values) => {
                const original = stockYield[rowIndex];
                if (!original) return;
                updateStockYield(rowIndex, {
                    ...original,
                    date: values.date ?? original.date,
                    symbol: values.symbol ?? original.symbol,
                    currency: values.currency ?? original.currency,
                    amount: values.amount !== undefined ? parseFloat(values.amount) || 0 : original.amount,
                });
                setEditNewRow(undefined);
            }}
            onDeleteRow={(idx) => deleteStockYield(idx)}
            onAddRow={() => {
                const newEntry: StockYieldEntry = {
                    date: '',
                    symbol: '',
                    currency: 'USD',
                    amount: 0,
                };
                addStockYield(newEntry);
                setEditNewRow({ index: stockYield.length, nonce: Date.now() });
            }}
            addRowLabel='Add Stock Yield Entry'
        />
    );

    const renderIbInterestContent = () => {
        // Calculate summary totals
        let totalInterest = 0;
        let totalInterestBase = 0;
        ibInterest.forEach(entry => {
            totalInterest += entry.amount;
            const amountStr = toBaseCcy(entry.amount, entry.currency, entry.date);
            const amount = amountStr !== '—' ? parseFloat(amountStr) : 0;
            totalInterestBase += amount;
        });

        const totalTax = totalInterestBase * 0.1;

        const footerRow: Record<string, string> = {
            date: t('summary.total'),
            amount: totalInterest.toFixed(2),
            amountBase: totalInterestBase.toFixed(2),
        };

        return (
            <div>
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
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.totalInterest')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalInterestBase.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.tax10pct')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{totalTax.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.count')}</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{ibInterest.length}</div>
                    </div>
                    <div />
                    <div />
                    <div />
                </div>
                <DataTable
                    columns={ibInterestColumns}
                    data={ibInterest}
                    footerRow={footerRow}
                    warningRows={ibInterestWarnings.rows}
                    warningMessages={ibInterestWarnings.messages}
                    warningCount={ibInterestWarnings.rows.size}
                    editRowOnMount={editNewRow}
                    onSaveRow={(rowIndex, values) => {
                        const original = ibInterest[rowIndex];
                        if (!original) return;
                        updateIbInterest(rowIndex, {
                            ...original,
                            date: values.date ?? original.date,
                            currency: values.currency ?? original.currency,
                            description: values.description ?? original.description,
                            amount: values.amount !== undefined ? parseFloat(values.amount) || 0 : original.amount,
                        });
                        setEditNewRow(undefined);
                    }}
                    onDeleteRow={(idx) => deleteIbInterest(idx)}
                    onAddRow={() => {
                        const newEntry: IBInterestEntry = {
                            date: '',
                            currency: 'USD',
                            description: '',
                            amount: 0,
                            source: { type: 'Manual' },
                        };
                        addIbInterest(newEntry);
                        setEditNewRow({ index: ibInterest.length, nonce: Date.now() });
                    }}
                    addRowLabel={t('button.addInterest')}
                />
            </div>
        );
    };

    const renderRevolutInterestContent = () => {
        const currencies = revolutInterest.map((r) => r.currency).sort();

        if (currencies.length === 0) {
            return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No data</div>;
        }

        if (!revolutTab) {
            setRevolutTab('total');
        }

        const currentTab = revolutTab || 'total';
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
                            {(() => {
                                const totalAmount = currentData.entries.reduce((s, e) => s + e.amount, 0);
                                const totalAmountBase = toBaseCcy(totalAmount, currentTab, midDate);
                                const footerRow: Record<string, string> = {
                                    date: t('summary.total'),
                                    amount: totalAmount.toFixed(2),
                                    amountBase: totalAmountBase,
                                };
                                return <DataTable columns={getRevolutEntryColumns(currentTab)} data={currentData.entries} footerRow={footerRow} />;
                            })()}
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
                                        const typeWarnings = warnings.filter(w => w.type === type && !dismissedWarnings.has(`${w.type}:${w.message}`));
                                        const count = typeWarnings.length;
                                        return (
                                            <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                                <button
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
                                                {count > 0 && (
                                                    <button
                                                        onClick={() =>
                                                            setDismissedWarnings(prev => {
                                                                const next = new Set(prev);
                                                                for (const w of typeWarnings) next.add(`${w.type}:${w.message}`);
                                                                return next;
                                                            })}
                                                        title={`Dismiss all ${type.replace(/-/g, ' ')} warnings`}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '0.75rem',
                                                            padding: '0 0.25rem',
                                                            textDecoration: 'underline',
                                                        }}
                                                    >
                                                        dismiss all
                                                    </button>
                                                )}
                                            </span>
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
