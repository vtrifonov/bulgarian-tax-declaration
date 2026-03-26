import {
    describe,
    expect,
    it,
} from 'vitest';

import { generateSpb8Excel } from '../../src/spb8/excel-generator.js';
import { importPreviousSpb8 } from '../../src/spb8/import.js';
import type {
    Spb8FormData,
    Spb8Security,
} from '../../src/types/index.js';

function makeFormData(overrides: Partial<Spb8FormData> = {}): Spb8FormData {
    return {
        year: 2025,
        reportType: 'P',
        personalData: { egn: '1234567890', name: 'Иван Петров' },
        accounts: [],
        securities: [],
        thresholdMet: false,
        totalBgn: 0,
        ...overrides,
    };
}

describe('importPreviousSpb8 — extended coverage', () => {
    it('round-trips securities through export → import', async () => {
        const securities: Spb8Security[] = [
            { isin: 'US0378331005', currency: 'USD', quantityStartOfYear: 100, quantityEndOfYear: 150 },
            { isin: 'US5949181045', currency: 'USD', quantityStartOfYear: 50, quantityEndOfYear: 75 },
        ];
        const formData = makeFormData({ securities });
        const buf = await generateSpb8Excel(formData);
        const imported = await importPreviousSpb8(buf.buffer as ArrayBuffer);

        expect(imported.securities).toHaveLength(2);

        for (let i = 0; i < securities.length; i++) {
            expect(imported.securities[i].isin).toBe(securities[i].isin);
            expect(imported.securities[i].quantityStartOfYear).toBeCloseTo(securities[i].quantityStartOfYear, 1);
            expect(imported.securities[i].quantityEndOfYear).toBeCloseTo(securities[i].quantityEndOfYear, 1);
        }
    });

    it('handles empty form data (no securities)', async () => {
        const formData = makeFormData();
        const buf = await generateSpb8Excel(formData);
        const imported = await importPreviousSpb8(buf.buffer as ArrayBuffer);

        expect(imported.securities).toHaveLength(0);
    });

    it('imports securities with various ISINs', async () => {
        const securities: Spb8Security[] = [
            { isin: 'IE00BK5BQT80', currency: 'EUR', quantityStartOfYear: 20, quantityEndOfYear: 30 },
            { isin: 'US0378331005', currency: 'USD', quantityStartOfYear: 100, quantityEndOfYear: 200 },
            { isin: 'GB00B03MLX29', currency: 'GBP', quantityStartOfYear: 10, quantityEndOfYear: 15 },
        ];
        const formData = makeFormData({ securities });
        const buf = await generateSpb8Excel(formData);
        const imported = await importPreviousSpb8(buf.buffer as ArrayBuffer);

        expect(imported.securities).toHaveLength(3);
        const isins = imported.securities.map(s => s.isin).sort();

        expect(isins).toEqual(['GB00B03MLX29', 'IE00BK5BQT80', 'US0378331005']);
    });

    it('preserves zero start-of-year with nonzero end-of-year', async () => {
        const securities: Spb8Security[] = [
            { isin: 'US0378331005', currency: 'USD', quantityStartOfYear: 0, quantityEndOfYear: 100 },
        ];
        const formData = makeFormData({ securities });
        const buf = await generateSpb8Excel(formData);
        const imported = await importPreviousSpb8(buf.buffer as ArrayBuffer);

        expect(imported.securities).toHaveLength(1);
        expect(imported.securities[0].quantityStartOfYear).toBe(0);
        expect(imported.securities[0].quantityEndOfYear).toBe(100);
    });
});
