# Provider Abstraction, Country Resolution & Contribution Guidelines — Design Spec

## Problem

The codebase has no shared interface for broker providers. Each provider (IB, Revolut) is implemented as inline logic in Import.tsx, making it hard for contributors to add new brokers. Country resolution is a hardcoded map of ~40 symbols. AGENTS.md and README.md are outdated.

## Goals

1. Define a `BrokerProvider` interface so new providers plug in without modifying Import.tsx
2. Auto-resolve unknown stock symbols to countries via OpenFIGI API (with hardcoded map as fast path)
3. Unify interest entries across providers into a single `BrokerInterest` model
4. Update AGENTS.md with Code Principles, accurate coverage thresholds, provider contribution guidelines, test patterns, and Excel round-trip contract
5. Update README.md with corrected instructions, contributing section, and accurate privacy notice

---

## 1. Provider Abstraction

### Type Renames

- `IBTrade` → `Trade` (used by all providers, not IB-specific)
- `IBInterestEntry` → `InterestEntry`
- `IBParsedData` → removed (replaced by `BrokerProviderResult`)
- `IBDividend` / `IBWithholdingTax` — stay as-is (only used internally by the IB parser)

All callers of `IBTrade` and `IBInterestEntry` must be updated: `types/index.ts`, `fifo/engine.ts`, `revolut-investments.ts`, `excel-full-import.ts`, `ib-csv.ts`, all test files.

### Types

```typescript
// packages/core/src/providers/types.ts

interface BrokerProviderResult {
    trades?: Trade[];
    dividends?: Dividend[];        // WHT already matched, tax calculated
    interest?: InterestEntry[];    // Broker interest (IB margin, debit, credit)
    stockYield?: StockYieldEntry[];
    savingsInterest?: BrokerInterest;  // Per-currency savings interest (Revolut)
    warnings?: string[];
}

interface FileHandler {
    id: string;                    // e.g. 'revolut-savings', 'ib-activity'
    detectFile(content: string, filename: string): boolean;
    parseFile(content: string): BrokerProviderResult;
}

interface ExportInstruction {
    label: string;                 // i18n key for the heading
    steps: string[];               // i18n keys for each numbered step
}

interface BrokerProvider {
    name: string;                  // e.g. 'IB', 'Revolut'
    fileHandlers: FileHandler[];
    exportInstructions: ExportInstruction[];
}
```

### File handler detection rules

Detection must be **strict** to avoid false positives:
- Match on 3+ columns or a unique header signature (not just "Date,Amount")
- Content-based detection takes priority over filename-based
- First matching handler wins — providers registered in order of specificity (most specific first)
- `detectFile` must never throw — return `false` on any error

### Registry

`packages/core/src/providers/registry.ts`:

```typescript
import { ibProvider } from './ib.js';
import { revolutProvider } from './revolut.js';

export const providers: BrokerProvider[] = [ibProvider, revolutProvider];
```

### Provider implementations

Each provider lives in `packages/core/src/providers/{name}.ts`:

**IB provider** (`providers/ib.ts`):
- One file handler: `ib-activity`
- Detects: `content.startsWith('Statement,Header,Field Name')`
- Internally calls `parseIBCsv()`, `matchWhtToDividends()`, `calcDividendTax()`
- Returns: trades, dividends (with WHT matched + tax calculated), interest, stockYield

**Revolut provider** (`providers/revolut.ts`):
- Two file handlers:
  - `revolut-savings` — detects `Interest PAID` in content or filename starts with `savings-statement`, returns `savingsInterest`
  - `revolut-investments` — detects header `Date,Ticker,Type`, returns `trades` (converted to `Trade[]` format for FIFO)
- Export instructions for both file types

### Import.tsx refactor

Replace inline provider logic with:

```typescript
import { providers } from '@bg-tax/core';

// Detection: first matching handler wins
let matched = false;
for (const provider of providers) {
    for (const handler of provider.fileHandlers) {
        if (handler.detectFile(content, filename)) {
            const result = handler.parseFile(content);
            await processProviderResult(result, provider.name, filename);
            matched = true;
            break;
        }
    }
    if (matched) break;
}
if (!matched) {
    setError('Unrecognized file format.');
}
```

### Shared post-processing: `processProviderResult()`

```typescript
interface ProcessProviderResultOptions {
    result: BrokerProviderResult;
    brokerName: string;
    filename: string;
    existingHoldings: Holding[];
    appStore: AppStore;
}

async function processProviderResult(options: ProcessProviderResultOptions): Promise<void> {
    const { result, brokerName, filename, existingHoldings, appStore } = options;
    const source: DataSource = { type: brokerName, file: filename };

    // 1. Resolve countries for all symbols (async, batched)
    const allSymbols: { symbol: string; currency: string }[] = [];
    if (result.trades) {
        for (const t of result.trades) allSymbols.push({ symbol: t.symbol, currency: t.currency });
    }
    if (result.dividends) {
        for (const d of result.dividends) allSymbols.push({ symbol: d.symbol, currency: d.currency });
    }
    const countryMap = await resolveCountries(allSymbols);

    // 2. FIFO engine for trades
    if (result.trades) {
        const fifo = new FifoEngine([...existingHoldings]);
        const { holdings, sales, warnings } = fifo.processTrades(result.trades, brokerName, countryMap);
        for (const h of holdings) if (!h.source) h.source = source;
        for (const s of sales) if (!s.source) s.source = source;
        appStore.importHoldings(holdings);
        appStore.importSales(sales);
    }

    // 3. Dividends (country already resolved by provider or here)
    if (result.dividends) {
        for (const d of result.dividends) {
            if (!d.country) d.country = countryMap[d.symbol] ?? '';
            if (!d.source) d.source = source;
        }
        appStore.importDividends(result.dividends);
    }

    // 4. Interest entries → BrokerInterest
    if (result.interest) {
        // Group by currency
        const byCurrency = new Map<string, InterestEntry[]>();
        for (const e of result.interest) {
            if (!e.source) e.source = source;
            const arr = byCurrency.get(e.currency) ?? [];
            arr.push(e);
            byCurrency.set(e.currency, arr);
        }
        for (const [currency, entries] of byCurrency) {
            appStore.addBrokerInterest({ broker: brokerName, currency, entries });
        }
    }

    // 5. Savings interest (already grouped by currency)
    if (result.savingsInterest) {
        appStore.addBrokerInterest(result.savingsInterest);
    }

    // 6. Stock yield
    if (result.stockYield) {
        for (const s of result.stockYield) if (!s.source) s.source = source;
        appStore.importStockYield(result.stockYield);
    }
}
```

