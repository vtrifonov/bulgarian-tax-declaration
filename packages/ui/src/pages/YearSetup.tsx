import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-state';

export function YearSetup() {
  const navigate = useNavigate();
  const { taxYear, baseCurrency, setTaxYear, setBaseCurrency } = useAppStore();

  const handleContinue = () => {
    navigate('/import');
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Year Setup</h1>
      <div style={{ marginBottom: '1rem' }}>
        <label>
          Tax Year:
          <input
            type="number"
            value={taxYear}
            onChange={(e) => setTaxYear(parseInt(e.target.value))}
            style={{ marginLeft: '0.5rem' }}
          />
        </label>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label>
          Base Currency:
          <select
            value={baseCurrency}
            onChange={(e) => setBaseCurrency(e.target.value as 'BGN' | 'EUR')}
            style={{ marginLeft: '0.5rem' }}
          >
            <option value="BGN">BGN</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
      </div>
      <button onClick={handleContinue}>Continue to Import</button>
    </div>
  );
}
