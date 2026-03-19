import {
    getCountryCache,
    restoreCountryCache,
} from '@bg-tax/core';
import {
    get,
    set,
} from 'idb-keyval';
import {
    useEffect,
    useRef,
} from 'react';

import { useAppStore } from '../store/app-state';

const IDB_KEY = 'bg-tax-country-cache';
const SAVE_INTERVAL_MS = 10_000; // Save every 10s if cache changed

/**
 * Persist the OpenFIGI country resolution cache in IndexedDB.
 * Restores on mount so previously resolved symbols don't need API calls.
 */
export function usePersistentCountryCache() {
    const holdings = useAppStore(s => s.holdings);
    const lastSavedSize = useRef(0);

    // Restore cache from IndexedDB on mount
    useEffect(() => {
        void get<Record<string, string>>(IDB_KEY).then((saved) => {
            if (saved && Object.keys(saved).length > 0) {
                restoreCountryCache(saved);
                lastSavedSize.current = Object.keys(saved).length;
            }
        });
    }, []);

    // Periodically save cache if it has grown (new symbols resolved)
    useEffect(() => {
        const interval = setInterval(() => {
            const cache = getCountryCache();
            const size = Object.keys(cache).length;

            if (size > lastSavedSize.current) {
                void set(IDB_KEY, cache);
                lastSavedSize.current = size;
            }
        }, SAVE_INTERVAL_MS);

        return () => clearInterval(interval);
    }, []);

    // Also save when holdings change (likely after an import that resolved countries)
    useEffect(() => {
        const cache = getCountryCache();

        if (Object.keys(cache).length > 0) {
            void set(IDB_KEY, cache);
            lastSavedSize.current = Object.keys(cache).length;
        }
    }, [holdings]);
}