Export instructions rendered dynamically from `provider.exportInstructions` using `t()` for each key.

### Provider type organization

- **Shared interfaces** (`BrokerProvider`, `FileHandler`, `BrokerProviderResult`): `packages/core/src/providers/types.ts`
- **Global types** (`AppState`, `Holding`, `Trade`, `InterestEntry`): `packages/core/src/types/index.ts`
- **Provider-internal types** (e.g. IB-specific parsing helpers): inside the provider file, not exported

---

## 2. Unified Interest Model

### InterestEntry (renamed from IBInterestEntry)

```typescript
interface InterestEntry {
    currency: string;
    date: string;
    description: string;
    amount: number;
    source?: DataSource;
}
```

### BrokerInterest

```typescript
interface BrokerInterest {
    broker: string;      // 'IB', 'Revolut', 'Trading212'
    currency: string;    // 'USD', 'EUR', 'GBP'
    entries: InterestEntry[];
}
```

### AppState change

Replace `ibInterest: IBInterestEntry[]` and `revolutInterest: RevolutInterest[]` with:

```typescript
interface AppState {
    // ... existing fields (holdings, sales, dividends, stockYield, fxRates, manualEntries)
    brokerInterest: BrokerInterest[];
}
```

### Excel sheets

One sheet per broker+currency combo: `IB Лихви USD`, `IB Лихви EUR`, `Revolut Лихви EUR`, `Revolut Лихви GBP`.

All interest types for a broker+currency go in one sheet (IB debit interest, credit interest, SYEP interest all in `IB Лихви USD`).

Sheet columns: Дата | Описание | Сума (same as current IB Лихви sheet).

### importFullExcel sheet reading

`importFullExcel` reads interest sheets using this logic:

```typescript
// Find all sheets matching "{Broker} Лихви {Currency}" pattern
for (const ws of workbook.worksheets) {
    const match = ws.name.match(/^(.+)\s+Лихви\s+([A-Z]{3})$/);
    if (match) {
        const broker = match[1];    // e.g. 'IB', 'Revolut'
        const currency = match[2];  // e.g. 'USD', 'EUR'
        const entries = readInterestRows(ws);
        brokerInterest.push({ broker, currency, entries });
    }
}
```

Broker name is parsed from the sheet name — no extra column needed.

### Backwards compatibility

Existing Excel files have `IB Лихви` (no currency suffix) and `Revolut {CCY}` sheets. `importFullExcel` must handle both old and new formats:

```typescript
// New format: "{Broker} Лихви {CCY}"
const newMatch = ws.name.match(/^(.+)\s+Лихви\s+([A-Z]{3})$/);
if (newMatch) { /* ... */ }

// Old format: "IB Лихви" (all currencies in one sheet)
if (ws.name === 'IB Лихви') {
    const entries = readInterestRows(ws);
    // Group by currency column
    // ...
}

// Old format: "Revolut {CCY}" detail sheets
if (ws.name.match(/^Revolut\s+[A-Z]{3}$/) && ws.name !== 'Revolut Лихва') {
    // Read as before
}
```

### Migration for saved state

`loadAutoSave()` must detect and migrate old format:

```typescript
function migrateState(saved: any): any {
    // Migrate ibInterest + revolutInterest → brokerInterest
    if (saved.ibInterest && !saved.brokerInterest) {
        const brokerInterest: BrokerInterest[] = [];

        // Group IB interest by currency
        const byCurrency = new Map<string, InterestEntry[]>();
        for (const e of saved.ibInterest) {
            const arr = byCurrency.get(e.currency) ?? [];
            arr.push(e);
            byCurrency.set(e.currency, arr);
        }
        for (const [currency, entries] of byCurrency) {
            brokerInterest.push({ broker: 'IB', currency, entries });
        }

        // Convert Revolut interest
        if (saved.revolutInterest) {
            for (const ri of saved.revolutInterest) {
                brokerInterest.push({ broker: 'Revolut', currency: ri.currency, entries: ri.entries });
            }
        }

        saved.brokerInterest = brokerInterest;
        delete saved.ibInterest;
        delete saved.revolutInterest;
    }
    return saved;
}
```

---

## 3. Country Resolution with OpenFIGI

### Current

Hardcoded `COUNTRY_MAP` in `country-map.ts`. Unknown symbols → empty string.

### Proposed

Two functions:

```typescript
// Sync — checks hardcoded map only (for tests, non-async contexts)
function resolveCountrySync(symbol: string): string;

// Async — checks map, then OpenFIGI fallback
async function resolveCountry(symbol: string, currency: string): Promise<string>;

// Batch async — resolves all at once (preferred for imports)
async function resolveCountries(
    symbols: { symbol: string; currency: string }[]
): Promise<Record<string, string>>;
```

### resolveCountries implementation

1. Deduplicate input symbols
2. Check hardcoded map for each — collect unknowns
3. If unknowns exist, call OpenFIGI API in one batch (up to 100 items)
4. Map `exchCode` → Bulgarian country name
5. Cache results in runtime map
6. Return combined map

### OpenFIGI API details

