import {
    get,
    set,
} from 'idb-keyval';
import {
    useEffect,
    useRef,
} from 'react';

import { useAppStore } from '../store/app-state';

const IDB_KEY = 'bg-tax-fx-rates';
const SAVE_DEBOUNCE_MS = 5000;

/**
 * Persist FX rates in a separate IndexedDB key (survives data clears).
 * Loads on mount, saves periodically when rates change.
 */
export function usePersistentFxRates() {
    const setFxRates = useAppStore(s => s.setFxRates);
    const loaded = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    // Load from IndexedDB on mount (once)
    useEffect(() => {
        void get<Record<string, Record<string, number>>>(IDB_KEY).then((saved) => {
            if (saved && Object.keys(saved).length > 0) {
                const current = useAppStore.getState().fxRates;
                const merged: Record<string, Record<string, number>> = { ...saved };

                for (const [ccy, dates] of Object.entries(current)) {
                    merged[ccy] = { ...merged[ccy], ...dates };
                }

                setFxRates(merged);
            }

            loaded.current = true;
        });
    }, [setFxRates]);

    // Debounced save — subscribe to store changes directly (avoids re-render loop)
    useEffect(() => {
        const unsubscribe = useAppStore.subscribe((state) => {
            if (!loaded.current) {
                return;
            }

            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
                if (Object.keys(state.fxRates).length > 0) {
                    void set(IDB_KEY, state.fxRates);
                }
            }, SAVE_DEBOUNCE_MS);
        });

        return () => {
            clearTimeout(saveTimer.current);
            unsubscribe();
        };
    }, []);
}
