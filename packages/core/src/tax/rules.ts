const CAPITAL_GAINS_RATE = 0.10;
const DIVIDEND_RATE = 0.05;
const INTEREST_RATE = 0.10;

export function calcCapitalGainsTax(profitInBaseCcy: number): number {
    return Math.max(0, profitInBaseCcy * CAPITAL_GAINS_RATE);
}

export interface DividendTaxResult {
    bgTaxDue: number;
    whtCredit: number;
}

/**
 * @param grossInBaseCcy — positive gross dividend in base currency
 * @param whtInBaseCcy — positive WHT amount in base currency (caller must Math.abs() the IB CSV value)
 */
export function calcDividendTax(grossInBaseCcy: number, whtInBaseCcy: number): DividendTaxResult {
    const bgTaxFull = grossInBaseCcy * DIVIDEND_RATE;
    const whtCredit = Math.min(whtInBaseCcy, bgTaxFull);
    const bgTaxDue = Math.max(0, bgTaxFull - whtInBaseCcy);

    return { bgTaxDue, whtCredit };
}

export function calcInterestTax(grossInBaseCcy: number): number {
    return grossInBaseCcy * INTEREST_RATE;
}

export {
    CAPITAL_GAINS_RATE,
    DIVIDEND_RATE,
    INTEREST_RATE,
};