- **Endpoint:** `POST https://api.openfigi.com/v3/mapping`
- **Body:** `[{idType: "TICKER", idValue: "AAPL", currency: "USD"}, ...]`
- **No API key** needed for <20 requests/minute (batch counts as 1 request)
- **Timeout:** 5 seconds — if exceeded, skip API and return empty for unknowns
- **Rate limit:** Check `X-RateLimit-Remaining` header; if 0, skip and return empty
- **Error handling:** Log warning, return empty string for failed symbols. Never throw.
- **User feedback:** If any symbols failed to resolve, add a warning to the import result (e.g. "Could not resolve country for: UNKNOWN1, UNKNOWN2")

### Exchange code → country mapping

```typescript
const EXCHANGE_COUNTRY: Record<string, string> = {
    US: 'САЩ', UA: 'САЩ', UN: 'САЩ', UB: 'САЩ', UC: 'САЩ', UM: 'САЩ', UP: 'САЩ',
    NA: 'Нидерландия (Холандия)',
    GY: 'Германия',
    LN: 'Великобритания',
    HK: 'Хонконг', H1: 'Хонконг', H2: 'Хонконг',
    FP: 'Франция',
    IM: 'Италия',
    SM: 'Испания',
    SJ: 'Швейцария',
    AU: 'Австралия',
    JT: 'Япония',
    ID: 'Ирландия',
    SS: 'Швеция',
    DC: 'Дания',
    NO: 'Норвегия',
    PL: 'Полша',
};
```

### Callers that need updating (async migration)

All 8 locations using `resolveCountry`:
1. `packages/ui/src/pages/Import.tsx` (4 call sites) → replaced by single `resolveCountries()` in `processProviderResult()`
2. `packages/core/tests/integration/round-trip.test.ts` (`buildAppStateFromIB`, `buildFullState`) → use `resolveCountrySync()` or make test helpers async
3. `packages/core/tests/country-map.test.ts` → add async test cases, keep sync tests for `resolveCountrySync`
4. `packages/core/src/index.ts` → export both sync and async versions

---

## 4. Excel Round-trip Contract

### Core invariant

**`parse CSV → export Excel → re-import Excel → export Excel` must produce identical results.**

### Rules

1. Every data type a provider produces must have a corresponding Excel sheet
2. Sheets must contain all fields needed to reconstruct the data
3. `importFullExcel` must read the sheet back and produce identical arrays (except auto-generated UUIDs)
4. Integration round-trip tests verify: parse → export → import → export → import — counts and values match

### Stored vs computed columns

**Stored** (must be in Excel, read back on import):
- symbol, date, currency, quantity, price, gross amount, WHT, description, broker, country, notes

**Computed** (present in Excel as formulas for display, but recalculated on import — NOT read):
- bgTaxDue (5% × gross - WHT credit)
- whtCredit (min of WHT and 5% tax)
- fxRate (re-fetched from ECB API)
- Total rows / summary formulas

### Floating point precision

- Quantities: preserve to 8 decimal places (Excel numFmt `0.00000000`)
- Prices/amounts: 2 decimal places
- Round-trip comparison in tests uses `toBeCloseTo(value, 6)` for quantities, `toBeCloseTo(value, 2)` for amounts

### Date format

- All dates stored as ISO strings `YYYY-MM-DD` in Excel cells (text, not Excel serial dates)
- NRA export uses `DD.MM.YYYY` format (separate from round-trip)

### ExcelJS access pattern

```typescript
// Safe: access by name
const sheet = workbook.getWorksheet('Притежания');

// Fragile: DO NOT access by index
const sheet = workbook.worksheets[0]; // Don't do this
```

### Sample files

Each provider must include sample files in `samples/`:
- Named by handler ID: `samples/{handler-id}.csv` (or `.xlsx`)
- Use real company symbols (AAPL, MSFT) — public info
- Use fake but realistic values (quantities 1-1000, realistic prices, past dates)
- No real account numbers, user names, emails, or tax amounts
- Must cover all data types the handler supports
- Must include edge cases: multiple currencies, fractional quantities, buys + sells

Existing samples to rename for consistency:
- `samples/ib-report.csv` → `samples/ib-activity.csv`
- `samples/revolut-eur.csv` → `samples/revolut-savings-eur.csv`
- `samples/revolut-gbp.csv` → `samples/revolut-savings-gbp.csv`
- `samples/revolut-investments.csv` — already correct

All test file references (8 locations in `round-trip.test.ts`, fixtures in other tests) must be updated to match.

---

## 5. Export Instructions (Corrected)

### Interactive Brokers

1. Go to **Performance & Reports → Statements**
2. Click **Activity Statement**
3. Period: **Annual**, Date: the tax year
4. Click **Download CSV**

### Revolut Investments

1. Go to **Invest** tab
2. Tap the **chart icon** (top right) → **Documents**
3. Select **Brokerage account**
4. Tap **Account statement**
5. Select **Excel** format
6. Period: **Tax year**, select the year
7. Tap **Get statement**

### Revolut Savings

1. Go to **Savings & Funds**
2. Tap the specific fund (e.g. Flexible Cash Funds GBP)
3. Tap **...** menu → **Statement**
4. Select **Excel** format
5. Period: **Tax year**, select the year
6. Tap **Generate**
7. Repeat for each currency fund

### i18n key convention

Keys follow the pattern `provider.{name}.instructions.{handler}.label` and `provider.{name}.instructions.{handler}.step{N}`:

```typescript
// bg.ts
'provider.ib.instructions.activity.label': 'Interactive Brokers',
'provider.ib.instructions.activity.step1': 'Отидете на Performance & Reports → Statements',
'provider.ib.instructions.activity.step2': 'Кликнете Activity Statement',
'provider.ib.instructions.activity.step3': 'Период: Annual, Дата: данъчната година',
'provider.ib.instructions.activity.step4': 'Кликнете Download CSV',

'provider.revolut.instructions.investments.label': 'Revolut Инвестиции',
'provider.revolut.instructions.investments.step1': 'Отидете на таб Invest',
// ... etc
```

Import.tsx renders them dynamically:

```tsx
{providers.map(p => p.exportInstructions.map(instr => (
    <div key={instr.label}>
        <strong>{t(instr.label)}</strong>
        <ol>
            {instr.steps.map(step => <li key={step}>{t(step)}</li>)}
        </ol>
    </div>
)))}
```

