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
                        ibInterest: state.ibInterest,
                        revolutInterest: state.revolutInterest,
                        fxRates: state.fxRates,
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

/** Load auto-saved state on app startup. Returns null if nothing saved. */
export function loadAutoSave(): Record<string, unknown> | null {
    try {
        const json = localStorage.getItem(SAVE_KEY);
        if (!json) return null;
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/** Clear auto-saved state */
export function clearAutoSave(): void {
    localStorage.removeItem(SAVE_KEY);
}
