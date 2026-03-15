import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-state';

export function YearSetup() {
  const navigate = useNavigate();
  const { taxYear, baseCurrency, setTaxYear, setBaseCurrency } = useAppStore();

  const handleYearChange = (year: number) => {
    setTaxYear(year);
    // Auto-determine base currency from year
    setBaseCurrency(year <= 2025 ? 'BGN' : 'EUR');
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '500px' }}>
      <h1>Year Setup</h1>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
          Tax Year (Данъчна година)
        </label>
        <input
          type="number"
          value={taxYear}
          onChange={(e) => handleYearChange(parseInt(e.target.value))}
          min={2020}
          max={2030}
          style={{ padding: '0.5rem', fontSize: '1rem', width: '120px' }}
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
          Base Currency (Базова валута)
        </label>
        <div style={{
          padding: '0.5rem 1rem',
          backgroundColor: '#f0f0f0',
          borderRadius: '4px',
          display: 'inline-block',
          fontSize: '1rem',
        }}>
          {baseCurrency}
          <span style={{ marginLeft: '0.5rem', color: '#666', fontSize: '0.85rem' }}>
            {baseCurrency === 'BGN' ? '(fixed for ≤2025)' : '(fixed for ≥2026)'}
          </span>
        </div>
      </div>

      <button
        onClick={() => navigate('/import')}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Continue to Import
      </button>
    </div>
  );
}