---

## 6. AGENTS.md Updates

### Add: Code Principles section (after Code Style)

```markdown
## Code Principles

- **KISS** — prefer simple, readable solutions over clever ones
- **SOLID** — single responsibility per function/module, depend on abstractions not concretions
- **DRY** — avoid duplicating non-trivial logic or UI across files; extract the shared core into a reusable component/function even if currently used in only 2 places
- **Small functions** — each function does one thing; if it needs a comment explaining what, it's too big
- **No over-engineering** — solve the current problem, not hypothetical future ones
- **Options object for many parameters** — when a function has more than 4 parameters, use a single options object instead of positional arguments. Export the options interface so callers can type-check.
```

With the example from the user's request (FillRollupsOptions pattern).

### Fix: Coverage threshold

"Minimum 50% code coverage" → "Minimum 70% code coverage (enforced by vitest threshold in `packages/core/vitest.config.ts`). Override with `SKIP_COVERAGE_CHECK=1` if needed."

### Fix: Public status

"This repo will be made public eventually" → "This repo is public" — remove all speculative language about future public release.

### Add: Test Fixtures and Patterns section

```markdown
## Test Fixtures and Patterns

### Fixture location
- CSV/Excel test data: `packages/core/tests/fixtures/{parser-name}-*.csv`
- Sample import files: `samples/{handler-id}.csv`

### Parser test pattern
Load fixtures once per suite:
```typescript
const fixture = readFileSync(join(__dirname, '../fixtures/your-minimal.csv'), 'utf-8');
describe('parseYourCsv', () => {
    const result = parseYourCsv(fixture);
    it('parses trades', () => expect(result.trades).toHaveLength(3));
    it('handles empty input', () => expect(parseYourCsv('').trades).toHaveLength(0));
});
```

### Round-trip integration test pattern
Verify: parse → export → import → export → import = identical
```typescript
it('round-trips through Excel', async () => {
    const state = buildStateFromProvider(csv);
    const buf1 = await generateExcel(state);
    const reimported = await importFullExcel(buf1.buffer);
    const buf2 = await generateExcel({ ...state, ...reimported });
    const reimported2 = await importFullExcel(buf2.buffer);
    expect(reimported2.holdings.length).toBe(reimported.holdings.length);
});
```

### Mocking external APIs
Use `vi.fn()` for OpenFIGI/ECB mocks:
```typescript
vi.mock('../../src/country-map.js', () => ({
    resolveCountries: vi.fn().mockResolvedValue({ AAPL: 'САЩ' }),
}));
```

### Fixture data guidelines
- Use real company symbols (AAPL, MSFT) — public info
- Use fake but realistic values (quantities, prices, dates)
- No real account numbers, emails, or tax amounts
- Cover edge cases: fractional quantities, multiple currencies
```

### Add: Excel Round-trip Contract section

```markdown
## Excel Round-trip Contract

**Core invariant:** `parse CSV → export Excel → re-import Excel → export Excel` produces identical results.

Rules:
1. Every data type a provider produces must have a corresponding Excel sheet
2. Sheets must contain all stored fields (symbol, date, currency, quantity, price, amounts)
3. Computed fields (bgTaxDue, whtCredit, fxRate) are formulas in Excel but recalculated on import
4. `importFullExcel` must read sheets back and produce identical arrays (except auto-generated UUIDs)
5. Integration tests verify the full round-trip
6. Use `workbook.getWorksheet(name)` — never access sheets by index

Floating point: quantities to 8 decimals, amounts to 2. Tests use `toBeCloseTo()`.
Dates: ISO `YYYY-MM-DD` strings in cells.
```

### Add: Adding a Provider section

```markdown
## Adding a New Broker Provider

1. **Create provider** at `packages/core/src/providers/{name}.ts`
   - Implement `BrokerProvider` interface (see `providers/ib.ts` as reference)
   - Each file type gets a `FileHandler` with strict `detectFile()` and `parseFile()`
   - Provider-specific types stay inside the provider file
2. **Register** in `packages/core/src/providers/registry.ts`
3. **Export** from `packages/core/src/index.ts`
4. **Add sample files** to `samples/{handler-id}.csv` with synthetic data covering all data types
5. **Add i18n keys** for export instructions in `packages/core/src/i18n/bg.ts` and `en.ts`
6. **Write parser tests** in `packages/core/tests/parsers/{name}.test.ts`
7. **Add integration round-trip test case** in `tests/integration/round-trip.test.ts`
8. **Verify Excel round-trip:** parse → export → import → export → import = identical counts and values
9. **Run full test suite** and verify 70% coverage maintained
```

---

## 7. README.md Updates

### Fix: Privacy notice (line 5)

"Nothing is sent to any server — everything is stored in your browser's local storage" → "Your tax data is stored only locally. Nothing is sent to any server."

### Fix: Data Sources (line 188-190)

Add Revolut Investments:

```markdown
- **Interactive Brokers**: CSV activity statement — trades, dividends, WHT, stock yield, interest
- **Revolut Savings**: Statement per currency fund — interest paid, service fees
- **Revolut Investments**: Account statement — trades (buys/sells)
- **FX Rates**: Auto-fetched from ECB API (cached locally)
```

### Add: `test:coverage` to Commands table

### Add: Contributing section

```markdown
## Contributing

We welcome contributions, especially new broker providers! See [AGENTS.md](./AGENTS.md) for:
- Code principles and style guide
- Step-by-step guide for adding a new broker provider
- Testing requirements and Excel round-trip contract
- Before-push checklist
```

### Fix: Export instructions in Data Sources

Reference corrected Revolut paths from Section 5.

---

## 8. Files Changed

### New
- `packages/core/src/providers/types.ts` — BrokerProvider, FileHandler, BrokerProviderResult, ExportInstruction
- `packages/core/src/providers/registry.ts` — provider registry array
- `packages/core/src/providers/ib.ts` — IB provider wrapping existing parsers
- `packages/core/src/providers/revolut.ts` — Revolut provider wrapping existing parsers

