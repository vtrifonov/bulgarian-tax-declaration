import type {
    Sale,
    SaleTaxClassification,
} from '../types/index.js';

const EU_REGULATED_EXCHANGES = new Set([
    'AEB',
    'AMS',
    'BM',
    'BVME',
    'BVME.ETF',
    'CSE',
    'ENXTAM',
    'ENXTPA',
    'FP',
    'FWB',
    'FWB2',
    'GF',
    'GD',
    'GH',
    'GI',
    'GM',
    'GR',
    'GS',
    'GT',
    'GY',
    'GZ',
    'IBIS',
    'IBIS2',
    'ID',
    'IM',
    'ISE',
    'LA',
    'LU',
    'NA',
    'OMXS',
    'PL',
    'QT',
    'SBF',
    'SM',
    'TH',
    'WSE',
    'XAMS',
]);

export function classifySaleByExchange(exchange?: string): SaleTaxClassification {
    if (!exchange) {
        return 'taxable';
    }

    return EU_REGULATED_EXCHANGES.has(exchange.toUpperCase())
        ? 'eu-regulated-market'
        : 'taxable';
}

export function isEuRegulatedSale(sale: Pick<Sale, 'saleTaxClassification'>): boolean {
    return sale.saleTaxClassification === 'eu-regulated-market';
}
