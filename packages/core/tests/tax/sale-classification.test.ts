import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    classifySaleByExchange,
    isEuRegulatedSale,
} from '../../src/tax/sale-classification.js';

describe('sale classification', () => {
    it('classifies IBIS as EU regulated', () => {
        expect(classifySaleByExchange('IBIS')).toBe('eu-regulated-market');
    });

    it('classifies NASDAQ as taxable', () => {
        expect(classifySaleByExchange('NASDAQ')).toBe('taxable');
    });

    it('treats missing exchange as taxable by default', () => {
        expect(classifySaleByExchange()).toBe('taxable');
    });

    it('recognizes EU regulated sales from stored sale data', () => {
        expect(isEuRegulatedSale({ saleTaxClassification: 'eu-regulated-market' })).toBe(true);
        expect(isEuRegulatedSale({ saleTaxClassification: 'taxable' })).toBe(false);
    });
});
