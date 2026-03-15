import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    fetchEcbRates,
    fetchYearRates,
} from '../../src/fx/ecb-api.js';

const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<message:GenericData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message" xmlns:generic="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic">
<message:DataSet>
<generic:Series>
<generic:Obs><generic:ObsDimension value="2025-01-02"/><generic:ObsValue value="1.0353"/></generic:Obs>
<generic:Obs><generic:ObsDimension value="2025-01-03"/><generic:ObsValue value="1.0345"/></generic:Obs>
</generic:Series>
</message:DataSet>
</message:GenericData>`;

describe('fetchEcbRates', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(mockXml),
            }),
        );
    });

    it('parses ECB XML into date→rate map', async () => {
        const rates = await fetchEcbRates('USD', '2025-01-02', '2025-01-03');
        expect(rates['2025-01-02']).toBe(1.0353);
        expect(rates['2025-01-03']).toBe(1.0345);
    });

    it('throws on HTTP error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
            }),
        );
        await expect(fetchEcbRates('USD', '2025-01-02', '2025-01-03')).rejects.toThrow('404');
    });

    it('throws on missing data', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve('<message:GenericData></message:GenericData>'),
            }),
        );
        await expect(fetchEcbRates('USD', '2025-01-02', '2025-01-03')).rejects.toThrow('No');
    });
});

describe('fetchYearRates', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(mockXml),
            }),
        );
    });

    it('fetches 4 quarterly requests and combines rates', async () => {
        const rates = await fetchYearRates('USD', 2025);
        expect(rates['2025-01-02']).toBe(1.0353);
        expect(rates['2025-01-03']).toBe(1.0345);
    });
});
