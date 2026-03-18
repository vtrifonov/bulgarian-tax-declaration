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
                        tableSorting: state.tableSorting,
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

interface SavedInterestEntry {
    currency: string;
    date: string;
    description: string;
    amount: number;
}

interface SavedBrokerInterest {
    broker: string;
    currency: string;
    entries: SavedInterestEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null;
}

/** Migrate old autosave format to new unified brokerInterest model */
function migrateState(saved: Record<string, unknown>): Record<string, unknown> {
    const migrated = { ...saved };
    const brokerInterestList: SavedBrokerInterest[] = [];

    // Migrate ibInterest (array of InterestEntry with source field) → grouped by currency
    if (Array.isArray(saved.ibInterest)) {
        const ibByCurrency = new Map<string, SavedInterestEntry[]>();

        for (const entry of saved.ibInterest) {
            if (!isRecord(entry)) {
                continue;
            }
            const currency = typeof entry.currency === 'string' ? entry.currency : 'USD';

            if (!ibByCurrency.has(currency)) {
                ibByCurrency.set(currency, []);
            }
            ibByCurrency.get(currency)!.push(entry as unknown as SavedInterestEntry);
        }

        for (const [currency, entries] of ibByCurrency) {
            brokerInterestList.push({ broker: 'IB', currency, entries });
        }
    }

    // Migrate revolutInterest (array of {currency, entries})
    if (Array.isArray(saved.revolutInterest)) {
        for (const item of saved.revolutInterest) {
            if (!isRecord(item)) {
                continue;
            }

            if (typeof item.currency === 'string' && Array.isArray(item.entries)) {
                brokerInterestList.push({
                    broker: 'Revolut',
                    currency: item.currency,
                    entries: item.entries as SavedInterestEntry[],
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

        if (!json) {
            return null;
        }
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
