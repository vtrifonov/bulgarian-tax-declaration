/**
 * Cache interface — UI layer provides the actual file I/O implementation.
 * This allows flexible caching backends (file system, localStorage, etc.).
 */
export interface FxCache {
    get(currency: string, year: number): Promise<Record<string, number> | null>;
    set(currency: string, year: number, rates: Record<string, number>): Promise<void>;
}

/**
 * In-memory cache for testing and as fallback.
 * Stores rates in a simple Map with no persistence.
 */
export class InMemoryFxCache implements FxCache {
    private store = new Map<string, Record<string, number>>();

    async get(currency: string, year: number): Promise<Record<string, number> | null> {
        return this.store.get(`${currency}-${year}`) ?? null;
    }

    async set(currency: string, year: number, rates: Record<string, number>): Promise<void> {
        this.store.set(`${currency}-${year}`, rates);
    }
}
