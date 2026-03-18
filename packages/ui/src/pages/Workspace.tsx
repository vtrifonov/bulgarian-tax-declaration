import {
    FxService,
    getFxRate,
    InMemoryFxCache,
    t,
    toBaseCurrencyStr,
    validate,
} from '@bg-tax/core';
import type {
    Dividend,
    Holding,
    InterestEntry,
    Sale,
    ValidationWarning,
} from '@bg-tax/core';
import type { ColumnDef } from '@tanstack/react-table';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { DataTable } from '../components/DataTable';
import { useAppStore } from '../store/app-state';

type TabType = 'holdings' | 'sales' | 'dividends' | 'brokerInterest' | 'fxRates';

/** Show up to 8 decimals, trimming trailing zeros */
function formatQuantity(n: number): string {
    if (n === 0) {
        return '0';
    }
    const s = n.toFixed(8);
    // Remove trailing zeros but keep at least 2 decimals
    const trimmed = s.replace(/0+$/, '');
    const dotIdx = trimmed.indexOf('.');

    if (dotIdx === -1) {
        return trimmed;
    }
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

            if (options?.format) {
                return options.format(raw);
            }

            // Format ISO dates as DD.MM.YYYY for display
            if (options?.inputType === 'date' && typeof raw === 'string') {
                const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

                if (m) {
                    return `${m[3]}.${m[2]}.${m[1]}`;
                }
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
        accessorFn: (_row, index) => index,
        cell: (info) => info.row.index + 1,
        meta: { editable: false, align: 'center' },
        size: 45,
        enableResizing: false,
        sortingFn: 'basic',
    };
}

// Wrappers using centralized core functions (bound to current fxRates/baseCurrency)
function useConversionHelpers(fxRates: Record<string, Record<string, number>>, baseCurrency: 'BGN' | 'EUR') {
    return useMemo(() => ({
        toBaseCcy: (amount: number, currency: string, date: string) => toBaseCurrencyStr(amount, currency, date, baseCurrency, fxRates),
        fxRate: (currency: string, date: string) => getFxRate(currency, date, baseCurrency, fxRates),
        /** Numeric FX rate for a currency on a date, or null if unavailable */
        numericFxRate: (currency: string, date: string): number | null => {
            const str = getFxRate(currency, date, baseCurrency, fxRates);

            if (str === '—') {
                return null;
            }
            const n = parseFloat(str);

            return isNaN(n) ? null : n;
        },
    }), [fxRates, baseCurrency]);
}

/** Whether an FX rate lookup requires a date (i.e. needs ECB rates, not a fixed/identity rate) */
function needsDateForFx(currency: string, baseCurrency: string): boolean {
    if (currency === baseCurrency) {
        return false;
    }

    if (currency === 'EUR' && baseCurrency === 'BGN') {
        return false;
    }

    if (currency === 'BGN' && baseCurrency === 'EUR') {
        return false;
    }

    return true;
}

