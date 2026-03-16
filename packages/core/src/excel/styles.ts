import type { Style } from 'exceljs';

export const FONT = { name: 'Aptos Narrow', size: 12 };

export const DATE_FORMAT = 'yyyy-mm-dd';
export const BGN_FORMAT = '#,##0.00 "BGN"';
export const EUR_FORMAT = '#,##0.00 "EUR"';
export const CCY_FORMAT = '#,##0.00';
export const FX_RATE_FORMAT = '0.00000';

export function baseCcyFormat(baseCurrency: string): string {
    return baseCurrency === 'BGN' ? BGN_FORMAT : EUR_FORMAT;
}

export const HEADER_STYLE: Partial<Style> = {
    font: { ...FONT, bold: true },
};