### Modified
- `packages/core/src/types/index.ts` — rename `IBTrade` → `Trade`, `IBInterestEntry` → `InterestEntry`, add `BrokerInterest`, update `AppState`
- `packages/core/src/country-map.ts` — add async `resolveCountry(symbol, currency)`, `resolveCountries()` batch, `resolveCountrySync()`, OpenFIGI integration
- `packages/core/src/index.ts` — export new types, provider registry, both resolve functions
- `packages/core/src/fifo/engine.ts` — update `IBTrade` → `Trade` in signature
- `packages/core/src/excel/generator.ts` — dynamic interest sheets per broker+currency
- `packages/core/src/excel/sheets/ib-interest-sheet.ts` — split by currency, rename sheets
- `packages/core/src/excel/sheets/revolut-sheet.ts` — rename detail sheets to `Revolut Лихви {CCY}`
- `packages/core/src/parsers/excel-full-import.ts` — pattern-match `{Broker} Лихви {CCY}` + backwards compat for old names
- `packages/core/src/parsers/revolut-investments.ts` — update `IBTrade` → `Trade`
- `packages/ui/src/pages/Import.tsx` — refactor to use provider registry + `processProviderResult()` + dynamic instructions
- `packages/ui/src/store/app-state.ts` — replace `ibInterest`/`revolutInterest` with `brokerInterest: BrokerInterest[]`
- `packages/ui/src/hooks/useAutoSave.ts` — add migration from old to new format
- `packages/core/src/i18n/bg.ts` — add provider instruction keys
- `packages/core/src/i18n/en.ts` — add provider instruction keys
- `AGENTS.md` — Code Principles, coverage threshold, test patterns, Excel contract, provider guide, public status
- `README.md` — privacy fix, data sources, contributing section, export instructions
- `.gitignore` — add `docs/superpowers/`

### Renamed
- `samples/ib-report.csv` → `samples/ib-activity.csv`
- `samples/revolut-eur.csv` → `samples/revolut-savings-eur.csv`
- `samples/revolut-gbp.csv` → `samples/revolut-savings-gbp.csv`

### Tests updated
- `packages/core/tests/integration/round-trip.test.ts` — new sample filenames, `brokerInterest`, async country resolution
- All tests referencing `IBTrade` → `Trade`, `IBInterestEntry` → `InterestEntry`
- New: `packages/core/tests/providers/registry.test.ts` — detection logic tests
- New: `packages/core/tests/country-map-async.test.ts` — OpenFIGI tests with mocked API
- New: `packages/core/tests/migration/auto-save-migration.test.ts` — old→new state migration
- New: `packages/core/tests/excel/import-backwards-compat.test.ts` — old sheet name reimport
- Update: `packages/core/tests/i18n.test.ts` — verify provider instruction keys exist

### Sample file renames

Rename files AND update all test references in one atomic commit to avoid broken tests:
- Rename 3 sample files (see Renamed section above)
- Update 8 references in `round-trip.test.ts` (lines 75, 110-111, 131, 202-204, 273, 278)
- Update any fixture references in other test files

---

## 9. Required Test Suites

All tests listed below MUST be in place before merging the provider abstraction refactor. Tests use `resolveCountrySync()` in test helpers (not async) to keep test setup simple.

### 9.1 State Migration Tests (`tests/migration/auto-save-migration.test.ts`)

```typescript
describe('migrateState (old → new AppState)', () => {
    it('migrates ibInterest to brokerInterest grouped by currency', () => {
        const old = { ibInterest: [
            { currency: 'USD', date: '2025-01-06', description: 'Credit', amount: 8.45 },
            { currency: 'EUR', date: '2025-02-10', description: 'Credit', amount: 3.20 },
            { currency: 'USD', date: '2025-02-05', description: 'Debit', amount: -2.87 },
        ]};
        const migrated = migrateState(old);
        expect(migrated.brokerInterest).toHaveLength(2); // USD + EUR
        const usd = migrated.brokerInterest.find(b => b.currency === 'USD');
        expect(usd.broker).toBe('IB');
        expect(usd.entries).toHaveLength(2);
    });

    it('migrates revolutInterest to brokerInterest', () => {
        const old = { revolutInterest: [
            { currency: 'EUR', entries: [{ date: '2025-12-31', description: 'Interest', amount: 0.32 }] },
        ]};
        const migrated = migrateState(old);
        expect(migrated.brokerInterest[0].broker).toBe('Revolut');
    });

    it('migrates both ibInterest and revolutInterest together', () => {
        const old = {
            ibInterest: [{ currency: 'USD', date: '2025-01-06', description: 'Credit', amount: 8.45 }],
            revolutInterest: [{ currency: 'EUR', entries: [{ date: '2025-12-31', description: 'Interest', amount: 0.32 }] }],
        };
        const migrated = migrateState(old);
        expect(migrated.brokerInterest).toHaveLength(2);
        expect(migrated.ibInterest).toBeUndefined();
        expect(migrated.revolutInterest).toBeUndefined();
    });

    it('handles state with neither ibInterest nor revolutInterest', () => {
        const old = { holdings: [], sales: [] };
        const migrated = migrateState(old);
        expect(migrated.brokerInterest).toBeUndefined(); // no migration needed
    });

    it('does not re-migrate already migrated state', () => {
        const already = { brokerInterest: [{ broker: 'IB', currency: 'USD', entries: [] }] };
        const migrated = migrateState(already);
        expect(migrated.brokerInterest).toHaveLength(1); // unchanged
    });

    it('preserves all entry fields during migration', () => {
        const old = { ibInterest: [
            { currency: 'USD', date: '2025-03-06', description: 'USD Credit Interest for 02/2025', amount: 8.45, source: { type: 'IB', file: 'ib.csv' } },
        ]};
        const migrated = migrateState(old);
        const entry = migrated.brokerInterest[0].entries[0];
        expect(entry.date).toBe('2025-03-06');
        expect(entry.description).toBe('USD Credit Interest for 02/2025');
        expect(entry.amount).toBe(8.45);
        expect(entry.source).toEqual({ type: 'IB', file: 'ib.csv' });
    });
});
```

