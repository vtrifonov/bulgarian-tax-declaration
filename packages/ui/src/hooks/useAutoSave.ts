import {
    useEffect,
    useRef,
} from 'react';
import { useAppStore } from '../store/app-state';

const SAVE_KEY = 'bg-tax-autosave';
const DEBOUNCE_MS = 2000;

/** Auto-save data (not actions) to localStorage, debounced */
export function useAutoSave() {
    const timerRef = useRef<ReturnType<typeof setTimeout>>();
    const {
        taxYear,
        baseCurrency,
        language,
        holdings,
        sales,
        dividends,
        stockYield,
        revolutInterest,
        fxRates,
    } = useAppStore();

    useEffect(() => {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            try {
                const data = { taxYear, baseCurrency, language, holdings, sales, dividends, stockYield, revolutInterest, fxRates };
                localStorage.setItem(SAVE_KEY, JSON.stringify(data));
            } catch (err) {
                console.error('Auto-save failed:', err);
            }
        }, DEBOUNCE_MS);
        return () => clearTimeout(timerRef.current);
    }, [taxYear, baseCurrency, language, holdings, sales, dividends, stockYield, revolutInterest, fxRates]);
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
