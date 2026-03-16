import { useEffect } from 'react';
import {
    HashRouter,
    Link,
    Route,
    Routes,
    useLocation,
} from 'react-router-dom';
import { useAppStore } from './store/app-state';
import {
    loadAutoSave,
    useAutoSave,
} from './hooks/useAutoSave';
import { YearSetup } from './pages/YearSetup';
import { Import } from './pages/Import';
import { Workspace } from './pages/Workspace';
import { Declaration } from './pages/Declaration';
import {
    generateExcel,
    setLanguage as setCoreLanguage,
    t,
} from '@bg-tax/core';
import {
    AuthProvider,
    useAuth,
} from './auth/AuthProvider';
import { AuthGate } from './auth/AuthGate';
import './App.css';

const steps = [
    { path: '/', labelKey: 'page.setup', name: 'setup' },
    { path: '/import', labelKey: 'page.import', name: 'import' },
    { path: '/workspace', labelKey: 'page.workspace', name: 'workspace' },
    { path: '/declaration', labelKey: 'page.declaration', name: 'declaration' },
];

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

function Layout() {
    const location = useLocation();
    const { language, setLanguage } = useAppStore();
    const { user, signOut } = useAuth();

    // Auto-save state to localStorage
    useAutoSave();

    // Load saved state on startup
    useEffect(() => {
        const saved = loadAutoSave();
        if (saved) {
            const store = useAppStore.getState();
            if (saved.holdings) store.importHoldings(saved.holdings as any);
            if (saved.sales) store.importSales(saved.sales as any);
            if (saved.dividends) store.importDividends(saved.dividends as any);
            if (saved.stockYield) store.importStockYield(saved.stockYield as any);
            if (saved.ibInterest) store.importIbInterest(saved.ibInterest as any);
            if (saved.revolutInterest) store.importRevolutInterest(saved.revolutInterest as any);
            if (saved.fxRates) store.setFxRates(saved.fxRates as any);
            if (saved.taxYear) store.setTaxYear(saved.taxYear as number);
            if (saved.language) {
                store.setLanguage(saved.language as 'en' | 'bg');
                setCoreLanguage(saved.language as 'en' | 'bg');
            }
        }
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key === 'e') {
                e.preventDefault();
                // Export Excel
                const state = useAppStore.getState();
                generateExcel({
                    ...state,
                    language: 'en',
                    ibInterest: state.ibInterest || [],
                    manualEntries: [],
                }).then(buffer => {
                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Данъчна ${state.taxYear}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                }).catch(err => console.error('Export failed:', err));
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const currentStepIndex = steps.findIndex((step) => step.path === location.pathname);

    const handleLanguageToggle = () => {
        const newLanguage = language === 'en' ? 'bg' : 'en';
        setLanguage(newLanguage);
        setCoreLanguage(newLanguage);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav
                style={{
                    backgroundColor: 'var(--nav-bg)',
                    padding: '1rem',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap', fontSize: '1.1rem' }}>
                    <img src='/favicon.png' alt='' width={22} height={22} />
                    {t('app.title')}
                </h2>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'nowrap' }}>
                    {steps.map((step, idx) => (
                        <Link
                            key={step.name}
                            to={step.path}
                            style={{
                                padding: '0.4rem 0.75rem',
                                backgroundColor: idx <= currentStepIndex ? 'var(--accent)' : 'var(--bg-secondary)',
                                color: idx <= currentStepIndex ? 'white' : 'var(--text-secondary)',
                                textDecoration: 'none',
                                cursor: 'pointer',
                                borderRadius: '4px',
                                fontSize: '0.9rem',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {t(step.labelKey)}
                        </Link>
                    ))}

                    <button
                        onClick={handleLanguageToggle}
                        style={{
                            padding: '0.4rem 0.75rem',
                            backgroundColor: language === 'bg' ? '#28a745' : 'var(--bg)',
                            color: language === 'bg' ? '#fff' : 'var(--text)',
                            border: '1px solid var(--border)',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            fontSize: '0.85rem',
                        }}
                    >
                        {language === 'en' ? 'BG' : 'EN'}
                    </button>

                    {!isTauri && user && (
                        <button
                            onClick={signOut}
                            title={user.email ?? ''}
                            style={{
                                padding: '0.4rem 0.75rem',
                                backgroundColor: 'var(--bg)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border)',
                                cursor: 'pointer',
                                borderRadius: '4px',
                                fontSize: '0.85rem',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {t('button.signOut')}
                        </button>
                    )}
                </div>
            </nav>

            <main style={{ flex: 1 }}>
                <Routes>
                    <Route path='/' element={<YearSetup />} />
                    <Route path='/import' element={<Import />} />
                    <Route path='/workspace' element={<Workspace />} />
                    <Route path='/declaration' element={<Declaration />} />
                </Routes>
            </main>
        </div>
    );
}

function App() {
    return (
        <AuthProvider>
            <AuthGate>
                <HashRouter>
                    <Layout />
                </HashRouter>
            </AuthGate>
        </AuthProvider>
    );
}

export default App;