### 9.2 OpenFIGI Country Resolution Tests (`tests/country-map-async.test.ts`)

Mock pattern: use `vi.stubGlobal('fetch')` following the `ecb-api.test.ts` pattern.

```typescript
describe('resolveCountries (async batch)', () => {
    it('resolves known symbols from hardcoded map without API call', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const result = await resolveCountries([{ symbol: 'AAPL', currency: 'USD' }]);
        expect(result['AAPL']).toBe('САЩ');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('batches unknown symbols into single OpenFIGI request', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'X-RateLimit-Remaining': '19' }),
            json: () => Promise.resolve([
                { data: [{ exchCode: 'US' }] },
                { data: [{ exchCode: 'GY' }] },
            ]),
        }));
        const result = await resolveCountries([
            { symbol: 'UNKNOWN1', currency: 'USD' },
            { symbol: 'UNKNOWN2', currency: 'EUR' },
        ]);
        expect(fetch).toHaveBeenCalledTimes(1); // one batch, not two
        expect(result['UNKNOWN1']).toBe('САЩ');
        expect(result['UNKNOWN2']).toBe('Германия');
    });

    it('deduplicates input symbols', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers(),
            json: () => Promise.resolve([{ data: [{ exchCode: 'LN' }] }]),
        }));
        await resolveCountries([
            { symbol: 'NEW', currency: 'GBP' },
            { symbol: 'NEW', currency: 'GBP' },
        ]);
        const body = JSON.parse((fetch as any).mock.calls[0][1].body);
        expect(body).toHaveLength(1); // deduplicated
    });

    it('handles API timeout (5 seconds)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
        ));
        const result = await resolveCountries([{ symbol: 'SLOW', currency: 'USD' }]);
        expect(result['SLOW']).toBe(''); // empty, not crash
    });

    it('handles API returning no results for a symbol', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers(),
            json: () => Promise.resolve([{ data: [] }]),
        }));
        const result = await resolveCountries([{ symbol: 'NOSUCH', currency: 'USD' }]);
        expect(result['NOSUCH']).toBe('');
    });

    it('handles partial API failures gracefully', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers(),
            json: () => Promise.resolve([
                { data: [{ exchCode: 'US' }] },
                { error: 'No match' },
            ]),
        }));
        const result = await resolveCountries([
            { symbol: 'GOOD', currency: 'USD' },
            { symbol: 'BAD', currency: 'USD' },
        ]);
        expect(result['GOOD']).toBe('САЩ');
        expect(result['BAD']).toBe('');
    });

    it('caches results — second call does not re-fetch', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers(),
            json: () => Promise.resolve([{ data: [{ exchCode: 'US' }] }]),
        });
        vi.stubGlobal('fetch', fetchSpy);
        await resolveCountries([{ symbol: 'CACHED', currency: 'USD' }]);
        await resolveCountries([{ symbol: 'CACHED', currency: 'USD' }]);
        expect(fetchSpy).toHaveBeenCalledTimes(1); // cached
    });

    it('handles fetch network error without throwing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        const result = await resolveCountries([{ symbol: 'OFFLINE', currency: 'USD' }]);
        expect(result['OFFLINE']).toBe('');
    });

    it('maps all EXCHANGE_COUNTRY codes correctly', async () => {
        // Verify: US→САЩ, NA→Нидерландия, GY→Германия, LN→Великобритания, HK→Хонконг, etc.
        // This is a sync test against the EXCHANGE_COUNTRY map directly
    });
});

describe('resolveCountrySync', () => {
    it('returns hardcoded map result for known symbols', () => {
        expect(resolveCountrySync('AAPL')).toBe('САЩ');
        expect(resolveCountrySync('CSPX')).toBe('Ирландия');
    });

    it('returns empty string for unknown symbols (no API call)', () => {
        expect(resolveCountrySync('TOTALLY_UNKNOWN')).toBe('');
    });
});
```

### 9.3 Provider Detection Tests (`tests/providers/registry.test.ts`)

```typescript
describe('Provider registry', () => {
    it('exports all registered providers', () => {
        expect(providers.length).toBeGreaterThan(0);
    });

    it('all providers have non-empty fileHandlers', () => {
        for (const p of providers) expect(p.fileHandlers.length).toBeGreaterThan(0);
    });

    it('provider names are unique', () => {
        const names = providers.map(p => p.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('handler IDs are unique across all providers', () => {
        const ids = providers.flatMap(p => p.fileHandlers.map(h => h.id));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('FileHandler detection', () => {
    it('IB: detects by "Statement,Header,Field Name" header', () => {
        const ib = providers.find(p => p.name === 'IB')!;
        const handler = ib.fileHandlers[0];
        expect(handler.detectFile('Statement,Header,Field Name,Field Value\n...', 'report.csv')).toBe(true);
    });

    it('Revolut savings: detects by "Interest PAID" in content', () => {
        const rev = providers.find(p => p.name === 'Revolut')!;
        const handler = rev.fileHandlers.find(h => h.id === 'revolut-savings')!;
        expect(handler.detectFile('Date,Description,"Value, EUR"\n"Dec 31, 2025",Interest PAID EUR Class R,0.32', 'savings.csv')).toBe(true);
    });

    it('Revolut investments: detects by "Date,Ticker,Type" header', () => {
        const rev = providers.find(p => p.name === 'Revolut')!;
        const handler = rev.fileHandlers.find(h => h.id === 'revolut-investments')!;
        expect(handler.detectFile('Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate\n...', 'investments.csv')).toBe(true);
    });

    it('returns false for empty file content', () => {
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                expect(h.detectFile('', 'empty.csv')).toBe(false);
            }
        }
    });

    it('returns false for binary content (no crash)', () => {
        const binary = '\xFF\xD8\xFF\xE0\x00\x10JFIF';
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                expect(h.detectFile(binary, 'image.jpg')).toBe(false);
            }
        }
    });

    it('returns false for generic CSV that matches no provider', () => {
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                expect(h.detectFile('Name,Age,City\nAlice,30,Sofia', 'data.csv')).toBe(false);
            }
        }
    });

    it('content-based detection works regardless of filename', () => {
        const ib = providers.find(p => p.name === 'IB')!;
        expect(ib.fileHandlers[0].detectFile('Statement,Header,Field Name,Field Value\n...', 'wrong-name.txt')).toBe(true);
    });

    it('first matching handler wins when iterating registry', () => {
        // Verify that the registry iteration pattern stops at first match
        const content = 'Statement,Header,Field Name,Field Value\nStatement,Data,BrokerName,IB';
        let matchCount = 0;
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                if (h.detectFile(content, 'test.csv')) matchCount++;
            }
        }
        expect(matchCount).toBe(1); // only one handler should match
    });

    it('handles malformed CSV without crashing', () => {
        const malformed = '"unclosed quote,field\n"another,broken';
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                expect(() => h.detectFile(malformed, 'bad.csv')).not.toThrow();
            }
        }
    });
});
```

