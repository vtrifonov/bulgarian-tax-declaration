import {
    generateExcel,
    setLanguage as setCoreLanguage,
    t,
} from '@bg-tax/core';
import type {
    BrokerInterest,
    Dividend,
    ForeignAccountBalance,
    Holding,
    Sale,
    Spb8PersonalData,
    StockYieldEntry,
} from '@bg-tax/core';
import { useEffect } from 'react';
import {
    HashRouter,
    Link,
    Route,
    Routes,
    useLocation,
} from 'react-router-dom';

import { AuthGate } from './auth/AuthGate';
import {
    AuthProvider,
    useAuth,
} from './auth/AuthProvider';
import {
    loadAutoSave,
    useAutoSave,
} from './hooks/useAutoSave';
import { Declaration } from './pages/Declaration';
import { Import } from './pages/Import';
import { Spb8 } from './pages/Spb8';
import { Workspace } from './pages/Workspace';
import { YearSetup } from './pages/YearSetup';
import {
    applySorting,
    type ImportedFile,
    useAppStore,
} from './store/app-state';
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
    const language = useAppStore(s => s.language);
    const setLanguage = useAppStore(s => s.setLanguage);
    const holdings = useAppStore(s => s.holdings);
    const foreignAccounts = useAppStore(s => s.foreignAccounts);
    const { user, signOut } = useAuth();

    // Auto-save state to IndexedDB
    useAutoSave();

    // Load saved state on startup
    useEffect(() => {
        // Skip auto-load if ?reset is in the URL (emergency escape hatch)
        if (window.location.search.includes('reset') || window.location.hash.includes('reset')) {
            localStorage.clear();
            console.log('All data cleared via ?reset');
            window.location.href = window.location.pathname;

            return;
        }

        void (async () => {
            const saved = await loadAutoSave();

            if (!saved) {
                return;
            }

            const store = useAppStore.getState();

            if (saved.taxYear) {
                store.setTaxYear(saved.taxYear as number);
            }

            if (saved.language) {
                store.setLanguage(saved.language as 'en' | 'bg');
                setCoreLanguage(saved.language as 'en' | 'bg');
            }

            if (saved.holdings) {
                store.importHoldings(saved.holdings as Holding[]);
            }

            if (saved.sales) {
                store.importSales(saved.sales as Sale[]);
            }

            if (saved.dividends) {
                store.importDividends(saved.dividends as Dividend[]);
            }

            if (saved.stockYield) {
                store.importStockYield(saved.stockYield as StockYieldEntry[]);
            }

            if (saved.brokerInterest) {
                store.importBrokerInterest(saved.brokerInterest as BrokerInterest[]);
            }

            if (saved.importedFiles && Array.isArray(saved.importedFiles)) {
                for (const f of saved.importedFiles as ImportedFile[]) {
                    store.addImportedFile(f);
                }
            }

            if (saved.fxRates) {
                store.setFxRates(saved.fxRates as Record<string, Record<string, number>>);
            }

            if (saved.tableSorting && typeof saved.tableSorting === 'object') {
                for (const [table, sorting] of Object.entries(saved.tableSorting as Record<string, { id: string; desc: boolean }[]>)) {
                    store.setTableSorting(table, sorting);
                }
            }

            if (saved.foreignAccounts && Array.isArray(saved.foreignAccounts)) {
                store.setForeignAccounts(saved.foreignAccounts as ForeignAccountBalance[]);
            }

            if (saved.spb8PersonalData) {
                store.setSpb8PersonalData(saved.spb8PersonalData as Spb8PersonalData);
            }

            if (saved.yearEndPrices && typeof saved.yearEndPrices === 'object') {
                store.setYearEndPrices(saved.yearEndPrices as Record<string, number>);
            }
        })();
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;

            // Cmd+Shift+Backspace or Cmd+Shift+K: clear all cached data (emergency reset)
            if (mod && e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'k')) {
                e.preventDefault();
                localStorage.clear();
                window.location.reload();

                return;
            }

            if (mod && e.key === 'e') {
                e.preventDefault();
                // Export Excel
                const state = useAppStore.getState();
                const ts = state.tableSorting;

                generateExcel({
                    ...state,
                    holdings: applySorting(state.holdings, ts.holdings ?? []),
                    sales: applySorting(state.sales, ts.sales ?? []),
                    dividends: applySorting(state.dividends, ts.dividends ?? []),
                    language: 'en',
                    manualEntries: [],
                    foreignAccounts: state.foreignAccounts,
                    spb8PersonalData: state.spb8PersonalData,
                    yearEndPrices: state.yearEndPrices,
                }).then(buffer => {
                    const blob = new Blob([buffer.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
        try {
            localStorage.setItem('bg-tax-language', newLanguage);
        } catch { /* localStorage may be unavailable */ }
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
                                padding: '0.5rem 1.5rem',
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

                    {(holdings.length > 0 || (foreignAccounts?.length ?? 0) > 0) && (
                        <Link
                            to='/spb8'
                            style={{
                                padding: '0.5rem 1.5rem',
                                backgroundColor: location.pathname === '/spb8' ? 'var(--accent)' : 'var(--bg-secondary)',
                                color: location.pathname === '/spb8' ? 'white' : 'var(--text-secondary)',
                                textDecoration: 'none',
                                cursor: 'pointer',
                                borderRadius: '4px',
                                fontSize: '0.9rem',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {t('nav.spb8')}
                        </Link>
                    )}

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
                                padding: '0.5rem 1.5rem',
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
                    <Route path='/spb8' element={<Spb8 />} />
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
