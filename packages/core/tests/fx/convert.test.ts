import {
    describe,
    expect,
    it,
} from 'vitest';
import {
    BGN_EUR_RATE,
    calcDividendRowTax,
    getFxRate,
    toBaseCurrency,
    toBaseCurrencyStr,
} from '../../src/fx/convert.js';

const fxRates: Record<string, Record<string, number>> = {
    USD: { '2025-06-15': 1.05, '2025-01-10': 1.10 },
    GBP: { '2025-06-15': 0.84 },
    HKD: { '2025-06-15': 8.22 },
};

describe('toBaseCurrency', () => {
    describe('BGN base', () => {
        it('returns amount unchanged for BGN currency', () => {
            expect(toBaseCurrency(100, 'BGN', '2025-06-15', 'BGN', fxRates)).toBe(100);
        });

        it('converts EUR to BGN with fixed rate', () => {
            const result = toBaseCurrency(50, 'EUR', '2025-06-15', 'BGN', fxRates);
            expect(result).toBeCloseTo(50 * BGN_EUR_RATE, 4);
        });

        it('converts USD to BGN using ECB rate', () => {
            const result = toBaseCurrency(100, 'USD', '2025-06-15', 'BGN', fxRates);
            expect(result).toBeCloseTo(100 * BGN_EUR_RATE / 1.05, 4);
        });

        it('converts GBP to BGN using ECB rate', () => {
            const result = toBaseCurrency(100, 'GBP', '2025-06-15', 'BGN', fxRates);
            expect(result).toBeCloseTo(100 * BGN_EUR_RATE / 0.84, 4);
        });

        it('converts HKD to BGN using ECB rate', () => {
            const result = toBaseCurrency(80, 'HKD', '2025-06-15', 'BGN', fxRates);
            expect(result).toBeCloseTo(80 * BGN_EUR_RATE / 8.22, 4);
        });

        it('returns NaN when FX rate is missing', () => {
            expect(toBaseCurrency(100, 'USD', '2099-01-01', 'BGN', fxRates)).toBeNaN();
        });

        it('returns NaN for unknown currency', () => {
            expect(toBaseCurrency(100, 'JPY', '2025-06-15', 'BGN', fxRates)).toBeNaN();
        });

        it('handles zero amount', () => {
            expect(toBaseCurrency(0, 'USD', '2025-06-15', 'BGN', fxRates)).toBe(0);
        });

        it('handles negative amount (WHT)', () => {
            const result = toBaseCurrency(-10, 'USD', '2025-06-15', 'BGN', fxRates);
            expect(result).toBeCloseTo(-10 * BGN_EUR_RATE / 1.05, 4);
        });
    });

    describe('EUR base', () => {
        it('returns amount unchanged for EUR currency', () => {
            expect(toBaseCurrency(100, 'EUR', '2025-06-15', 'EUR', fxRates)).toBe(100);
        });

        it('converts BGN to EUR with fixed rate', () => {
            const result = toBaseCurrency(195.583, 'BGN', '2025-06-15', 'EUR', fxRates);
            expect(result).toBeCloseTo(195.583 / BGN_EUR_RATE, 4);
        });

        it('converts USD to EUR using ECB rate', () => {
            const result = toBaseCurrency(100, 'USD', '2025-06-15', 'EUR', fxRates);
            expect(result).toBeCloseTo(100 / 1.05, 4);
        });

        it('converts GBP to EUR using ECB rate', () => {
            const result = toBaseCurrency(100, 'GBP', '2025-06-15', 'EUR', fxRates);
            expect(result).toBeCloseTo(100 / 0.84, 4);
        });

        it('returns NaN when FX rate missing', () => {
            expect(toBaseCurrency(100, 'USD', '2099-01-01', 'EUR', fxRates)).toBeNaN();
        });
    });

    it('uses correct rate for specific date', () => {
        const jan = toBaseCurrency(100, 'USD', '2025-01-10', 'BGN', fxRates);
        const jun = toBaseCurrency(100, 'USD', '2025-06-15', 'BGN', fxRates);
        expect(jan).not.toBeCloseTo(jun, 2); // Different rates → different results
    });

    it('handles empty fxRates object', () => {
        expect(toBaseCurrency(100, 'USD', '2025-06-15', 'BGN', {})).toBeNaN();
    });
});

describe('toBaseCurrencyStr', () => {
    it('formats valid conversion to 2 decimals', () => {
        const result = toBaseCurrencyStr(50, 'EUR', '2025-06-15', 'BGN', fxRates);
        expect(result).toBe((50 * BGN_EUR_RATE).toFixed(2));
    });

    it('returns — for missing FX rate', () => {
        expect(toBaseCurrencyStr(100, 'USD', '2099-01-01', 'BGN', fxRates)).toBe('—');
    });

    it('returns — for unknown currency', () => {
        expect(toBaseCurrencyStr(100, 'JPY', '2025-06-15', 'BGN', fxRates)).toBe('—');
    });

    it('formats zero amount as 0.00', () => {
        expect(toBaseCurrencyStr(0, 'BGN', '2025-06-15', 'BGN', fxRates)).toBe('0.00');
    });

    it('formats base currency without conversion', () => {
        expect(toBaseCurrencyStr(123.456, 'BGN', '2025-06-15', 'BGN', fxRates)).toBe('123.46');
    });
});