### 9.4 Excel Backwards Compatibility Tests (`tests/excel/import-backwards-compat.test.ts`)

```typescript
describe('importFullExcel backwards compatibility', () => {
    it('reads old "IB Лихви" sheet (no currency suffix) grouping by currency column', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('IB Лихви');
        ws.addRow(['Дата', 'Валута', 'Описание', 'Сума']);
        ws.addRow(['2025-01-06', 'USD', 'USD Debit Interest', -3.22]);
        ws.addRow(['2025-03-06', 'EUR', 'EUR Credit Interest', 1.50]);
        ws.addRow(['2025-03-06', 'USD', 'USD Credit Interest', 8.45]);
        const buf = await wb.xlsx.writeBuffer();

        const result = await importFullExcel(buf);
        expect(result.brokerInterest).toHaveLength(2); // USD + EUR
        const usd = result.brokerInterest.find(b => b.currency === 'USD');
        expect(usd!.broker).toBe('IB');
        expect(usd!.entries).toHaveLength(2);
    });

    it('reads old "Revolut {CCY}" detail sheets', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Revolut EUR');
        ws.addRow(['Дата', 'Описание', 'Сума']);
        ws.addRow(['2025-12-31', 'Interest PAID', 0.32]);
        ws.addRow(['2025-12-31', 'Service Fee', -0.14]);
        const buf = await wb.xlsx.writeBuffer();

        const result = await importFullExcel(buf);
        expect(result.brokerInterest).toHaveLength(1);
        expect(result.brokerInterest[0].broker).toBe('Revolut');
        expect(result.brokerInterest[0].currency).toBe('EUR');
        expect(result.brokerInterest[0].entries).toHaveLength(2);
    });

    it('reads new "{Broker} Лихви {CCY}" format', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('IB Лихви USD');
        ws.addRow(['Дата', 'Описание', 'Сума']);
        ws.addRow(['2025-03-06', 'USD Credit Interest', 8.45]);
        const buf = await wb.xlsx.writeBuffer();

        const result = await importFullExcel(buf);
        expect(result.brokerInterest).toHaveLength(1);
        expect(result.brokerInterest[0].broker).toBe('IB');
        expect(result.brokerInterest[0].currency).toBe('USD');
    });

    it('handles mixed old + new formats in same file', async () => {
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('IB Лихви').addRows([
            ['Дата', 'Валута', 'Описание', 'Сума'],
            ['2025-01-06', 'USD', 'Old format', 1.00],
        ]);
        wb.addWorksheet('Revolut Лихви GBP').addRows([
            ['Дата', 'Описание', 'Сума'],
            ['2025-12-31', 'New format', 0.18],
        ]);
        const buf = await wb.xlsx.writeBuffer();

        const result = await importFullExcel(buf);
        expect(result.brokerInterest.length).toBeGreaterThanOrEqual(2);
    });

    it('prioritizes new format if both old and new exist for same broker', async () => {
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('IB Лихви').addRows([
            ['Дата', 'Валута', 'Описание', 'Сума'],
            ['2025-01-06', 'USD', 'Old', 1.00],
        ]);
        wb.addWorksheet('IB Лихви USD').addRows([
            ['Дата', 'Описание', 'Сума'],
            ['2025-01-06', 'New', 2.00],
        ]);
        const buf = await wb.xlsx.writeBuffer();

        const result = await importFullExcel(buf);
        const ibUsd = result.brokerInterest.find(b => b.broker === 'IB' && b.currency === 'USD');
        expect(ibUsd!.entries).toHaveLength(1);
        expect(ibUsd!.entries[0].description).toBe('New'); // new format wins
    });
});
```

### 9.5 Round-trip Tests for brokerInterest (`tests/integration/round-trip.test.ts` additions)

