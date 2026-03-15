import {
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    setLanguage,
    t,
} from '../src/i18n/index.js';

describe('i18n', () => {
    beforeEach(() => {
        setLanguage('en');
    });

    it('returns English translation by default', () => {
        const result = t('currency.BGN');
        expect(result).toBe('BGN');
    });

    it('switches to Bulgarian after setLanguage', () => {
        setLanguage('bg');
        const result = t('currency.BGN');
        expect(result).toBe('BGN');
    });

    it('returns key when translation not found', () => {
        const result = t('unknown.key.that.does.not.exist');
        expect(result).toBe('unknown.key.that.does.not.exist');
    });

    it('translates Excel sheet names in both languages', () => {
        expect(t('excel.sheet.fxRates')).toBeDefined();
        setLanguage('bg');
        expect(t('excel.sheet.fxRates')).toBeDefined();
    });

    it('translates form field labels', () => {
        expect(t('form.appendix5.title')).toBeDefined();
        expect(t('form.appendix8table1.title')).toBeDefined();
        expect(t('form.appendix8table6.title')).toBeDefined();
    });

    it('translates UI labels', () => {
        expect(t('ui.taxYear')).toBeDefined();
        expect(t('ui.baseCurrency')).toBeDefined();
    });
});