describe('getFxRate', () => {
    describe('BGN base', () => {
        it('returns 1 for BGN', () => {
            expect(getFxRate('BGN', '2025-06-15', 'BGN', fxRates)).toBe('1');
        });

        it('returns fixed rate for EUR', () => {
            expect(getFxRate('EUR', '2025-06-15', 'BGN', fxRates)).toBe('1.95583');
        });

        it('returns computed rate for USD', () => {
            const result = getFxRate('USD', '2025-06-15', 'BGN', fxRates);
            expect(parseFloat(result)).toBeCloseTo(BGN_EUR_RATE / 1.05, 5);
        });

        it('returns — for missing rate', () => {
            expect(getFxRate('USD', '2099-01-01', 'BGN', fxRates)).toBe('—');
        });

        it('returns — for unknown currency', () => {
            expect(getFxRate('JPY', '2025-06-15', 'BGN', fxRates)).toBe('—');
        });

        it('returns 6 decimal places', () => {
            const result = getFxRate('USD', '2025-06-15', 'BGN', fxRates);
            expect(result.split('.')[1]).toHaveLength(6);
        });
    });

    describe('EUR base', () => {
        it('returns 1 for EUR', () => {
            expect(getFxRate('EUR', '2025-06-15', 'EUR', fxRates)).toBe('1');
        });

        it('returns inverse fixed rate for BGN', () => {
            const result = getFxRate('BGN', '2025-06-15', 'EUR', fxRates);
            expect(parseFloat(result)).toBeCloseTo(1 / BGN_EUR_RATE, 5);
        });

        it('returns 1/ecbRate for USD', () => {
            const result = getFxRate('USD', '2025-06-15', 'EUR', fxRates);
            expect(parseFloat(result)).toBeCloseTo(1 / 1.05, 5);
        });
    });
});

describe('calcDividendRowTax', () => {
    it('computes tax correctly for US dividend (WHT > 5%)', () => {
        // US WHT is typically 15%, so WHT > 5% tax → bgTaxDue = 0
        const result = calcDividendRowTax(100, 15, 'USD', '2025-06-15', 'BGN', fxRates);
        expect(result.tax5pct).toBeCloseTo(result.grossBase * 0.05, 2);
        expect(result.bgTaxDue).toBe(0); // WHT exceeds 5% tax
    });

    it('computes tax correctly for Irish dividend (0% WHT)', () => {
        // No WHT → full 5% tax due
        const result = calcDividendRowTax(100, 0, 'EUR', '2025-06-15', 'BGN', fxRates);
        expect(result.grossBase).toBeCloseTo(100 * BGN_EUR_RATE, 2);
        expect(result.whtBase).toBe(0);
        expect(result.tax5pct).toBeCloseTo(result.grossBase * 0.05, 2);
        expect(result.bgTaxDue).toBeCloseTo(result.tax5pct, 2);
    });

    it('computes tax correctly when WHT < 5%', () => {
        // WHT = 2 USD, 5% of 100 USD in BGN
        const result = calcDividendRowTax(100, 2, 'USD', '2025-06-15', 'BGN', fxRates);
        expect(result.bgTaxDue).toBeCloseTo(result.tax5pct - result.whtBase, 2);
        expect(result.bgTaxDue).toBeGreaterThan(0);
    });

    it('returns 0 grossBase/whtBase when FX rate is missing', () => {
        const result = calcDividendRowTax(100, 10, 'JPY', '2025-06-15', 'BGN', fxRates);
        expect(result.grossBase).toBe(0);
        expect(result.whtBase).toBe(0);
        expect(result.tax5pct).toBe(0);
        expect(result.bgTaxDue).toBe(0);
    });

    it('handles BGN dividend (no conversion needed)', () => {
        const result = calcDividendRowTax(1000, 0, 'BGN', '2025-06-15', 'BGN', fxRates);
        expect(result.grossBase).toBe(1000);
        expect(result.tax5pct).toBe(50);
        expect(result.bgTaxDue).toBe(50);
    });

    it('handles EUR base currency', () => {
        const result = calcDividendRowTax(100, 10, 'USD', '2025-06-15', 'EUR', fxRates);
        expect(result.grossBase).toBeCloseTo(100 / 1.05, 2);
        expect(result.whtBase).toBeCloseTo(10 / 1.05, 2);
    });

    it('handles zero gross amount', () => {
        const result = calcDividendRowTax(0, 0, 'USD', '2025-06-15', 'BGN', fxRates);
        expect(result.grossBase).toBe(0);
        expect(result.tax5pct).toBe(0);
        expect(result.bgTaxDue).toBe(0);
    });

    it('bgTaxDue is never negative', () => {
        // WHT = 1000, gross = 10 → WHT >> 5% tax → bgTaxDue = 0
        const result = calcDividendRowTax(10, 1000, 'USD', '2025-06-15', 'BGN', fxRates);
        expect(result.bgTaxDue).toBe(0);
    });
});

describe('BGN_EUR_RATE', () => {
    it('is the correct fixed rate', () => {
        expect(BGN_EUR_RATE).toBe(1.95583);
    });
});
