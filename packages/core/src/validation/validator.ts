import type { AppState, ValidationWarning } from '../types/index.js';

export function validate(state: AppState): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  warnings.push(...checkUnmatchedWht(state));
  warnings.push(...checkMissingFx(state));
  warnings.push(...checkYearMismatch(state));
  return warnings;
}

function checkUnmatchedWht(state: AppState): ValidationWarning[] {
  return (state.dividends ?? [])
    .filter(d => d.grossAmount === 0 && d.withholdingTax !== 0)
    .map(d => ({
      type: 'unmatched-wht' as const,
      message: `Unmatched WHT for ${d.symbol} on ${d.date}: ${d.withholdingTax}`,
      tab: 'Dividends',
    }));
}

function checkMissingFx(state: AppState): ValidationWarning[] {
  if (state.baseCurrency === 'EUR') return []; // EUR dividends don't need FX
  const warnings: ValidationWarning[] = [];
  for (const d of state.dividends ?? []) {
    if (d.currency !== state.baseCurrency && d.currency !== 'EUR') {
      const rate = state.fxRates?.[d.currency]?.[d.date];
      if (rate === undefined) {
        warnings.push({
          type: 'missing-fx',
          message: `Missing FX rate for ${d.currency} on ${d.date}`,
          tab: 'Dividends',
        });
      }
    }
  }
  return warnings;
}

function checkYearMismatch(state: AppState): ValidationWarning[] {
  const year = String(state.taxYear);
  return (state.dividends ?? [])
    .filter(d => !d.date.startsWith(year))
    .map(d => ({
      type: 'year-mismatch' as const,
      message: `${d.symbol} dividend on ${d.date} is outside tax year ${state.taxYear}`,
      tab: 'Dividends',
    }));
}