```typescript
describe('Round-trip: brokerInterest structure', () => {
    it('exports brokerInterest as {Broker} Лихви {CCY} sheets', async () => {
        const state: AppState = {
            ...baseState,
            brokerInterest: [
                { broker: 'IB', currency: 'USD', entries: [
                    { date: '2025-03-06', description: 'USD Credit Interest', amount: 8.45 },
                ]},
                { broker: 'Revolut', currency: 'EUR', entries: [
                    { date: '2025-12-31', description: 'Interest PAID', amount: 0.32 },
                ]},
            ],
        };
        const buf = await generateExcel(state);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        expect(wb.getWorksheet('IB Лихви USD')).toBeDefined();
        expect(wb.getWorksheet('Revolut Лихви EUR')).toBeDefined();
    });

    it('round-trips brokerInterest through Excel', async () => {
        const state: AppState = { ...baseState, brokerInterest: [
            { broker: 'IB', currency: 'USD', entries: [
                { date: '2025-03-06', description: 'Credit', amount: 8.45 },
                { date: '2025-01-06', description: 'Debit', amount: -3.22 },
            ]},
            { broker: 'Revolut', currency: 'GBP', entries: [
                { date: '2025-12-31', description: 'Interest', amount: 0.18 },
            ]},
        ]};
        const buf = await generateExcel(state);
        const reimported = await importFullExcel(buf.buffer as ArrayBuffer);
        expect(reimported.brokerInterest).toHaveLength(2);
        const ibUsd = reimported.brokerInterest.find(b => b.broker === 'IB' && b.currency === 'USD');
        expect(ibUsd!.entries).toHaveLength(2);
        expect(ibUsd!.entries[0].amount).toBeCloseTo(8.45, 2);
    });

    it('empty brokerInterest produces no interest sheets', async () => {
        const state: AppState = { ...baseState, brokerInterest: [] };
        const buf = await generateExcel(state);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        const interestSheets = wb.worksheets.filter(ws => ws.name.includes('Лихви'));
        expect(interestSheets).toHaveLength(0);
    });

    it('multiple currencies for same broker create separate sheets', async () => {
        const state: AppState = { ...baseState, brokerInterest: [
            { broker: 'IB', currency: 'USD', entries: [{ date: '2025-01-01', description: 'A', amount: 1 }] },
            { broker: 'IB', currency: 'EUR', entries: [{ date: '2025-01-01', description: 'B', amount: 2 }] },
        ]};
        const buf = await generateExcel(state);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        expect(wb.getWorksheet('IB Лихви USD')).toBeDefined();
        expect(wb.getWorksheet('IB Лихви EUR')).toBeDefined();
    });
});
```

### 9.6 Interest Sheet Naming Validation (`tests/excel/generator.test.ts` additions)

```typescript
describe('Interest sheet naming', () => {
    it('generates exact pattern "{Broker} Лихви {CCY}"', async () => {
        // Verify sheet name matches regex /^.+ Лихви [A-Z]{3}$/
    });

    it('handles broker names with spaces (e.g. "Trading 212")', async () => {
        const state: AppState = { ...baseState, brokerInterest: [
            { broker: 'Trading 212', currency: 'USD', entries: [{ date: '2025-01-01', description: 'Interest', amount: 1 }] },
        ]};
        const buf = await generateExcel(state);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf.buffer as ArrayBuffer);
        expect(wb.getWorksheet('Trading 212 Лихви USD')).toBeDefined();
        // Verify reimport can parse broker name with space
        const reimported = await importFullExcel(buf.buffer as ArrayBuffer);
        expect(reimported.brokerInterest[0].broker).toBe('Trading 212');
    });

    it('reimport regex matches only valid currency codes (3 uppercase letters)', async () => {
        // Sheet "IB Лихви usd" (lowercase) → should NOT be matched
        // Sheet "IB Лихви US" (2 chars) → should NOT be matched
        // Sheet "IB Лихви USDD" (4 chars) → should NOT be matched
    });
});
```

### 9.7 Single-Data-Type Provider Tests

```typescript
describe('Provider with partial data types', () => {
    it('processProviderResult handles dividends-only result (no trades)', async () => {
        const result: BrokerProviderResult = {
            dividends: [{ symbol: 'AAPL', country: '', date: '2025-06-15', currency: 'USD', grossAmount: 10, withholdingTax: 1.5, bgTaxDue: 0, whtCredit: 0 }],
        };
        // Should import dividends, skip FIFO (no trades), skip interest, no crash
    });

    it('processProviderResult handles interest-only result (no trades, no dividends)', async () => {
        const result: BrokerProviderResult = {
            interest: [{ currency: 'USD', date: '2025-01-01', description: 'Interest', amount: 5.0 }],
        };
        // Should import interest, skip everything else, no crash
    });

    it('processProviderResult handles empty result (all undefined)', async () => {
        const result: BrokerProviderResult = {};
        // Should do nothing, no crash, no warnings
    });
});
```

### 9.8 i18n Key Completeness Tests (`tests/i18n.test.ts` additions)

```typescript
describe('Provider export instruction i18n keys', () => {
    it('all provider instruction label keys exist in bg.ts and en.ts', () => {
        for (const provider of providers) {
            for (const instr of provider.exportInstructions) {
                expect(t(instr.label)).not.toBe(instr.label); // key resolved, not returned as-is
            }
        }
    });

    it('all provider instruction step keys exist in bg.ts and en.ts', () => {
        for (const provider of providers) {
            for (const instr of provider.exportInstructions) {
                for (const step of instr.steps) {
                    expect(t(step)).not.toBe(step); // key resolved
                }
            }
        }
    });

    it('step keys are numbered consecutively (no gaps)', () => {
        for (const provider of providers) {
            for (const instr of provider.exportInstructions) {
                for (let i = 0; i < instr.steps.length; i++) {
                    expect(instr.steps[i]).toContain(`step${i + 1}`);
                }
            }
        }
    });
});
```

### 9.9 Type Rename Regression Tests

After renaming `IBTrade` → `Trade` and `IBInterestEntry` → `InterestEntry`:

```typescript
describe('Type rename regression', () => {
    it('FifoEngine accepts Trade[] (not IBTrade[])', () => {
        const trades: Trade[] = [{ symbol: 'AAPL', dateTime: '2025-01-15, 14:30:00', quantity: 10, price: 150, proceeds: 0, commission: -1, currency: 'USD' }];
        const fifo = new FifoEngine([]);
        const result = fifo.processTrades(trades, 'TestBroker', { AAPL: 'САЩ' });
        expect(result.holdings).toHaveLength(1);
    });

    it('InterestEntry works in BrokerInterest container', () => {
        const bi: BrokerInterest = {
            broker: 'Test',
            currency: 'USD',
            entries: [{ date: '2025-01-01', description: 'Test', amount: 1.0 }],
        };
        expect(bi.entries[0].amount).toBe(1.0);
    });
});
```
