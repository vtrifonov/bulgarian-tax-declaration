import type { IBDividend, IBWithholdingTax, Dividend } from '../types/index.js';

interface MatchResult {
  matched: Dividend[];
  unmatched: Dividend[];
}

export function matchWhtToDividends(
  dividends: IBDividend[],
  whts: IBWithholdingTax[],
): MatchResult {
  // Step 1: Combine WHT entries by symbol+date+currency
  const whtMap = new Map<string, number>();
  for (const w of whts) {
    const key = `${w.symbol}|${w.date}|${w.currency}`;
    whtMap.set(key, (whtMap.get(key) ?? 0) + w.amount);
  }

  const matched: Dividend[] = [];
  const matchedKeys = new Set<string>();

  // Step 2: Match combined WHT to combined dividends
  for (const d of dividends) {
    const key = `${d.symbol}|${d.date}|${d.currency}`;
    const whtAmount = whtMap.get(key) ?? 0;
    matchedKeys.add(key);

    matched.push({
      symbol: d.symbol,
      country: '', // Filled later by country-map
      date: d.date,
      currency: d.currency,
      grossAmount: d.amount,
      withholdingTax: Math.abs(whtAmount), // Normalize to positive
      bgTaxDue: 0,   // Filled later by tax calculator
      whtCredit: 0,   // Filled later by tax calculator
    });
  }

  // Step 3: Unmatched WHT → standalone rows
  const unmatched: Dividend[] = [];
  for (const [key, amount] of whtMap) {
    if (matchedKeys.has(key)) continue;
    const [symbol, date, currency] = key.split('|');
    unmatched.push({
      symbol,
      country: '',
      date,
      currency,
      grossAmount: 0,
      withholdingTax: Math.abs(amount),
      bgTaxDue: 0,
      whtCredit: 0,
      notes: 'Unmatched WHT — prior-year adjustment or missing dividend',
    });
  }

  return { matched, unmatched };
}
