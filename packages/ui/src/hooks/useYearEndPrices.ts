import {
    get,
    set,
} from 'idb-keyval';
import {
    useCallback,
    useEffect,
} from 'react';

import { useAppStore } from '../store/app-state';

const IDB_KEY = 'bg-tax-year-end-prices';

/**
 * Persist year-end prices in a separate IndexedDB key (survives data clears).
 * Prices are keyed by ISIN (not year-scoped — we only store the latest fetch).
 */
export function useYearEndPrices() {
    const yearEndPrices = useAppStore(s => s.yearEndPrices);
    const setYearEndPrices = useAppStore(s => s.setYearEndPrices);

    // Load prices from IndexedDB on mount
    useEffect(() => {
        void get<Record<string, number>>(IDB_KEY).then((saved) => {
            if (saved && Object.keys(saved).length > 0) {
                setYearEndPrices(saved);
            }
        });
    }, [setYearEndPrices]);

    // Save prices to IndexedDB when they change
    const savePrices = useCallback((prices: Record<string, number>) => {
        setYearEndPrices(prices);
        void set(IDB_KEY, prices);
    }, [setYearEndPrices]);

    return { yearEndPrices, setYearEndPrices: savePrices };
}
