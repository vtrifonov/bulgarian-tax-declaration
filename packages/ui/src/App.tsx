import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useAppStore } from './store/app-state';
import { YearSetup } from './pages/YearSetup';
import { Import } from './pages/Import';
import { Workspace } from './pages/Workspace';
import { Declaration } from './pages/Declaration';
import './App.css';

const steps = [
  { path: '/', label: 'Setup', name: 'setup' },
  { path: '/import', label: 'Import', name: 'import' },
  { path: '/workspace', label: 'Workspace', name: 'workspace' },
  { path: '/declaration', label: 'Declaration', name: 'declaration' },
];

function Layout() {
  const location = useLocation();
  const { language, setLanguage } = useAppStore();

  const currentStepIndex = steps.findIndex((step) => step.path === location.pathname);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <nav
        style={{
          backgroundColor: '#f0f0f0',
          padding: '1rem',
          borderBottom: '1px solid #ccc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Bulgarian Tax Declaration</h2>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {steps.map((step, idx) => (
              <div key={step.name}>
                <Link
                  to={step.path}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: idx <= currentStepIndex ? '#007bff' : '#e0e0e0',
                    color: idx <= currentStepIndex ? 'white' : '#666',
                    textDecoration: 'none',
                    cursor: 'pointer',
                    borderRadius: '4px',
                  }}
                >
                  {step.label}
                </Link>
              </div>
            ))}
          </div>

          <button
            onClick={() => setLanguage(language === 'en' ? 'bg' : 'en')}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: language === 'bg' ? '#28a745' : '#fff',
              color: language === 'bg' ? '#fff' : '#333',
              border: '1px solid #ccc',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: 'bold',
              minWidth: '80px',
            }}
          >
            {language === 'en' ? '🇧🇬 BG' : '🇬🇧 EN'}
          </button>
        </div>
      </nav>

      <main style={{ flex: 1, padding: '0' }}>
        <Routes>
          <Route path="/" element={<YearSetup />} />
          <Route path="/import" element={<Import />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/declaration" element={<Declaration />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}

export default App;
