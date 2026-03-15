import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useAppStore } from '../store/app-state';
import { DataTable } from '../components/DataTable';
import type {
  Holding,
  Sale,
  Dividend,
  StockYieldEntry,
  RevolutInterest,
  RevolutInterestEntry,
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
  }
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

  const getTabs = () => [
    { id: 'holdings', label: 'Holdings', count: holdings.length },
    { id: 'sales', label: 'Sales', count: sales.length },
    { id: 'dividends', label: 'Dividends', count: dividends.length },
    { id: 'stockYield', label: 'Stock Yield', count: stockYield.length },
    { id: 'revolutInterest', label: 'Revolut Interest', count: revolutInterest.length },
    { id: 'fxRates', label: 'FX Rates', count: Object.keys(fxRates).length },
  ];

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
          className="delete-button"
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
      id: 'delete',
      header: '',
      cell: ({ row }) => (
        <button
          className="delete-button"
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
          className="delete-button"
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
      id: 'delete',
      header: '',
      cell: ({ row }) => (
        <button
          className="delete-button"
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
  const revolutEntryColumns: ColumnDef<RevolutInterestEntry>[] = [
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
      header: 'Amount',
      meta: { align: 'right', editable: true },
      cell: (info) => (info.getValue() as number).toFixed(2),
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
      addRowLabel="Add Holding"
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
      addRowLabel="Add Sale"
    />
  );

  const renderDividendsContent = () => (
    <DataTable
      columns={dividendsColumns}
      data={dividends}
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
      addRowLabel="Add Dividend"
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
      addRowLabel="Add Stock Yield Entry"
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
            gridTemplateColumns: 'repeat(4, 1fr)',
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
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Net Interest</div>
            <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{netInterest.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>10% Tax</div>
            <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{tax.toFixed(2)}</div>
          </div>
        </div>

        <DataTable columns={revolutEntryColumns} data={currentData.entries} />
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
