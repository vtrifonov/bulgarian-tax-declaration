import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { InMemoryFxCache } from '../../src/fx/fx-cache.js';
import { FxService } from '../../src/fx/fx-service.js';

// Mock ECB API
vi.mock('../../src/fx/ecb-api.js', () => ({
    fetchYearRates: vi.fn(),
}));

import { fetchYearRates } from '../../src/fx/ecb-api.js';

const mockFetchYearRates = vi.mocked(fetchYearRates);

beforeEach(() => {
    mockFetchYearRates.mockReset();
});

describe('FxService.fetchRates', () => {
    it('fetches rates for non-built-in currencies', async () => {
        mockFetchYearRates.mockResolvedValue({ '2025-01-02': 1.0353 });
        const svc = new FxService(new InMemoryFxCache(), 'BGN');
        const result = await svc.fetchRates(['USD', 'EUR', 'BGN'], 2025);

        // EUR and BGN are built-in — only USD should be fetched
        expect(mockFetchYearRates).toHaveBeenCalledTimes(1);
        expect(mockFetchYearRates).toHaveBeenCalledWith('USD', 2025);
        expect(result.USD).toBeDefined();
        expect(result.EUR).toBeUndefined();
        expect(result.BGN).toBeUndefined();
    });

    it('uses cached rates when available', async () => {
        const cache = new InMemoryFxCache();

        await cache.set('USD', 2025, { '2025-01-02': 1.0353 });
        mockFetchYearRates.mockClear();
        const svc = new FxService(cache, 'BGN');
        const result = await svc.fetchRates(['USD'], 2025);

        // Should NOT call fetchYearRates since cache has the data
        expect(mockFetchYearRates).not.toHaveBeenCalled();
        expect(result.USD).toBeDefined();
    });

    it('handles fetch errors gracefully', async () => {
        mockFetchYearRates.mockRejectedValue(new Error('Network error'));
        const svc = new FxService(new InMemoryFxCache(), 'BGN');
        const result = await svc.fetchRates(['USD'], 2025);

        // Should not throw, returns gap-filled empty rates
        expect(result.USD).toBeDefined();
    });

    it('deduplicates currencies', async () => {
        mockFetchYearRates.mockResolvedValue({ '2025-01-02': 1.04 });
        const svc = new FxService(new InMemoryFxCache(), 'BGN');
        await svc.fetchRates(['USD', 'USD', 'USD'], 2025);

        expect(mockFetchYearRates).toHaveBeenCalledTimes(1);
    });

    it('fetches multiple currencies in parallel', async () => {
        mockFetchYearRates.mockImplementation(async (ccy) => {
            if (ccy === 'USD') return { '2025-01-02': 1.04 };
            if (ccy === 'GBP') return { '2025-01-02': 0.83 };

            return {};
        });
        const svc = new FxService(new InMemoryFxCache(), 'BGN');
        const result = await svc.fetchRates(['USD', 'GBP'], 2025);

        expect(result.USD).toBeDefined();
        expect(result.GBP).toBeDefined();
        expect(mockFetchYearRates).toHaveBeenCalledTimes(2);
    });

    it('caches fetched rates for subsequent calls', async () => {
        mockFetchYearRates.mockResolvedValue({ '2025-01-02': 1.04 });
        const cache = new InMemoryFxCache();
        const svc = new FxService(cache, 'BGN');

        await svc.fetchRates(['USD'], 2025);
        mockFetchYearRates.mockClear();

        // Second call should use cache
        await svc.fetchRates(['USD'], 2025);
        expect(mockFetchYearRates).not.toHaveBeenCalled();
    });
});

describe('FxService.getRate — additional edge cases', () => {
    it('returns inverse fixed rate for BGN→EUR', () => {
        const svc = new FxService(new InMemoryFxCache(), 'EUR');

        expect(svc.getRate('BGN', '2025-01-02', {})).toBeCloseTo(1 / 1.95583, 6);
    });

    it('returns null for unknown currency', () => {
        const svc = new FxService(new InMemoryFxCache(), 'BGN');

        expect(svc.getRate('XYZ', '2025-01-02', {})).toBeNull();
    });

    it('returns null for known currency but missing date', () => {
        const svc = new FxService(new InMemoryFxCache(), 'BGN');
        const rates = { USD: { '2025-01-02': 1.04 } };

        expect(svc.getRate('USD', '2025-12-31', rates)).toBeNull();
    });

    it('converts GBP to BGN correctly', () => {
        const svc = new FxService(new InMemoryFxCache(), 'BGN');
        const rates = { GBP: { '2025-01-02': 0.8290 } };
        const rate = svc.getRate('GBP', '2025-01-02', rates);

        // 1 GBP = 1.95583 / 0.8290 ≈ 2.3592
        expect(rate).toBeCloseTo(1.95583 / 0.8290, 4);
    });

    it('converts GBP to EUR correctly', () => {
        const svc = new FxService(new InMemoryFxCache(), 'EUR');
        const rates = { GBP: { '2025-01-02': 0.8290 } };
        const rate = svc.getRate('GBP', '2025-01-02', rates);

        // 1 GBP = 1/0.8290 EUR ≈ 1.2063
        expect(rate).toBeCloseTo(1 / 0.8290, 4);
    });
});
