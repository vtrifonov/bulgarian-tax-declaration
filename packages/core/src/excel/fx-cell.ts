import type { Cell } from 'exceljs';

/**
 * Set a cell to the appropriate FX rate value/formula.
 *
 * @param cell        The ExcelJS cell to write into
 * @param currency    The row's currency code (e.g. "USD", "EUR")
 * @param baseCurrency The target base currency ("BGN" or "EUR")
 * @param dateCol     The column letter containing the date for VLOOKUP (e.g. "C", "A")
 * @param ccyCol      The column letter containing the currency for INDIRECT (e.g. "D", "C")
 *                    Pass a literal currency code (e.g. "USD") to use INDIRECT("USD!A:B") instead
 * @param rowNum      The 1-based row number for formula references
 */
export function setFxRateCell(
    cell: Cell,
    currency: string,
    baseCurrency: string,
    dateCol: string,
    ccyCol: string,
    rowNum: number,
): void {
    if (currency === baseCurrency) {
        cell.value = 1;

        return;
    }

    if (baseCurrency === 'BGN') {
        if (currency === 'EUR') {
            cell.value = 1.95583;

            return;
        }

        if (currency === 'BGN') {
            cell.value = 1;

            return;
        }
    } else {
        if (currency === 'EUR') {
            cell.value = 1;

            return;
        }

        if (currency === 'BGN') {
            cell.value = { formula: '1/1.95583' };

            return;
        }
    }

    // Dynamic VLOOKUP into the currency's FX sheet
    const ccyRef = ccyCol.match(/^[A-Z]+$/)
        ? `${ccyCol}${rowNum}` // column reference like D2
        : `"${ccyCol}"`; // literal currency string like "USD"

    cell.value = { formula: `IFERROR(VLOOKUP(${dateCol}${rowNum},INDIRECT(${ccyRef}&"!A:B"),2,FALSE),"")` };
}
