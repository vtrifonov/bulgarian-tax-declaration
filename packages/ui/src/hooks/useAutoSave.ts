import {
    useEffect,
    useRef,
} from 'react';

import {
    decryptPersonalData,
    encryptPersonalData,
    isEncrypted,
} from '../crypto';
import { useAppStore } from '../store/app-state';

const SAVE_KEY = 'bg-tax-autosave';
const DEBOUNCE_MS = 2000;
const MAX_SAVE_SIZE = 4 * 1024 * 1024; // 4MB safety limit

/** Auto-save data to localStorage using Zustand subscribe */
export function useAutoSave() {
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        const unsubscribe = useAppStore.subscribe((state) => {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                void (async () => {
                    let encryptedPersonal: string | undefined;

                    try {
                        // Encrypt personal data before saving
                        const personalData = state.spb8PersonalData;

                        if (personalData && Object.keys(personalData).length > 0) {
                            try {
                                encryptedPersonal = await encryptPersonalData(JSON.stringify(personalData));
                            } catch (err) {
                                console.error('Personal data encryption failed:', err);
                            }
                        }

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
                            foreignAccounts: state.foreignAccounts,
                            spb8PersonalData: encryptedPersonal,
                            yearEndPrices: state.yearEndPrices,
                        };

                        const json = JSON.stringify(data);

                        if (json.length > MAX_SAVE_SIZE) {
                            const slim = { ...data, fxRates: {} };

                            localStorage.setItem(SAVE_KEY, JSON.stringify(slim));
                        } else {
                            localStorage.setItem(SAVE_KEY, json);
                        }
                    } catch {
                        // Quota exceeded — try without fxRates, but keep encrypted personal data
                        try {
                            const state2 = useAppStore.getState();
                            const slim = {
                                taxYear: state2.taxYear,
                                baseCurrency: state2.baseCurrency,
                                language: state2.language,
                                holdings: state2.holdings,
                                sales: state2.sales,
                                dividends: state2.dividends,
                                stockYield: state2.stockYield,
                                brokerInterest: state2.brokerInterest,
                                fxRates: {},
                                importedFiles: state2.importedFiles,
                                tableSorting: state2.tableSorting,
                                foreignAccounts: state2.foreignAccounts,
                                spb8PersonalData: encryptedPersonal,
                                yearEndPrices: state2.yearEndPrices,
                            };

                            localStorage.removeItem(SAVE_KEY);
                            localStorage.setItem(SAVE_KEY, JSON.stringify(slim));
                        } catch (err) {
                            console.error('Auto-save failed:', err);
                        }
                    }
                })();
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

    migrated.brokerInterest = brokerInterestList.length > 0 ? brokerInterestList : [];

    delete migrated.ibInterest;
    delete migrated.revolutInterest;

    return migrated;
}

/** Load auto-saved state on app startup. Returns null if nothing saved. */
export async function loadAutoSave(): Promise<Record<string, unknown> | null> {
    try {
        const json = localStorage.getItem(SAVE_KEY);

        if (!json) {
            return null;
        }
        const saved = JSON.parse(json);
        const migrated = migrateState(saved);

        // Decrypt personal data if encrypted
        if (isEncrypted(migrated.spb8PersonalData)) {
            try {
                const decrypted = await decryptPersonalData(migrated.spb8PersonalData);

                migrated.spb8PersonalData = JSON.parse(decrypted);
            } catch (err) {
                console.error('Personal data decryption failed:', err);
                migrated.spb8PersonalData = undefined;
            }
        }

        return migrated;
    } catch {
        return null;
    }
}

/** Clear auto-saved state */
export function clearAutoSave(): void {
    localStorage.removeItem(SAVE_KEY);
}
