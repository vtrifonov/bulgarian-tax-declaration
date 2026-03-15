import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useAppStore } from '../store/app-state';
import { DataTable } from '../components/DataTable';
import type {
    Dividend,
    Holding,
    RevolutInterest,
    RevolutInterestEntry,
    Sale,
    StockYieldEntry,
} from '@bg-tax/core';

type TabType = 'holdings' | 'sales' | 'dividends' | 'stockYield' | 'revolutInterest' | 'fxRates';

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

    const {
        holdings,
        sales,
        dividends,
        stockYield,
        revolutInterest,
        fxRates,
        baseCurrency,
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
        updateRevolutInterest,
        deleteRevolutInterest,
        addRevolutInterest,
    } = useAppStore();

    const getTabs = () => {
        // Always show: Holdings, Sales, Dividends (user can fill manually)
        const tabs = [
            { id: 'holdings', label: 'Holdings', count: holdings.length },
            { id: 'sales', label: 'Sales', count: sales.length },
            { id: 'dividends', label: 'Dividends', count: dividends.length },
        ];
        // Show only if data exists (populated from IB/Revolut import)
        if (stockYield.length > 0) {
            tabs.push({ id: 'stockYield', label: 'Stock Yield', count: stockYield.length });
        }
        if (revolutInterest.length > 0) {
            tabs.push({ id: 'revolutInterest', label: 'Revolut Interest', count: revolutInterest.length });
        }
        if (Object.keys(fxRates).length > 0) {
            tabs.push({ id: 'fxRates', label: 'FX Rates', count: Object.keys(fxRates).length });
        }
        return tabs;
    };

    // Holdings columns
    const holdingsColumns: ColumnDef<Holding>[] = [
        createEditableColumn<Holding>('broker', 'Broker', {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], broker: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('country', 'Country', {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], country: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('symbol', 'Symbol', {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], symbol: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('dateAcquired', 'Date Acquired', {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], dateAcquired: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('quantity', 'Quantity', {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], quantity: parseFloat(value) || 0 };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('currency', 'Currency', {
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], currency: value };
                updateHolding(rowIndex, updated);
            },
        }),
        createEditableColumn<Holding>('unitPrice', 'Unit Price', {
            align: 'right',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...holdings[rowIndex], unitPrice: parseFloat(value) || 0 };
                updateHolding(rowIndex, updated);
            },
        }),
        {
            id: 'totalCcy',
            header: 'Total (ccy)',
            accessorFn: (row: Holding) => (row.quantity * row.unitPrice).toFixed(2),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'fxRate',
            header: 'FX Rate',
            accessorFn: (row: Holding) => getFxRateDisplay(fxRates, baseCurrency, row.currency, row.dateAcquired),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'totalBase',
            header: `Total (${baseCurrency})`,
            accessorFn: (row: Holding) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.quantity * row.unitPrice, row.currency, row.dateAcquired);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        createEditableColumn<Holding>('notes', 'Notes', {
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
                    Delete
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Sales columns
    const salesColumns: ColumnDef<Sale>[] = [
        createEditableColumn<Sale>('broker', 'Broker', {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], broker: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('country', 'Country', {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], country: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('symbol', 'Symbol', {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], symbol: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('dateAcquired', 'Date Acquired', {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], dateAcquired: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('dateSold', 'Date Sold', {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], dateSold: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('quantity', 'Qty', {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], quantity: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('currency', 'Currency', {
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], currency: value };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('buyPrice', 'Buy Price', {
            align: 'right',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], buyPrice: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('sellPrice', 'Sell Price', {
            align: 'right',
            format: (v) => (v as number).toFixed(4),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], sellPrice: parseFloat(value) || 0 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('fxRateBuy', 'FX Rate Buy', {
            align: 'right',
            format: (v) => (v as number).toFixed(6),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], fxRateBuy: parseFloat(value) || 1 };
                updateSale(rowIndex, updated);
            },
        }),
        createEditableColumn<Sale>('fxRateSell', 'FX Rate Sell', {
            align: 'right',
            format: (v) => (v as number).toFixed(6),
            onSave: (rowIndex, value) => {
                const updated = { ...sales[rowIndex], fxRateSell: parseFloat(value) || 1 };
                updateSale(rowIndex, updated);
            },
        }),
        {
            id: 'proceedsBase',
            header: `Proceeds (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.quantity * row.sellPrice, row.currency, row.dateSold);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'costBase',
            header: `Cost (${baseCurrency})`,
            accessorFn: (row: Sale) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.quantity * row.buyPrice, row.currency, row.dateAcquired);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'plBase',
            header: `P/L (${baseCurrency})`,
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
                    Delete
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Dividends columns
    const dividendsColumns: ColumnDef<Dividend>[] = [
        createEditableColumn<Dividend>('symbol', 'Symbol', {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], symbol: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('country', 'Country', {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], country: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('date', 'Date', {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], date: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('currency', 'Currency', {
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], currency: value };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('grossAmount', 'Gross Amount', {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], grossAmount: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('withholdingTax', 'WHT', {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], withholdingTax: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        {
            id: 'fxRate',
            header: 'FX Rate',
            accessorFn: (row: Dividend) => getFxRateDisplay(fxRates, baseCurrency, row.currency, row.date),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'grossBase',
            header: `Gross (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.grossAmount, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'whtBase',
            header: `WHT (${baseCurrency})`,
            accessorFn: (row: Dividend) => {
                const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
                return toBaseCcy(row.withholdingTax, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'tax5pct',
            header: 'Tax (5%)',
            accessorFn: (row: Dividend) => row.grossAmount * 0.05,
            cell: (info) => (info.getValue() as number).toFixed(2),
            meta: { align: 'right' as const, editable: false },
        },
        createEditableColumn<Dividend>('whtCredit', 'WHT Credit', {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], whtCredit: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('bgTaxDue', 'BG Tax Due', {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...dividends[rowIndex], bgTaxDue: parseFloat(value) || 0 };
                updateDividend(rowIndex, updated);
            },
        }),
        createEditableColumn<Dividend>('notes', 'Notes', {
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
                    Delete
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Stock Yield columns
    const stockYieldColumns: ColumnDef<StockYieldEntry>[] = [
        createEditableColumn<StockYieldEntry>('date', 'Date', {
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], date: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('symbol', 'Symbol', {
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], symbol: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('currency', 'Currency', {
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], currency: value };
                updateStockYield(rowIndex, updated);
            },
        }),
        createEditableColumn<StockYieldEntry>('amount', 'Amount', {
            align: 'right',
            format: (v) => (v as number).toFixed(2),
            onSave: (rowIndex, value) => {
                const updated = { ...stockYield[rowIndex], amount: parseFloat(value) || 0 };
                updateStockYield(rowIndex, updated);
            },
        }),
        {
            id: 'fxRate',
            header: 'FX Rate',
            accessorFn: (row: StockYieldEntry) => {
                return getFxRateDisplay(fxRates, baseCurrency, row.currency, row.date);
            },
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `Amount (${baseCurrency})`,
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
                    Delete
                </button>
            ),
            meta: { editable: false },
        },
    ];

    // Revolut Interest Entry columns
    const getRevolutEntryColumns = (currency: string): ColumnDef<RevolutInterestEntry>[] => [
        {
            accessorKey: 'date',
            header: 'Date',
            meta: { editable: true },
        },
        {
            accessorKey: 'description',
            header: 'Description',
            meta: { editable: true },
        },
        {
            accessorKey: 'amount',
            header: `Amount (${currency})`,
            meta: { align: 'right' as const, editable: true },
            cell: (info) => (info.getValue() as number).toFixed(4),
        },
        {
            id: 'fxRate',
            header: 'FX Rate',
            accessorFn: (row: RevolutInterestEntry) => getFxRateDisplay(fxRates, baseCurrency, currency, row.date),
            cell: (info) => info.getValue(),
            meta: { align: 'right' as const, editable: false },
        },
        {
            id: 'amountBase',
            header: `Amount (${baseCurrency})`,
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
            addRowLabel='Add Holding'
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
            addRowLabel='Add Sale'
        />
    );

    const sortedDividends = [...dividends].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));

    const renderDividendsContent = () => (
        <DataTable
            columns={dividendsColumns}
            data={sortedDividends}
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
            addRowLabel='Add Dividend'
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

    const renderRevolutInterestContent = () => {
        const currencies = revolutInterest.map((r) => r.currency).sort();

        if (currencies.length === 0) {
            return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No data</div>;
        }

        if (!revolutTab) {
            setRevolutTab(currencies[0]);
        }

        const currentCurrency = revolutTab || currencies[0];
        const currentData = revolutInterest.find((r) => r.currency === currentCurrency);

        if (!currentData) {
            return <div>Currency not found</div>;
        }

        // Summary row
        const netInterest = currentData.entries.reduce((sum, e) => sum + e.amount, 0);
        const toBaseCcy = createToBaseCcy(fxRates, baseCurrency);
        // Use mid-year date for approximate conversion of totals
        const midDate = `${useAppStore.getState().taxYear}-06-30`;
        const netBase = toBaseCcy(netInterest, currentCurrency, midDate);
        const taxBase = netBase !== '—' ? (parseFloat(netBase) * 0.1).toFixed(2) : '—';
        const tax = netInterest * 0.1;

        return (
            <div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    {currencies.map((curr) => (
                        <button
                            key={curr}
                            onClick={() => setRevolutTab(curr)}
                            style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: currentCurrency === curr ? 'var(--accent)' : 'var(--bg-secondary)',
                                color: currentCurrency === curr ? 'white' : 'var(--text)',
                                border: 'none',
                                cursor: 'pointer',
                                borderRadius: '4px',
                            }}
                        >
                            {curr}
                        </button>
                    ))}
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(6, 1fr)',
                        gap: '1rem',
                        marginBottom: '2rem',
                        padding: '1rem',
                        backgroundColor: 'var(--bg-secondary)',
                        borderRadius: '4px',
                    }}
                >
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Currency</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{currentCurrency}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Entries</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{currentData.entries.length}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Net Interest ({currentCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{netInterest.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Net Interest ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{netBase}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>10% Tax ({currentCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{tax.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>10% Tax ({baseCurrency})</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{taxBase}</div>
                    </div>
                </div>

                <DataTable columns={getRevolutEntryColumns(currentCurrency)} data={currentData.entries} />
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
                header: 'Date',
            },
            {
                accessorKey: 'rate',
                header: 'Rate (to BGN)',
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
            case 'stockYield':
                return renderStockYieldContent();
            case 'revolutInterest':
                return renderRevolutInterestContent();
            case 'fxRates':
                return renderFxRatesContent();
            default:
                return null;
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <h1>Workspace</h1>
            <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
                {getTabs().map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        style={{
                            marginRight: '1rem',
                            padding: '0.5rem 1rem',
                            backgroundColor: activeTab === tab.id ? 'var(--accent)' : 'var(--bg-secondary)',
                            color: activeTab === tab.id ? 'white' : 'var(--text)',
                            border: 'none',
                            cursor: 'pointer',
                        }}
                    >
                        {tab.label} ({tab.count})
                    </button>
                ))}
            </div>
            <div>{renderContent()}</div>
        </div>
    );
}
