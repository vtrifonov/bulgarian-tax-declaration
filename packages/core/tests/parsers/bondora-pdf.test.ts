import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    detectBondoraPdf,
    parseBondoraPdf,
} from '../../src/parsers/bondora-pdf.js';

// Synthetic text that mimics what pdf-parse extracts from a Bondora Tax Report PDF
const SAMPLE_BG_TEXT = `Bondora Capital OÜ
Tammsare tee 56
Tallinn, 11316
Estonia

Test User
Test Address
Sofia, 1000
Bulgaria
1234567

Income statement for period – 01/01/2025 - 12/31/2025

Брутен доход за периода
Получена лихва - текущи заеми €18.45
Получена лихва - просрочени кредити €2.37
Печалба от продажби на вторичния пазар €0
Печалба от покупки на вторичния пазар €0
Go & Grow получена лихва €5.60
Бонус доход, получен по акаунт в Bondora* €0
Общо €26.42

Отчисления за периода
Отписване - главница €42.15
Загуба от продажби на вторичния пазар €0
Загуба от покупки на вторичния пазар €0
Платени такси €0
Go & Grow такси €0
Общо €42.15
Нетен приход €-15.73

Account Statement – 01/01/2025 - 12/31/2025

Начално салдо €215.30
Плащания €0
Тегления €0
Инвестирана главница €0
Покупки на вторичния пазар €0
Продажби на вторичния пазар €0
Получена главница - текущи заеми €22.50
Получена главница - просрочени кредити €31.80
Получена лихва - текущи заеми €18.45
Получена лихва - просрочени кредити €2.37
Go & Grow плащания €0
Go & Grow изтеглен капитал €0
Go & Grow получена лихва €5.60
Go & Grow такси €0
Платени такси €0
Други плащания €0
Окончателно салдо €253.87
Стойност на акаунта 01/01/2025 €350.20
Стойност на акаунта 12/31/2025 €376.62`;

const SAMPLE_WITH_GOGROW = `Bondora Capital OÜ

Income statement for period – 01/01/2025 - 12/31/2025

Получена лихва - текущи заеми €5.00
Получена лихва - просрочени кредити €0
Go & Grow получена лихва €8.50

Account Statement – 01/01/2025 - 12/31/2025

Стойност на акаунта 01/01/2025 €500.00
Стойност на акаунта 12/31/2025 €513.50`;

describe('parseBondoraPdf', () => {
    describe('Bulgarian text (standard)', () => {
        const result = parseBondoraPdf(SAMPLE_BG_TEXT);

        it('extracts interest from current loans', () => {
            const current = result.interest.entries.find(e => e.description === 'Interest - current loans');

            expect(current).toBeDefined();
            expect(current!.amount).toBe(18.45);
        });

        it('extracts interest from overdue loans', () => {
            const overdue = result.interest.entries.find(e => e.description === 'Interest - overdue loans');

            expect(overdue).toBeDefined();
            expect(overdue!.amount).toBe(2.37);
        });

        it('includes Go & Grow interest when non-zero', () => {
            const goGrow = result.interest.entries.find(e => e.description === 'Go & Grow interest');

            expect(goGrow).toBeDefined();
            expect(goGrow!.amount).toBe(5.60);
        });

        it('sums interest correctly', () => {
            const total = result.interest.entries.reduce((s, e) => s + e.amount, 0);

            expect(total).toBeCloseTo(26.42, 2);
        });

        it('extracts account values for SPB-8', () => {
            expect(result.foreignAccount.amountStartOfYear).toBe(350.20);
            expect(result.foreignAccount.amountEndOfYear).toBe(376.62);
        });

        it('sets correct metadata', () => {
            expect(result.interest.broker).toBe('Bondora');
            expect(result.interest.currency).toBe('EUR');
            expect(result.foreignAccount.broker).toBe('Bondora');
            expect(result.foreignAccount.type).toBe('03');
            expect(result.foreignAccount.maturity).toBe('S');
            expect(result.foreignAccount.country).toBe('EE');
            expect(result.foreignAccount.currency).toBe('EUR');
        });

        it('assigns period end date to interest entries', () => {
            for (const e of result.interest.entries) {
                expect(e.date).toBe('2025-12-31');
            }
        });

        it('has no warnings', () => {
            expect(result.warnings).toHaveLength(0);
        });
    });

    describe('with Go & Grow interest', () => {
        const result = parseBondoraPdf(SAMPLE_WITH_GOGROW);

        it('includes Go & Grow interest when non-zero', () => {
            const goGrow = result.interest.entries.find(e => e.description === 'Go & Grow interest');

            expect(goGrow).toBeDefined();
            expect(goGrow!.amount).toBe(8.50);
        });

        it('extracts all non-zero interest types', () => {
            expect(result.interest.entries).toHaveLength(2);

            const total = result.interest.entries.reduce((s, e) => s + e.amount, 0);

            expect(total).toBeCloseTo(13.50, 2);
        });

        it('extracts account values', () => {
            expect(result.foreignAccount.amountStartOfYear).toBe(500.00);
            expect(result.foreignAccount.amountEndOfYear).toBe(513.50);
        });
    });

    it('throws on non-Bondora text', () => {
        expect(() => parseBondoraPdf('Some random text about investing')).toThrow();
    });

    it('throws on empty input', () => {
        expect(() => parseBondoraPdf('')).toThrow();
    });

    it('warns when no interest found', () => {
        const noInterest = `Bondora Capital OÜ
Income statement for period – 01/01/2025 - 12/31/2025
Получена лихва - текущи заеми €0
Получена лихва - просрочени кредити €0
Go & Grow получена лихва €0
Account Statement – 01/01/2025 - 12/31/2025
Стойност на акаунта 01/01/2025 €100.00
Стойност на акаунта 12/31/2025 €100.00`;
        const result = parseBondoraPdf(noInterest);

        expect(result.interest.entries).toHaveLength(0);
        expect(result.warnings.some(w => w.includes('No interest'))).toBe(true);
    });
});

describe('detectBondoraPdf', () => {
    it('returns true for Bondora tax report text', () => {
        expect(detectBondoraPdf(SAMPLE_BG_TEXT)).toBe(true);
    });

    it('returns false for non-Bondora text', () => {
        expect(detectBondoraPdf('E*TRADE Securities LLC Client Statement')).toBe(false);
    });

    it('returns false for empty text', () => {
        expect(detectBondoraPdf('')).toBe(false);
    });
});
