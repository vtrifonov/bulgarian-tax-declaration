import {
    describe,
    expect,
    it,
} from 'vitest';

import { generateSpb8Excel } from '../../src/spb8/excel-generator.js';
import { importPreviousSpb8 } from '../../src/spb8/import.js';
import type { Spb8FormData } from '../../src/types/index.js';

describe('importPreviousSpb8', () => {
    it('round-trips securities from generated Excel', async () => {
        const formData: Spb8FormData = {
            year: 2024,
            reportType: 'P',
            personalData: {},
            accounts: [],
            securities: [
                {
                    isin: 'US0378331005',
                    currency: 'USD',
                    quantityStartOfYear: 100,
                    quantityEndOfYear: 150,
                },
                {
                    isin: 'IE00BK5BQT80',
                    currency: 'EUR',
                    quantityStartOfYear: 20,
                    quantityEndOfYear: 30,
                },
            ],
            thresholdMet: true,
            totalBgn: 60000,
        };

        const buf = await generateSpb8Excel(formData);
        const imported = await importPreviousSpb8(buf.buffer as ArrayBuffer);

        expect(imported.securities).toHaveLength(2);
        const aapl = imported.securities.find(
            (s) => s.isin === 'US0378331005',
        );

        expect(aapl).toBeDefined();
        expect(aapl!.quantityEndOfYear).toBe(150);
    });
});