export function Workspace() {
    const [activeTab, setActiveTab] = useState<TabType>('holdings');
    const [activeInterestSubTab, setActiveInterestSubTab] = useState<number>(0);
    const [fxTab, setFxTab] = useState<string | null>(null);
    const [showWarnings, setShowWarnings] = useState(false);
    const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
    const [warningFilter, setWarningFilter] = useState<string>('all');
    const [editNewRow, setEditNewRow] = useState<{ index: number; nonce: number; focusColumn?: string } | undefined>(undefined);

    const {
        holdings,
        sales,
        dividends,
        stockYield,
        brokerInterest,
        fxRates,
        baseCurrency,
        taxYear,
        language,
        updateHolding,
        deleteHolding,
        moveHolding,
        insertHolding,
        addHolding,
        updateSale,
        deleteSale,
        addSale,
        updateDividend,
        deleteDividend,
        addDividend,
        updateBrokerInterest,
        deleteBrokerInterest,
        setFxRates,
        importHoldings,
        tableSorting,
        setTableSorting,
    } = useAppStore();

    const { toBaseCcy, fxRate: fxRateDisplay, numericFxRate } = useConversionHelpers(fxRates, baseCurrency);

    /** Fetch FX rate for a currency+date on-demand if not already cached, then update the sale */
    const fetchAndSetFxRate = useCallback(async (
        currency: string,
        date: string,
        rowIndex: number,
        field: 'fxRateBuy' | 'fxRateSell',
    ) => {
        if (!date || currency === baseCurrency || currency === 'EUR' || currency === 'BGN') {
            return;
        }
        const year = parseInt(date.substring(0, 4));

        if (isNaN(year)) {
            return;
        }

        const fxService = new FxService(new InMemoryFxCache(), baseCurrency);

        try {
            const rates = await fxService.fetchRates([currency], year);

            if (Object.keys(rates).length > 0) {
                setFxRates(rates);
                // Re-read store to get merged rates and compute numeric rate
                const merged = { ...useAppStore.getState().fxRates };

                for (const [ccy, dateRates] of Object.entries(rates)) {
                    merged[ccy] = { ...merged[ccy], ...dateRates };
                }
                const rateStr = getFxRate(currency, date, baseCurrency, merged);

                if (rateStr !== '—') {
                    const rate = parseFloat(rateStr);

                    if (!isNaN(rate)) {
                        const sale = useAppStore.getState().sales[rowIndex];

                        if (sale) {
                            updateSale(rowIndex, { ...sale, [field]: rate });
                        }
                    }
                }
            }
        } catch { /* silently fail */ }
    }, [baseCurrency, setFxRates, updateSale]);

    // Track which currency+year combos have been fetched or are in-flight
    const fxFetchedRef = useRef<Set<string>>(new Set());

    /** Fetch FX rates for a currency+year if not already cached in the store */
    const ensureFxRates = useCallback(async (currency: string, date: string) => {
        if (!date || !needsDateForFx(currency, baseCurrency)) {
            return;
        }
        const year = parseInt(date.substring(0, 4), 10);

        if (isNaN(year)) {
            return;
        }
        const key = `${currency}:${year}`;

        if (fxFetchedRef.current.has(key)) {
            return;
        }
        // Check store for existing rates in this year
        const currentRates = useAppStore.getState().fxRates[currency];

        if (currentRates && Object.keys(currentRates).some(d => d.startsWith(String(year)))) {
            fxFetchedRef.current.add(key);

            return;
        }
        fxFetchedRef.current.add(key); // Mark in-flight to prevent duplicates
        try {
            const fxService = new FxService(new InMemoryFxCache(), baseCurrency);
            const rates = await fxService.fetchRates([currency], year);

            if (Object.keys(rates).length > 0) {
                setFxRates(rates);
            }
        } catch { /* silently fail */ }
    }, [baseCurrency, setFxRates]);

    /** Scan all data for missing FX rates and fetch them */
    const fetchAllMissingFxRates = useCallback(() => {
        const { holdings: h, sales: s, dividends: d, brokerInterest: bi } = useAppStore.getState();

        for (const row of h) {
            void ensureFxRates(row.currency, row.dateAcquired);
        }

        for (const row of s) {
            void ensureFxRates(row.currency, row.dateAcquired);
            void ensureFxRates(row.currency, row.dateSold);
        }

        for (const row of d) {
            void ensureFxRates(row.currency, row.date);
        }

        for (const group of bi) {
            for (const e of group.entries) {
                void ensureFxRates(e.currency, e.date);
            }
        }
    }, [ensureFxRates]);

    // On mount, fetch any missing FX rates for existing data
    useEffect(() => {
        fetchAllMissingFxRates();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            brokerInterest,
            fxRates,
            manualEntries: [],
        };

        return validate(appState);
    }, [taxYear, baseCurrency, language, holdings, sales, dividends, stockYield, brokerInterest, fxRates]);

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
        if (brokerInterest.length > 0) {
            const totalEntries = brokerInterest.reduce((sum, bi) => sum + bi.entries.length, 0);

            tabs.push({
                id: 'brokerInterest',
                labelKey: 'tab.brokerInterest',
                count: totalEntries,
                warningCount: warningsByTab['broker interest'] || 0,
                tooltip: 'Broker interest income from IB, Revolut, and other sources',
            });
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

        for (const h of holdings) {
            if (h.symbol && h.country && !map.has(h.symbol)) {
                map.set(h.symbol, h.country);
            }
        }

        for (const s of sales) {
            if (s.symbol && s.country && !map.has(s.symbol)) {
                map.set(s.symbol, s.country);
            }
        }

        for (const d of dividends) {
            if (d.symbol && d.country && !map.has(d.symbol)) {
                map.set(d.symbol, d.country);
            }
        }

        return map;
    }, [holdings, sales, dividends]);

    /** Auto-fill handler: when symbol is selected, fill country */
    const handleAutoFill = (columnId: string, selectedValue: string): Record<string, string> | undefined => {
        if (columnId === 'symbol') {
            const country = symbolCountryMap.get(selectedValue);

            if (country) {
                return { country };
            }
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
            accessorFn: (row: Holding) => {
                if (!row.dateAcquired && needsDateForFx(row.currency, baseCurrency)) {
                    return '—';
                }

                return fxRateDisplay(row.currency, row.dateAcquired);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'totalBase',
            header: `${t('col.totalBase')} (${baseCurrency})`,
            accessorFn: (row: Holding) => {
                if (!row.dateAcquired && needsDateForFx(row.currency, baseCurrency)) {
                    return '—';
                }

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
            id: 'consumedBy',
            header: t('col.consumedBy'),
            accessorFn: (row: Holding) => {
                if (!row.consumedBySaleIds?.length) {
                    return '';
                }

                // Show matching sale indices (1-based) for readability
                return row.consumedBySaleIds.map(saleId => {
                    const idx = sales.findIndex(s => s.id === saleId);

                    return idx >= 0 ? `#${idx + 1}` : saleId.slice(0, 6);
                }).join(', ');
            },
            cell: (info) => {
                const row = info.row.original;
                const val = info.getValue() as string;

                if (!val) {
                    return null;
                }

                return (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span title={row.consumedBySaleIds?.join('\n')}>{val}</span>
                        <button
                            className='btn btn-sm'
                            style={{ padding: '0 4px', fontSize: '0.75rem', lineHeight: 1 }}
                            title={t('button.markNotSold')}
                            onClick={() => {
                                const idx = info.row.index;

                                updateHolding(idx, {
                                    ...row,
                                    consumedByFifo: undefined,
                                    consumedBySaleIds: undefined,
                                });
                            }}
                        >
                            ↩
                        </button>
                    </span>
                );
            },
            meta: {
                editable: true,
                editInitialValue: (row: Holding) => {
                    if (!row.consumedBySaleIds?.length) {
                        return '';
                    }

                    return row.consumedBySaleIds.map(saleId => {
                        const idx = sales.findIndex(s => s.id === saleId);

                        return idx >= 0 ? String(idx + 1) : '';
                    }).filter(Boolean).join(', ');
                },
            },
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
                const sale = sales[rowIndex];
                const newFxRate = numericFxRate(sale.currency, value);
                const updated = { ...sale, dateAcquired: value, fxRateBuy: newFxRate ?? sale.fxRateBuy };

                updateSale(rowIndex, updated);

                if (newFxRate === null) {
                    void fetchAndSetFxRate(sale.currency, value, rowIndex, 'fxRateBuy');
                }
            },
        }),
        createEditableColumn<Sale>('dateSold', t('col.dateSold'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                const sale = sales[rowIndex];
                const newFxRate = numericFxRate(sale.currency, value);
                const updated = { ...sale, dateSold: value, fxRateSell: newFxRate ?? sale.fxRateSell };

                updateSale(rowIndex, updated);

                if (newFxRate === null) {
                    void fetchAndSetFxRate(sale.currency, value, rowIndex, 'fxRateSell');
                }
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
                const sale = sales[rowIndex];
                const fxRateBuy = numericFxRate(value, sale.dateAcquired) ?? sale.fxRateBuy;
                const fxRateSell = numericFxRate(value, sale.dateSold) ?? sale.fxRateSell;
                const updated = { ...sale, currency: value, fxRateBuy, fxRateSell };

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
            format: (v) => (v as number) > 0 ? (v as number).toFixed(6) : '—',
            onSave: (rowIndex, value) => {
                const parsed = parseFloat(value);
                const updated = { ...sales[rowIndex], fxRateBuy: isNaN(parsed) ? sales[rowIndex].fxRateBuy : parsed };

                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('fxRateSell', t('col.fxRateSell'), {
            align: 'right',
            inputType: 'number',
            format: (v) => (v as number) > 0 ? (v as number).toFixed(6) : '—',
            onSave: (rowIndex, value) => {
                const parsed = parseFloat(value);
                const updated = { ...sales[rowIndex], fxRateSell: isNaN(parsed) ? sales[rowIndex].fxRateSell : parsed };

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
                if ((!row.dateAcquired && needsDateForFx(row.currency, baseCurrency)) || row.fxRateBuy == null) { // eslint-disable-line eqeqeq -- intentional null|undefined check
                    return '—';
                }

                return toBaseCcy(row.quantity * row.buyPrice, row.currency, row.dateAcquired);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'plBase',
            header: `${t('col.plBase')} (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                if ((!row.dateAcquired && needsDateForFx(row.currency, baseCurrency)) || row.fxRateBuy == null || row.fxRateSell == null) { // eslint-disable-line eqeqeq -- intentional null|undefined check
                    return '—';
                }
                const proceeds = parseFloat(toBaseCcy(row.quantity * row.sellPrice, row.currency, row.dateSold));
                const cost = parseFloat(toBaseCcy(row.quantity * row.buyPrice, row.currency, row.dateAcquired));

                if (isNaN(proceeds) || isNaN(cost)) {
                    return '—';
                }

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
        {
            id: 'broker',
            header: t('col.broker'),
            accessorFn: (row: Dividend) => row.source?.type ?? '',
            meta: { editable: false },
            size: 70,
        },
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

    // Broker Interest columns
    const brokerInterestColumns: ColumnDef<InterestEntry>[] = [
        createRowNumColumn<InterestEntry>(),
        createEditableColumn<InterestEntry>('date', t('col.date'), {
            inputType: 'date',
            onSave: (rowIndex, value) => {
                // Find the broker and position within that broker's entries
                let currentIdx = 0;

                for (const bi of brokerInterest) {
                    if (currentIdx + bi.entries.length > rowIndex) {
                        const entryIdx = rowIndex - currentIdx;
                        const updated = { ...bi };

                        updated.entries = [...updated.entries];
                        updated.entries[entryIdx] = { ...updated.entries[entryIdx], date: value };
                        updateBrokerInterest(brokerInterest.indexOf(bi), updated);

                        return;
                    }
                    currentIdx += bi.entries.length;
                }
            },
        }),
        createEditableColumn<InterestEntry>('currency', t('col.currency'), {
            inputType: 'select',
            selectOptions: currencyOptions,
            onSave: (rowIndex, value) => {
                // Find the broker and position within that broker's entries
                let currentIdx = 0;

                for (const bi of brokerInterest) {
                    if (currentIdx + bi.entries.length > rowIndex) {
                        const entryIdx = rowIndex - currentIdx;
                        const updated = { ...bi };

                        updated.entries = [...updated.entries];
                        updated.entries[entryIdx] = { ...updated.entries[entryIdx], currency: value };
                        updateBrokerInterest(brokerInterest.indexOf(bi), updated);

                        return;
                    }
                    currentIdx += bi.entries.length;
                }
            },
        }),
        createEditableColumn<InterestEntry>('description', t('col.description'), {
            onSave: (rowIndex, value) => {
                // Find the broker and position within that broker's entries
                let currentIdx = 0;

                for (const bi of brokerInterest) {
                    if (currentIdx + bi.entries.length > rowIndex) {
                        const entryIdx = rowIndex - currentIdx;
                        const updated = { ...bi };

                        updated.entries = [...updated.entries];
                        updated.entries[entryIdx] = { ...updated.entries[entryIdx], description: value };
                        updateBrokerInterest(brokerInterest.indexOf(bi), updated);

                        return;
                    }
                    currentIdx += bi.entries.length;
                }
            },
        }),
        createEditableColumn<InterestEntry>('amount', t('col.amount'), {
            align: 'right',
            inputType: 'number',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                // Find the broker and position within that broker's entries
                let currentIdx = 0;

                for (const bi of brokerInterest) {
                    if (currentIdx + bi.entries.length > rowIndex) {
                        const entryIdx = rowIndex - currentIdx;
                        const updated = { ...bi };

                        updated.entries = [...updated.entries];
                        updated.entries[entryIdx] = { ...updated.entries[entryIdx], amount: parseFloat(value) || 0 };
                        updateBrokerInterest(brokerInterest.indexOf(bi), updated);

                        return;
                    }
                    currentIdx += bi.entries.length;
                }
            },
        }),
        {
            id: 'fxRate',
            header: t('col.fxRate'),
            accessorFn: (row: InterestEntry) => {
                return fxRateDisplay(row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `${t('col.amountBase')} (${baseCurrency})`,
            accessorFn: (row: InterestEntry) => {
                return toBaseCcy(row.amount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'source',
            header: t('col.source'),
            accessorFn: (row: InterestEntry) => row.source?.type ?? '',
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
    const renderHoldingsContent = () => {
        // Calculate footer sums for holdings (exclude consumed)
        let totalQuantity = 0;
        let totalInCcy = 0;
        let totalInBase = 0;

        const consumedRows = new Set<number>();
        const hasConsumed = holdings.some(h => h.consumedByFifo);

        holdings.forEach((holding, i) => {
            if (holding.consumedByFifo) {
                consumedRows.add(i);

                return;
            }
            totalQuantity += holding.quantity;
            const cyyTotal = holding.quantity * holding.unitPrice;

            totalInCcy += cyyTotal;

            if (holding.dateAcquired || !needsDateForFx(holding.currency, baseCurrency)) {
                const baseStr = toBaseCcy(cyyTotal, holding.currency, holding.dateAcquired);
                const baseNum = baseStr !== '—' ? parseFloat(baseStr) : 0;

                totalInBase += baseNum;
            }
        });

        const footerRow: Record<string, string> = {
            broker: t('summary.total'),
            quantity: formatQuantity(totalQuantity),
            totalCcy: totalInCcy.toFixed(2),
            totalBase: totalInBase.toFixed(2),
        };

        return (
            <>
                {hasConsumed && (
                    <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            className='btn btn-sm'
                            onClick={() => importHoldings(holdings.filter(h => !h.consumedByFifo))}
                            title={t('button.removeExecutedDesc')}
                        >
                            {t('button.removeExecuted')}
                        </button>
                    </div>
                )}
                <DataTable
                    columns={holdingsColumns}
                    data={holdings}
                    footerRow={footerRow}
                    onSortingChange={(s) => setTableSorting('holdings', s)}
                    initialSorting={tableSorting.holdings}
                    strikeThroughRows={consumedRows.size > 0 ? consumedRows : undefined}
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

                        if (!original) {
                            return;
                        }
                        // Parse consumedBy edit: "1, 3" → sale IDs
                        let consumedByFifo = original.consumedByFifo;
                        let consumedBySaleIds = original.consumedBySaleIds;
                        let quantity = values.quantity !== undefined ? parseFloat(values.quantity) || 0 : original.quantity;

                        if (values.consumedBy !== undefined) {
                            const nums = values.consumedBy.split(/[,\s]+/).map(s => parseInt(s.replace('#', ''), 10)).filter(n => !isNaN(n));
                            const saleIds = nums.map(n => sales[n - 1]?.id).filter(Boolean) as string[];

                            consumedByFifo = saleIds.length > 0 ? true : undefined;
                            consumedBySaleIds = saleIds.length > 0 ? saleIds : undefined;

                            if (saleIds.length > 0) {
                                quantity = 0;
                            }
                        }
                        const currency = values.currency ?? original.currency;
                        const dateAcquired = values.dateAcquired ?? original.dateAcquired;

                        updateHolding(rowIndex, {
                            ...original,
                            broker: values.broker ?? original.broker,
                            country: values.country ?? original.country,
                            symbol: values.symbol ?? original.symbol,
                            dateAcquired,
                            quantity,
                            currency,
                            unitPrice: values.unitPrice !== undefined ? parseFloat(values.unitPrice) || 0 : original.unitPrice,
                            notes: values.notes ?? original.notes,
                            consumedByFifo,
                            consumedBySaleIds,
                        });
                        // Fetch FX rates if needed for the updated currency+date
                        void ensureFxRates(currency, dateAcquired);
                        setEditNewRow(undefined);
                    }}
                    onDeleteRow={(idx) => deleteHolding(idx)}
                    onSplitRow={(rowIndex) => {
                        const original = holdings[rowIndex];

                        if (!original) {
                            return;
                        }
                        const newHolding: Holding = {
                            ...original,
                            id: `holding-${Date.now()}`,
                            quantity: 0,
                            source: { type: 'Manual' },
                        };

                        insertHolding(rowIndex + 1, newHolding);
                        setEditNewRow({ index: rowIndex + 1, nonce: Date.now(), focusColumn: 'quantity' });
                    }}
                    onMoveRow={moveHolding}
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
            </>
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
            // Skip incomplete sales (missing buy date or FX rates)
            if (!sale.dateAcquired || sale.fxRateBuy == null || sale.fxRateSell == null) { // eslint-disable-line eqeqeq -- intentional null|undefined check
                return;
            }

            const proceedsStr = toBaseCcy(sale.quantity * sale.sellPrice, sale.currency, sale.dateSold);
            const costStr = toBaseCcy(sale.quantity * sale.buyPrice, sale.currency, sale.dateAcquired);

            const proceeds = proceedsStr !== '—' ? parseFloat(proceedsStr) : 0;
            const cost = costStr !== '—' ? parseFloat(costStr) : 0;
            const profit = proceeds - cost;

            totalQuantity += sale.quantity;
            totalProceeds += proceeds;
            totalCost += cost;
            totalProfit += profit;
        });

        totalTax = totalProfit > 0 ? totalProfit * 0.1 : 0;

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
                    onSortingChange={(s) => setTableSorting('sales', s)}
                    initialSorting={tableSorting.sales}
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

                        if (!original) {
                            return;
                        }
                        const currency = values.currency ?? original.currency;
                        const dateAcquired = values.dateAcquired ?? original.dateAcquired;
                        const dateSold = values.dateSold ?? original.dateSold;

                        // Recalculate FX rates if date or currency changed
                        const dateOrCcyChanged = currency !== original.currency
                            || dateAcquired !== original.dateAcquired
                            || dateSold !== original.dateSold;

                        let fxRateBuy = original.fxRateBuy;
                        let fxRateSell = original.fxRateSell;
                        let needFetchBuy = false;
                        let needFetchSell = false;

                        // Check if user manually changed FX rate values
                        const parsedFxBuy = values.fxRateBuy !== undefined ? parseFloat(values.fxRateBuy) : NaN;
                        const parsedFxSell = values.fxRateSell !== undefined ? parseFloat(values.fxRateSell) : NaN;
                        const fxBuyManuallyChanged = !isNaN(parsedFxBuy) && parsedFxBuy !== original.fxRateBuy;
                        const fxSellManuallyChanged = !isNaN(parsedFxSell) && parsedFxSell !== original.fxRateSell;

                        if (fxBuyManuallyChanged) {
                            fxRateBuy = parsedFxBuy;
                        } else if (dateOrCcyChanged) {
                            const rate = numericFxRate(currency, dateAcquired);

                            if (rate !== null) {
                                fxRateBuy = rate;
                            } else {
                                needFetchBuy = true;
                            }
                        }

                        if (fxSellManuallyChanged) {
                            fxRateSell = parsedFxSell;
                        } else if (dateOrCcyChanged) {
                            const rate = numericFxRate(currency, dateSold);

                            if (rate !== null) {
                                fxRateSell = rate;
                            } else {
                                needFetchSell = true;
                            }
                        }

                        updateSale(rowIndex, {
                            ...original,
                            broker: values.broker ?? original.broker,
                            country: values.country ?? original.country,
                            symbol: values.symbol ?? original.symbol,
                            dateAcquired,
                            dateSold,
                            quantity: values.quantity !== undefined ? parseFloat(values.quantity) || 0 : original.quantity,
                            currency,
                            buyPrice: values.buyPrice !== undefined ? parseFloat(values.buyPrice) || 0 : original.buyPrice,
                            sellPrice: values.sellPrice !== undefined ? parseFloat(values.sellPrice) || 0 : original.sellPrice,
                            fxRateBuy,
                            fxRateSell,
                        });

                        // Fetch missing FX rates on-demand from ECB
                        if (needFetchBuy) {
                            void fetchAndSetFxRate(currency, dateAcquired, rowIndex, 'fxRateBuy');
                        }

                        if (needFetchSell) {
                            void fetchAndSetFxRate(currency, dateSold, rowIndex, 'fxRateSell');
                        }
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
    const brokerInterestWarnings = useMemo(() => buildWarningData('Broker Interest'), [warnings]);

    const [showHoldingsWarningsOnly, setShowHoldingsWarningsOnly] = useState(false);
    const [showSalesWarningsOnly, setShowSalesWarningsOnly] = useState(false);

    const sortedDividends = useMemo(() => {
        const indexed = dividends.map((d, origIdx) => ({ d, origIdx }));

        indexed.sort((a, b) => {
            if (!a.d.symbol) {
                return 1;
            }

            if (!b.d.symbol) {
                return -1;
            }

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
                    onSortingChange={(s) => setTableSorting('dividends', s)}
                    initialSorting={tableSorting.dividends}
                    onAutoFill={handleAutoFill}
                    warningRows={dividendWarningRows.rows}
                    warningMessages={dividendWarningRows.messages}
                    warningCount={dividendWarningRows.rows.size}
                    showWarningsOnly={showDividendWarningsOnly}
                    onToggleWarningsOnly={() => setShowDividendWarningsOnly(!showDividendWarningsOnly)}
                    editRowOnMount={editNewRow}
                    onSaveRow={(sortedIdx, values) => {
                        const item = sortedDividends[sortedIdx];

                        if (!item) {
                            return;
                        }
                        const d = item.d;
                        const currency = values.currency ?? d.currency;
                        const date = values.date ?? d.date;

                        updateDividend(item.origIdx, {
                            ...d,
                            symbol: values.symbol ?? d.symbol,
                            country: values.country ?? d.country,
                            date,
                            currency,
                            grossAmount: values.grossAmount !== undefined ? parseFloat(values.grossAmount) || 0 : d.grossAmount,
                            withholdingTax: values.withholdingTax !== undefined ? parseFloat(values.withholdingTax) || 0 : d.withholdingTax,
                            notes: values.notes ?? d.notes,
                        });
                        void ensureFxRates(currency, date);
                        setEditNewRow(undefined);
                    }}
                    onDeleteRow={(sortedIdx) => {
                        const item = sortedDividends[sortedIdx];

                        if (!item) {
                            return;
                        }
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

    const renderBrokerInterestContent = () => {
        if (brokerInterest.length === 0) {
            return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No data</div>;
        }

        // Clamp sub-tab index
        const subTabIdx = Math.min(activeInterestSubTab, brokerInterest.length - 1);
        const activeBi = brokerInterest[subTabIdx];

        // Calculate totals for active sub-tab
        const netInterest = activeBi.entries.reduce((sum: number, e) => sum + e.amount, 0);
        let netInterestBase = 0;

        activeBi.entries.forEach(entry => {
            const amountStr = toBaseCcy(entry.amount, entry.currency, entry.date);
            const amount = amountStr !== '—' ? parseFloat(amountStr) : 0;

            netInterestBase += amount;
        });
        const tax = netInterestBase * 0.1;

        const footerRow: Record<string, string> = {
            date: t('summary.total'),
            amount: netInterest.toFixed(2),
            amountBase: netInterestBase.toFixed(2),
        };

        return (
            <div>
                {/* Sub-tabs: one per broker+currency */}
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {brokerInterest.map((bi, idx) => (
                        <button
                            key={`${bi.broker}-${bi.currency}`}
                            onClick={() => setActiveInterestSubTab(idx)}
                            style={{
                                padding: '0.4rem 0.8rem',
                                fontSize: '0.85rem',
                                border: `1px solid ${idx === subTabIdx ? 'var(--accent)' : 'var(--border)'}`,
                                borderRadius: '4px',
                                backgroundColor: idx === subTabIdx ? 'var(--accent)' : 'transparent',
                                color: idx === subTabIdx ? 'white' : 'var(--text)',
                                cursor: 'pointer',
                            }}
                        >
                            {bi.broker} {bi.currency} ({bi.entries.length})
                        </button>
                    ))}
                </div>

                {/* Summary for active sub-tab */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '1rem',
                        marginBottom: '1rem',
                        padding: '1rem',
                        backgroundColor: 'var(--bg-secondary)',
                        borderRadius: '4px',
                    }}
                >
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.netInterest')} ({activeBi.currency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{netInterest.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.totalInterest')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{netInterestBase.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.tax10pct')} ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{tax.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('summary.count')}</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{activeBi.entries.length}</div>
                    </div>
                </div>

                <DataTable
                    columns={brokerInterestColumns}
                    data={activeBi.entries}
                    footerRow={footerRow}
                    onSortingChange={(s) => setTableSorting('interest', s)}
                    initialSorting={tableSorting.interest}
                    warningRows={brokerInterestWarnings.rows}
                    warningMessages={brokerInterestWarnings.messages}
                    warningCount={brokerInterestWarnings.rows.size}
                    editRowOnMount={editNewRow}
                    onSaveRow={(rowIndex, values) => {
                        const updated = { ...activeBi };

                        updated.entries = [...updated.entries];
                        updated.entries[rowIndex] = {
                            ...updated.entries[rowIndex],
                            date: values.date ?? updated.entries[rowIndex].date,
                            currency: values.currency ?? updated.entries[rowIndex].currency,
                            description: values.description ?? updated.entries[rowIndex].description,
                            amount: values.amount !== undefined ? parseFloat(values.amount) || 0 : updated.entries[rowIndex].amount,
                        };
                        updateBrokerInterest(subTabIdx, updated);
                        void ensureFxRates(
                            values.currency ?? updated.entries[rowIndex].currency,
                            values.date ?? updated.entries[rowIndex].date,
                        );
                        setEditNewRow(undefined);
                    }}
                    onDeleteRow={(idx) => {
                        const updated = { ...activeBi };

                        updated.entries = updated.entries.filter((_, i) => i !== idx);

                        if (updated.entries.length === 0) {
                            deleteBrokerInterest(subTabIdx);
                            setActiveInterestSubTab(Math.max(0, Math.min(subTabIdx - 1, brokerInterest.length - 2)));
                        } else {
                            updateBrokerInterest(subTabIdx, updated);
                        }
                    }}
                    onAddRow={() => {
                        const newEntry: InterestEntry = {
                            date: '',
                            currency: activeBi.currency,
                            description: '',
                            amount: 0,
                            source: { type: 'Manual' },
                        };
                        const updated = { ...activeBi };

                        updated.entries = [...updated.entries, newEntry];
                        updateBrokerInterest(subTabIdx, updated);
                        setEditNewRow({ index: activeBi.entries.length, nonce: Date.now() });
                    }}
                    addRowLabel={t('button.addInterest')}
                />
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
            case 'brokerInterest':
                return renderBrokerInterestContent();
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

                    if (dismissedWarnings.has(key)) {
                        return false;
                    }

                    if (warningFilter !== 'all' && w.type !== warningFilter) {
                        return false;
                    }

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

                                                                for (const w of typeWarnings) {
                                                                    next.add(`${w.type}:${w.message}`);
                                                                }

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
