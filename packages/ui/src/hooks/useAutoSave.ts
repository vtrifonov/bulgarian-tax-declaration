import {
    useEffect,
    useRef,
} from 'react';
import { useAppStore } from '../store/app-state';

const SAVE_KEY = 'bg-tax-autosave';
const DEBOUNCE_MS = 2000;

/** Auto-save data to localStorage using Zustand subscribe — no manual dep array needed */
export function useAutoSave() {
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        const unsubscribe = useAppStore.subscribe((state) => {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                try {
                    const data = {
                        taxYear: state.taxYear,
                        baseCurrency: state.baseCurrency,
                        language: state.language,
                        holdings: state.holdings,
                        sales: state.sales,
                        dividends: state.dividends,
                        stockYield: state.stockYield,
                        brokerInterest: state.brokerInterest,
                        fxRates: state.fxRates,
                        importedFiles: state.importedFiles,
                    };
                    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
                } catch (err) {
                    console.error('Auto-save failed:', err);
                }
            }, DEBOUNCE_MS);
        });
        return () => {
            clearTimeout(timerRef.current);
            unsubscribe();
        };
    }, []);
}

/** Migrate old autosave format to new unified brokerInterest model */
function migrateState(saved: Record<string, unknown>): Record<string, unknown> {
    const migrated = { ...saved };
    const brokerInterestList: Array<{ broker: string; currency: string; entries: Array<any> }> = [];

    // Migrate ibInterest (array of InterestEntry with source field) → grouped by currency
    if (Array.isArray(saved.ibInterest)) {
        const ibByCurrency = new Map<string, Array<any>>();

        for (const entry of saved.ibInterest) {
            const currency = (entry as any).currency || 'USD';

            if (!ibByCurrency.has(currency)) {
                ibByCurrency.set(currency, []);
            }
            ibByCurrency.get(currency)!.push(entry);
        }

        for (const [currency, entries] of ibByCurrency) {
            brokerInterestList.push({ broker: 'IB', currency, entries });
        }
    }

    // Migrate revolutInterest (array of {currency, entries})
    if (Array.isArray(saved.revolutInterest)) {
        for (const item of saved.revolutInterest) {
            const revolut = item as any;

            if (revolut.currency && Array.isArray(revolut.entries)) {
                brokerInterestList.push({
                    broker: 'Revolut',
                    currency: revolut.currency,
                    entries: revolut.entries,
                });
            }
        }
    }

    // Replace old fields with new unified brokerInterest
    migrated.brokerInterest = brokerInterestList.length > 0 ? brokerInterestList : [];

    delete migrated.ibInterest;
    delete migrated.revolutInterest;

    return migrated;
}

/** Load auto-saved state on app startup. Returns null if nothing saved. */
export function loadAutoSave(): Record<string, unknown> | null {
    try {
        const json = localStorage.getItem(SAVE_KEY);
        if (!json) return null;
        const saved = JSON.parse(json);
        return migrateState(saved);
    } catch {
        return null;
    }
}

/** Clear auto-saved state */
export function clearAutoSave(): void {
    localStorage.removeItem(SAVE_KEY);
}
