import { useState } from 'react';
import { useAppStore } from '../store/app-state';

type TabType = 'holdings' | 'sales' | 'dividends' | 'stockYield' | 'revolutInterest' | 'fxRates';

export function Workspace() {
  const [activeTab, setActiveTab] = useState<TabType>('holdings');
  const { holdings, sales, dividends, stockYield, revolutInterest, fxRates } = useAppStore();

  const getTabs = () => [
    { id: 'holdings', label: 'Holdings', count: holdings.length },
    { id: 'sales', label: 'Sales', count: sales.length },
    { id: 'dividends', label: 'Dividends', count: dividends.length },
    { id: 'stockYield', label: 'Stock Yield', count: stockYield.length },
    { id: 'revolutInterest', label: 'Revolut Interest', count: revolutInterest.length },
    { id: 'fxRates', label: 'FX Rates', count: Object.keys(fxRates).length },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'holdings':
        return <div>{holdings.length} holdings loaded</div>;
      case 'sales':
        return <div>{sales.length} sales loaded</div>;
      case 'dividends':
        return <div>{dividends.length} dividends loaded</div>;
      case 'stockYield':
        return <div>{stockYield.length} stock yield records loaded</div>;
      case 'revolutInterest':
        return <div>{revolutInterest.length} Revolut interest records loaded</div>;
      case 'fxRates':
        return <div>{Object.keys(fxRates).length} currencies with FX rates loaded</div>;
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
