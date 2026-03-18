import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    EXCHANGE_COUNTRY,
    resolveCountries,
    resolveCountrySync,
} from '../src/country-map.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('resolveCountries (async batch)', () => {
    it('calls OpenFIGI API for symbols not in hardcoded map', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                json: () => Promise.resolve([{ data: [{ exchCode: 'US' }] }]),
            }),
        );
        const result = await resolveCountries([{ symbol: 'AAPL', currency: 'USD' }]);

        expect(result['AAPL']).toBe('САЩ');
        expect(fetch).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('batches unknown symbols into single OpenFIGI request', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({ 'X-RateLimit-Remaining': '19' }),
                json: () =>
                    Promise.resolve([
                        { data: [{ exchCode: 'US' }] },
                        { data: [{ exchCode: 'GY' }] },
                    ]),
            }),
        );
        const result = await resolveCountries([
            { symbol: 'UNKNOWNA', currency: 'USD' },
            { symbol: 'UNKNOWNB', currency: 'EUR' },
        ]);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result['UNKNOWNA']).toBe('САЩ');
        expect(result['UNKNOWNB']).toBe('Германия');
        vi.unstubAllGlobals();
    });

    it('deduplicates input symbols', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                json: () => Promise.resolve([{ data: [{ exchCode: 'LN' }] }]),
            }),
        );
        await resolveCountries([
            { symbol: 'NEWDUP', currency: 'GBP' },
            { symbol: 'NEWDUP', currency: 'GBP' },
        ]);
        const mockFetch = fetch as unknown as { mock: { calls: [string, { body: string }][] } };
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);

        expect(body).toHaveLength(1);
        vi.unstubAllGlobals();
    });

    it('handles API returning no results for a symbol', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                json: () => Promise.resolve([{ data: [] }]),
            }),
        );
        const result = await resolveCountries([{ symbol: 'NOSUCH1', currency: 'USD' }]);

        expect(result['NOSUCH1']).toBe('');
        vi.unstubAllGlobals();
    });

    it('handles partial API failures gracefully', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                json: () =>
                    Promise.resolve([
                        { data: [{ exchCode: 'US' }] },
                        { error: 'No match' },
                    ]),
            }),
        );
        const result = await resolveCountries([
            { symbol: 'GOODSYM', currency: 'USD' },
            { symbol: 'BADSYM', currency: 'USD' },
        ]);

        expect(result['GOODSYM']).toBe('САЩ');
        expect(result['BADSYM']).toBe('');
        vi.unstubAllGlobals();
    });

    it('handles fetch network error without throwing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        const result = await resolveCountries([{ symbol: 'OFFLINE1', currency: 'USD' }]);

        expect(result['OFFLINE1']).toBe('');
        vi.unstubAllGlobals();
    });
});

describe('resolveCountrySync', () => {
    it('returns empty string for unknown symbols (no API call)', () => {
        expect(resolveCountrySync('TOTALLY_UNKNOWN')).toBe('');
    });

    it('returns cached result after async resolution', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                json: () => Promise.resolve([{ data: [{ exchCode: 'US' }] }]),
            }),
        );
        await resolveCountries([{ symbol: 'CACHED_TEST', currency: 'USD' }]);
        // After async resolution, sync lookup should find cached result
        expect(resolveCountrySync('CACHED_TEST')).toBe('САЩ');
        vi.unstubAllGlobals();
    });
});

describe('resolveCountries with symbolExchanges', () => {
    it('resolves symbols using provider-supplied exchange mapping before OpenFIGI', async () => {
        const mockFetch = vi.fn();

        vi.stubGlobal('fetch', mockFetch);

        const symbolExchanges = {
            CSPX: 'IBIS',
            AAPL: 'NASDAQ',
            ASML: 'AEB',
        };

        const result = await resolveCountries(
            [
                { symbol: 'CSPX', currency: 'EUR' },
                { symbol: 'AAPL', currency: 'USD' },
                { symbol: 'ASML', currency: 'EUR' },
            ],
            fetch,
            symbolExchanges,
        );

        expect(result['CSPX']).toBe('Германия');
        expect(result['AAPL']).toBe('САЩ');
        expect(result['ASML']).toBe('Нидерландия (Холандия)');
        // No OpenFIGI call needed — all resolved from exchange mapping
        expect(mockFetch).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('falls back to OpenFIGI when exchange not in EXCHANGE_COUNTRY', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(),
                json: () => Promise.resolve([{ data: [{ exchCode: 'US' }] }]),
            }),
        );

        const symbolExchanges = { TEST: 'UNKNOWN_EXCHANGE' };

        const result = await resolveCountries(
            [{ symbol: 'TEST', currency: 'USD' }],
            fetch,
            symbolExchanges,
        );

        // Should call OpenFIGI because UNKNOWN_EXCHANGE is not in EXCHANGE_COUNTRY
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result['TEST']).toBe('САЩ');
        vi.unstubAllGlobals();
    });
});

describe('EXCHANGE_COUNTRY map', () => {
    it('maps US exchange codes to САЩ', () => {
        expect(EXCHANGE_COUNTRY['US']).toBe('САЩ');
        expect(EXCHANGE_COUNTRY['UA']).toBe('САЩ');
        expect(EXCHANGE_COUNTRY['UN']).toBe('САЩ');
    });

    it('maps European exchange codes', () => {
        expect(EXCHANGE_COUNTRY['NA']).toBe('Нидерландия (Холандия)');
        expect(EXCHANGE_COUNTRY['GY']).toBe('Германия');
        expect(EXCHANGE_COUNTRY['LN']).toBe('Великобритания');
        expect(EXCHANGE_COUNTRY['FP']).toBe('Франция');
        expect(EXCHANGE_COUNTRY['ID']).toBe('Ирландия');
    });

    it('maps Asian exchange codes', () => {
        expect(EXCHANGE_COUNTRY['HK']).toBe('Хонконг');
        expect(EXCHANGE_COUNTRY['JT']).toBe('Япония');
    });

    it('maps IB exchange names', () => {
        expect(EXCHANGE_COUNTRY['NASDAQ']).toBe('САЩ');
        expect(EXCHANGE_COUNTRY['NYSE']).toBe('САЩ');
        expect(EXCHANGE_COUNTRY['IBIS']).toBe('Германия');
        expect(EXCHANGE_COUNTRY['LSE']).toBe('Великобритания');
        expect(EXCHANGE_COUNTRY['SBF']).toBe('Франция');
        expect(EXCHANGE_COUNTRY['SEHK']).toBe('Хонконг');
        expect(EXCHANGE_COUNTRY['AEB']).toBe('Нидерландия (Холандия)');
        expect(EXCHANGE_COUNTRY['ISE']).toBe('Ирландия');
    });
});
