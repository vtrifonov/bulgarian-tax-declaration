export type * from './types/index.js';

export {
    cacheIsin,
    cacheIsinsFromMap,
    ISIN_MAP,
    resolveIsinSync,
    validateIsin,
} from './isin-map.js';
export { gapFillRates } from './fx/gap-fill.js';
export {
    fetchEcbRates,
    fetchYearRates,
} from './fx/ecb-api.js';
export { FxService } from './fx/fx-service.js';
export {
    BGN_EUR_RATE,
    calcDividendRowTax,
    getFxRate,
    toBaseCurrency,
    toBaseCurrencyStr,
} from './fx/convert.js';
export { InMemoryFxCache } from './fx/fx-cache.js';
export type { FxCache } from './fx/fx-cache.js';
export { parseIBCsv } from './parsers/ib-csv.js';
export {
    parseRevolutCsv,
    parseRevolutSavingsPositions,
} from './parsers/revolut-csv.js';
export { parseRevolutInvestmentsCsv } from './parsers/revolut-investments.js';
export { parseRevolutAccountStatement } from './parsers/revolut-account.js';
export { matchWhtToDividends } from './parsers/wht-matcher.js';
export {
    importHoldingsFromCsv,
    importHoldingsFromExcel,
} from './parsers/excel-import.js';
export { importFullExcel } from './parsers/excel-full-import.js';
export type { FullExcelImport } from './parsers/excel-full-import.js';
export {
    getCountryCache,
    resolveCountries,
    resolveCountry,
    resolveCountrySync,
    restoreCountryCache,
} from './country-map.js';
export { providers } from './providers/registry.js';
export type {
    BrokerProvider,
    BrokerProviderResult,
    ExportInstruction,
    FileHandler,
} from './providers/types.js';
export {
    getLanguage,
    setLanguage,
    t,
} from './i18n/index.js';
export { mapToDeclaration } from './declaration/mapper.js';
export type {
    DeclarationField,
    DeclarationSection,
    FormConfig,
    FormConfigField,
    FormConfigSection,
    TaxResults,
} from './declaration/mapper.js';
export {
    FifoEngine,
    type FifoResult,
} from './fifo/engine.js';
export {
    splitOpenPositions,
    type SplitOpenPositionsOpts,
} from './fifo/split-open-positions.js';
export {
    populateDividendFxRates,
    populateSaleFxRates,
} from './fifo/populate-fx.js';
export {
    calcCapitalGainsTax,
    calcDividendTax,
    calcInterestTax,
    type DividendTaxResult,
} from './tax/rules.js';
export {
    type CapitalGainsResult,
    type DividendsTaxResult,
    type RevolutInterestResult,
    type StockYieldResult,
    TaxCalculator,
} from './tax/calculator.js';
export { validate } from './validation/validator.js';
export { generateExcel } from './excel/generator.js';
export { generateNraAppendix8 } from './excel/nra-appendix8.js';
export { generateNraAppendix8Part3 } from './excel/nra-appendix8-part3.js';
export { buildNraFormRows } from './nra/form-data.js';
export type { NraFormRow } from './nra/form-data.js';
export {
    assembleSpb8,
    fxToBaseCurrency,
} from './spb8/assemble.js';
export { generateSpb8Excel } from './spb8/excel-generator.js';
export { fetchYearEndPrices } from './spb8/price-service.js';
export type { YearEndPrice } from './spb8/price-service.js';
export { importPreviousSpb8 } from './spb8/import.js';
