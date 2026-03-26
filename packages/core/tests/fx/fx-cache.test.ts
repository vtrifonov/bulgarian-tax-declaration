import {
    describe,
    expect,
    it,
} from 'vitest';

import { InMemoryFxCache } from '../../src/fx/fx-cache.js';

describe('InMemoryFxCache', () => {
    it('returns null for missing currency', async () => {
        const cache = new InMemoryFxCache();

        expect(await cache.get('USD', 2025)).toBeNull();
    });

    it('stores and retrieves rates', async () => {
        const cache = new InMemoryFxCache();
        const rates = { '2025-01-02': 1.0353, '2025-01-03': 1.0400 };

        await cache.set('USD', 2025, rates);

        expect(await cache.get('USD', 2025)).toEqual(rates);
    });

    it('isolates currencies', async () => {
        const cache = new InMemoryFxCache();

        await cache.set('USD', 2025, { '2025-01-02': 1.0353 });
        await cache.set('GBP', 2025, { '2025-01-02': 0.8290 });

        expect(await cache.get('USD', 2025)).toEqual({ '2025-01-02': 1.0353 });
        expect(await cache.get('GBP', 2025)).toEqual({ '2025-01-02': 0.8290 });
    });

    it('isolates years for same currency', async () => {
        const cache = new InMemoryFxCache();

        await cache.set('USD', 2024, { '2024-01-02': 1.10 });
        await cache.set('USD', 2025, { '2025-01-02': 1.04 });

        expect(await cache.get('USD', 2024)).toEqual({ '2024-01-02': 1.10 });
        expect(await cache.get('USD', 2025)).toEqual({ '2025-01-02': 1.04 });
    });

    it('overwrites on repeated set', async () => {
        const cache = new InMemoryFxCache();

        await cache.set('USD', 2025, { '2025-01-02': 1.00 });
        await cache.set('USD', 2025, { '2025-01-02': 1.05 });

        expect(await cache.get('USD', 2025)).toEqual({ '2025-01-02': 1.05 });
    });
});
