import {
    describe,
    expect,
    it,
} from 'vitest';

// migrateState is the same logic used in useAutoSave.ts — replicated here for unit testing
function migrateState(saved: Record<string, unknown>): Record<string, unknown> {
    const migrated = { ...saved };
    const brokerInterestList: Array<{ broker: string; currency: string; entries: Array<unknown> }> = [];

    if (Array.isArray(saved.ibInterest)) {
        const byCurrency = new Map<string, Array<unknown>>();
        for (const entry of saved.ibInterest) {
            const currency = (entry as { currency?: string }).currency || 'USD';
            if (!byCurrency.has(currency)) {
                byCurrency.set(currency, []);
            }
            byCurrency.get(currency)!.push(entry);
        }
        for (const [currency, entries] of byCurrency) {
            brokerInterestList.push({ broker: 'IB', currency, entries });
        }
    }

    if (Array.isArray(saved.revolutInterest)) {
        for (const revolut of saved.revolutInterest) {
            const r = revolut as { currency?: string; entries?: unknown[] };
            if (r.currency && Array.isArray(r.entries)) {
                brokerInterestList.push({ broker: 'Revolut', currency: r.currency, entries: r.entries });
            }
        }
    }

    if (brokerInterestList.length > 0) {
        migrated.brokerInterest = brokerInterestList;
    } else if (!migrated.brokerInterest) {
        migrated.brokerInterest = [];
    }

    delete migrated.ibInterest;
    delete migrated.revolutInterest;

    return migrated;
}

describe('migrateState (old → new AppState)', () => {
    it('migrates ibInterest to brokerInterest grouped by currency', () => {
        const old = {
            ibInterest: [
                { currency: 'USD', date: '2025-01-06', description: 'Credit', amount: 8.45 },
                { currency: 'EUR', date: '2025-02-10', description: 'Credit', amount: 3.20 },
                { currency: 'USD', date: '2025-02-05', description: 'Debit', amount: -2.87 },
            ],
        };
        const migrated = migrateState(old);
        const bi = migrated.brokerInterest as Array<{ broker: string; currency: string; entries: unknown[] }>;
        expect(bi).toHaveLength(2); // USD + EUR
        const usd = bi.find(b => b.currency === 'USD');
        expect(usd!.broker).toBe('IB');
        expect(usd!.entries).toHaveLength(2);
    });

    it('migrates revolutInterest to brokerInterest', () => {
        const old = {
            revolutInterest: [
                { currency: 'EUR', entries: [{ date: '2025-12-31', description: 'Interest', amount: 0.32 }] },
            ],
        };
        const migrated = migrateState(old);
        const bi = migrated.brokerInterest as Array<{ broker: string }>;
        expect(bi[0].broker).toBe('Revolut');
    });

    it('migrates both ibInterest and revolutInterest together', () => {
        const old = {
            ibInterest: [{ currency: 'USD', date: '2025-01-06', description: 'Credit', amount: 8.45 }],
            revolutInterest: [{ currency: 'EUR', entries: [{ date: '2025-12-31', description: 'Interest', amount: 0.32 }] }],
        };
        const migrated = migrateState(old);
        const bi = migrated.brokerInterest as Array<unknown>;
        expect(bi).toHaveLength(2);
        expect(migrated.ibInterest).toBeUndefined();
        expect(migrated.revolutInterest).toBeUndefined();
    });

    it('handles state with neither ibInterest nor revolutInterest', () => {
        const old = { holdings: [], sales: [] };
        const migrated = migrateState(old);
        expect(migrated.brokerInterest).toEqual([]);
    });

    it('does not re-migrate already migrated state', () => {
        const already = { brokerInterest: [{ broker: 'IB', currency: 'USD', entries: [] }] };
        const migrated = migrateState(already);
        const bi = migrated.brokerInterest as Array<unknown>;
        expect(bi).toHaveLength(1);
    });

    it('preserves all entry fields during migration', () => {
        const old = {
            ibInterest: [
                { currency: 'USD', date: '2025-03-06', description: 'USD Credit Interest for 02/2025', amount: 8.45, source: { type: 'IB', file: 'ib.csv' } },
            ],
        };
        const migrated = migrateState(old);
        const bi = migrated.brokerInterest as Array<{ entries: Array<{ date: string; description: string; amount: number; source: unknown }> }>;
        const entry = bi[0].entries[0];
        expect(entry.date).toBe('2025-03-06');
        expect(entry.description).toBe('USD Credit Interest for 02/2025');
        expect(entry.amount).toBe(8.45);
        expect(entry.source).toEqual({ type: 'IB', file: 'ib.csv' });
    });

    it('handles partial old state: only ibInterest, no revolutInterest', () => {
        const old = { ibInterest: [{ currency: 'USD', date: '2025-01-06', description: 'Credit', amount: 5 }] };
        const migrated = migrateState(old);
        const bi = migrated.brokerInterest as Array<{ broker: string }>;
        expect(bi).toHaveLength(1);
        expect(bi[0].broker).toBe('IB');
    });

    it('handles malformed ibInterest entries (null/undefined fields)', () => {
        const old = { ibInterest: [{ currency: null, date: undefined, description: '', amount: 0 }] };
        const migrated = migrateState(old);
        const bi = migrated.brokerInterest as Array<{ entries: unknown[] }>;
        expect(bi).toHaveLength(1); // grouped under null currency
        expect(bi[0].entries).toHaveLength(1);
    });

    it('handles revolutInterest with empty entries array', () => {
        const old = { revolutInterest: [{ currency: 'EUR', entries: [] }] };
        const migrated = migrateState(old);
        const bi = migrated.brokerInterest as Array<{ entries: unknown[] }>;
        expect(bi).toHaveLength(1);
        expect(bi[0].entries).toHaveLength(0);
    });

    it('handles very old schema with no interest fields at all', () => {
        const old = { holdings: [{ symbol: 'AAPL' }], taxYear: 2024 };
        const migrated = migrateState(old);
        expect(migrated.brokerInterest).toEqual([]);
        expect(migrated.holdings).toEqual([{ symbol: 'AAPL' }]);
        expect(migrated.taxYear).toBe(2024);
    });
});
