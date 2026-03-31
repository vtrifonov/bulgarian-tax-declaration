# AGENTS.md — Instructions for AI Coding Agents

## Code Principles

- **KISS** — prefer simple, readable solutions over clever ones
- **SOLID** — single responsibility per function/module, depend on abstractions not concretions
- **DRY** — avoid duplicating non-trivial logic; extract shared core into a reusable function
- **Small functions** — each function does one thing; if it needs a comment explaining what, it's too big
- **No over-engineering** — solve the current problem, not hypothetical future ones
- **Options object for many parameters** — when a function has more than 4 parameters, use a single options object. Export the interface so callers can type-check.

## Code Style

- TypeScript strict mode everywhere
- No `any` types in production code (tests can use `as` for fixture construction)
- All tax amounts are **positive** — callers normalize (Math.abs) negative WHT values from IB CSV
- Prefer pure functions; classes only for stateful engines (FifoEngine, FxService)
- No heavy abstractions — keep it simple, direct

## Architecture Rules

- `packages/core` has **zero UI dependencies** — never import React, DOM, or Tauri here
- `packages/ui` depends on `@bg-tax/core` via workspace protocol
- All business logic lives in core — UI only handles rendering and user interaction
- State flows one direction: parsers → FIFO → tax → declaration → Excel
- Provider types in `packages/core/src/providers/types.ts` (BrokerProvider, FileHandler)
- Global types in `packages/core/src/types/index.ts` (AppState, Holding, Trade, InterestEntry)
- Provider-specific internal types stay inside the provider file, not exported
- **Holdings semantics**: active holdings represent end-of-period open positions. Lots that are bought and fully sold within the same imported statement must produce `sales`, but must not remain in `holdings`. Only previously imported holdings may be carried forward as `consumedByFifo` rows for traceability.
- **FIFO matching scope**: match by `symbol` + `currency`, and only against lots from the same broker or brokerless legacy holdings. Do not match a provider's current-statement trades against the same statement's end-of-period holdings snapshot (`Open Positions`, broker holdings summary, etc.).
- **Sale tax classification**: preserve sale venue metadata whenever possible. Sales executed on regulated EU markets go to `Приложение 13` and must not affect `Приложение 5` tax totals. When venue detection is unavailable, default to taxable and let the user correct the sales row manually.
- **Pre-existing holdings pattern**: When a provider imports holdings, if prior-year holdings already exist in the app state, only add new current-year acquisitions (skip pre-existing). This applies to all providers (IB, Revolut, E*TRADE). The `skipPreExisting` flag in `splitOpenPositions` controls this.
- **Deterministic provider import order**: When multiple files are imported together, process them in this order: existing in-app holdings/state first, then `IB`, then `Revolut`, then `E*TRADE`, then `Bondora`.
- When to use **global vs. provider types**: if multiple providers share a type (Trade, Dividend, InterestEntry), it goes in `types/index.ts`. If only one provider needs it (e.g., IB's raw parsed WHT structure), keep it in the provider file.

## Testing Requirements

- **Minimum 70% code coverage** (enforced by vitest threshold in `packages/core/vitest.config.ts`). Override with `SKIP_COVERAGE_CHECK=1` if needed during development — CI enforces 70%.
- Write tests BEFORE implementation (TDD)
- Every new module must have a corresponding test file
- Run `pnpm --filter @bg-tax/core test` after every change to verify nothing broke
- Test edge cases: empty inputs, missing data, boundary values
- **Integration tests** (`tests/integration/round-trip.test.ts`) verify the full pipeline: sample CSV import → Excel export → re-import → export again. Run concurrently via `describe.concurrent`. Uses sample files from `samples/` at repo root.

## Test Fixtures and Patterns

### Fixture location
- CSV/Excel test data: `packages/core/tests/fixtures/{parser-name}-*.csv`
- Sample import files: `samples/{handler-id}.csv`
- PDF test data: mock pdf-parse text output as string constants in test files (no binary PDF fixtures needed)

### Provider parser test template
Create `packages/core/tests/parsers/{provider-name}.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseYourProvider } from '../../src/providers/your-provider.js';

const fixture = readFileSync(join(__dirname, '../fixtures/your-provider-minimal.csv'), 'utf-8');

describe('parseYourProvider', () => {
    const result = parseYourProvider(fixture);

    it('parses trades', () => {
        expect(result.trades).toHaveLength(3);
        const buy = result.trades[0];
        expect(buy.quantity).toBeGreaterThan(0);
        expect(buy.symbol).toBeDefined();
        expect(buy.currency).toMatch(/^[A-Z]{3}$/);
    });

    it('handles empty input gracefully', () => {
        const empty = parseYourProvider('');
        expect(empty.trades ?? []).toHaveLength(0);
    });

    it('handles multi-currency trades', () => {
        const currencies = new Set(result.trades?.map(t => t.currency));
        expect(currencies.size).toBeGreaterThanOrEqual(1);
    });

    // Add tests for each data type your provider produces:
    // dividends, interest, stock yield, open positions
});
```

### Round-trip integration test pattern
Add your provider to `tests/integration/round-trip.test.ts`:
```typescript
describe('Test N: YourProvider full pipeline', () => {
    it('parses CSV, generates Excel, re-imports and verifies', async () => {
        const csv = readFileSync(join(SAMPLES, 'your-provider.csv'), 'utf-8');
        const state = buildAppStateFromYourProvider(csv);
        const buf1 = await generateExcel(state);
        const reimported = await importFullExcel(buf1.buffer as ArrayBuffer);
        // Verify counts match
        expect(reimported.holdings.length).toBe(state.holdings.length);
        expect(reimported.sales.length).toBe(state.sales.length);
        // Second round-trip
        const buf2 = await generateExcel({ ...state, ...reimported });
        const reimported2 = await importFullExcel(buf2.buffer as ArrayBuffer);
        expect(reimported2.holdings.length).toBe(reimported.holdings.length);
    });
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
- Use fake but realistic values (quantities 1-1000, realistic prices, past dates)
- No real account numbers, emails, or tax amounts
- Cover edge cases: fractional quantities (0.005 shares), multiple currencies, buy+sell pairs
- Minimum fixture: enough rows to test all data types the provider supports
- Store quantities to 8 decimal places in tests, amounts to 2

## Excel Round-trip Contract

**Core invariant:** `parse CSV → export Excel → re-import Excel → export Excel` produces identical results.

Rules:
1. Every data type a provider produces must have a corresponding Excel sheet
2. Sheets must contain all stored fields (symbol, date, currency, quantity, price, amounts)
3. Computed fields (bgTaxDue, whtCredit, fxRate) are formulas in Excel but preserved on import
4. `importFullExcel` must read sheets back and produce identical arrays (except auto-generated UUIDs)
5. Integration tests verify the full round-trip
6. Use `workbook.getWorksheet(name)` — never access sheets by index
7. Sales rows must round-trip their exchange and tax classification so Appendix 5 vs Appendix 13 routing survives export/import

Floating point: quantities to 8 decimals, amounts to 2. Tests use `toBeCloseTo()`.
Dates: ISO `YYYY-MM-DD` strings in cells.

### Sheet mapping for data types
| Data Type | Sheet Name Pattern | Generator | Importer |
|-----------|-------------------|-----------|----------|
| Holdings | `Притежания` | `sheets/holdings-sheet.ts` | `excel-import.ts` |
| Sales | `Продажби` | `sheets/sales-sheet.ts` | `excel-full-import.ts` |
| Dividends | `Дивиденти` | `sheets/dividends-sheet.ts` | `excel-full-import.ts` |
| Stock Yield | `IB Stock Yield` | `sheets/stock-yield-sheet.ts` | `excel-full-import.ts` |
| Broker Interest | `{Broker} Лихви {CCY}` | `sheets/broker-interest-sheet.ts` | `excel-full-import.ts` |
| SPB-8 Accounts | `СПБ-8 Сметки` | `sheets/spb8-accounts-sheet.ts` | `excel-full-import.ts` |
| SPB-8 Personal Data | `СПБ-8 Лични Данни` | `sheets/spb8-personal-sheet.ts` | `excel-full-import.ts` |
| SPB-8 Securities | `СПБ-8 Ценни Книжа` | `sheets/spb8-securities-sheet.ts` | `excel-full-import.ts` |
| Savings Securities | `Спестовни Ценни Книжа` | `sheets/savings-securities-sheet.ts` | `excel-full-import.ts` |
| FX Rates | `{CCY}` | `sheets/fx-sheet.ts` | `excel-full-import.ts` |

If your provider produces a new data type not in this table, you must:
1. Create a new sheet generator in `packages/core/src/excel/sheets/`
2. Add import logic in `packages/core/src/parsers/excel-full-import.ts`
3. Register the sheet in `packages/core/src/excel/generator.ts`

## NRA Form Filler

### Architecture

- `packages/core/src/nra/form-data.ts` — `buildNraFormRows()`: pure function, transforms `Dividend[]` → `NraFormRow[]`
- `packages/ui/src/hooks/useNraFiller.ts` — React hook: generates fill script (clipboard) or spawns Playwright sidecar (browser)
- `scripts/nra-fill-form.mjs` — Standalone Playwright sidecar (desktop only)

### NRA Form Field IDs (Приложение 8, Част III)

Pattern: `A8D5:N_fieldname` where N is 1-based row number.

| Field | ID suffix | Type | Notes |
|-------|-----------|------|-------|
| Name | `_name` | text | Company/symbol |
| Country | `_country` | select | Bulgarian names (e.g., "САЩ") |
| Income code | `_incomecode` | select | 8141 for dividends |
| Method code | `_methodcode` | select | Always 1 |
| Gross amount | `_sum` | text | Col 6 |
| Acquisition cost | `_value` | text | Col 7, only for code 8142 |
| Difference | `_diff` | text | Auto-calculated, skip |
| Foreign tax | `_paidtax` | text | Col 9 |
| Allowed credit | `_permitedtax` | text | Col 10 |
| Recognized credit | `_tax` | text | Col 11 |
| Tax due | `_owetax` | text | Col 12 |

### Fill Script Behavior

- Rows created via `addDynamicElement('A8D5')` (NRA's global JS function)
- **Field order matters**: set `incomecode` and `methodcode` BEFORE numeric fields (NRA JS resets numbers when codes are empty)
- 300ms delay between fields, 500ms after code/method, 800ms between rows
- Column 7 (`_value`) only filled for code 8142, skipped for 8141
- Column 8 (`_diff`) auto-calculated by NRA form, never set manually

### Updating When NRA Form Changes

1. Open the form in DevTools, inspect field IDs
2. Update `generateFillScript()` in `packages/ui/src/hooks/useNraFiller.ts`
3. Update the same logic in `scripts/nra-fill-form.mjs` (keep in sync)
4. Update `NraFormRow` interface in `packages/core/src/nra/form-data.ts` if columns change
5. Test clipboard approach first (easier to debug), then browser automation

## Adding a New Broker Provider

### Step 1: Create provider module
Create `packages/core/src/providers/{name}.ts` implementing `BrokerProvider`:

```typescript
import type { BrokerProvider, BrokerProviderResult } from './types.js';
import type { Trade } from '../types/index.js';

export const yourProvider: BrokerProvider = {
    name: 'YourBroker',
    fileHandlers: [{
        id: 'your-broker-trades',
        detectFile(content: string, filename: string): boolean {
            try {
                // Match on 3+ columns or unique header signature
                return content.startsWith('YourBroker Export');
            } catch {
                return false; // NEVER throw from detectFile
            }
        },
        parseFile(content: string): BrokerProviderResult {
            const trades: Trade[] = [];
            // Parse CSV rows into Trade objects...
            return { trades };
        },
    }],
    exportInstructions: [{
        label: 'provider.yourbroker.instructions.label',
        steps: [
            'provider.yourbroker.instructions.step1',
            'provider.yourbroker.instructions.step2',
        ],
    }],
};
```

Examples of implemented providers: Interactive Brokers, Revolut, E*TRADE, Bondora.

### Step 2: Handle dividends and tax (if applicable)
If your provider parses dividends, you MUST:
```typescript
import { resolveCountry } from '../country-map.js';
import { calcDividendTax } from '../tax/rules.js';

// In parseFile():
for (const d of dividends) {
    d.country = resolveCountry(d.symbol);
    const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);
    d.bgTaxDue = bgTaxDue;
    d.whtCredit = whtCredit;
}
```

### Step 3: Register and export
- Add to `packages/core/src/providers/registry.ts`:
  ```typescript
  import { yourProvider } from './your-provider.js';
  export const providers = [ibProvider, revolutProvider, etradeProvider, yourProvider];
  ```
- Export from `packages/core/src/index.ts`

### Step 4: Add sample files
- `samples/{handler-id}.csv` — synthetic data covering all data types
- Include buys, sells, dividends, interest as applicable

### Step 5: Add i18n keys
Add export instructions in `packages/core/src/i18n/bg.ts` and `en.ts`:
```typescript
'provider.yourbroker.instructions.label': 'YourBroker',
'provider.yourbroker.instructions.step1': 'Go to Settings → Reports',
'provider.yourbroker.instructions.step2': 'Download CSV statement',
```

### Step 6: Write tests
- Parser tests in `packages/core/tests/parsers/{name}.test.ts` (see template above)
- Integration round-trip test case in `tests/integration/round-trip.test.ts`

### Step 7: Verify
- Excel round-trip: parse → export → import → export → import = identical
- Run full test suite: `pnpm --filter @bg-tax/core test`
- Verify 70% coverage maintained

### Step 8: UI integration (if not using provider registry auto-detection)
The Import page (`packages/ui/src/pages/Import.tsx`) auto-detects files using the provider registry. If your `detectFile()` works correctly, **no UI changes needed** — the file will be matched and parsed automatically.

If you need custom UI (e.g., currency selection before parsing), update Import.tsx:
- Detection happens via the provider registry loop (no hardcoded if/else needed)
- Country resolution uses async `resolveCountries()` with OpenFIGI fallback
- FIFO engine processes trades against existing holdings

### Example: Provider with multiple data types (trades + dividends + interest)

A complete provider returning multiple data types. Note how dividends require tax calculation and country resolution:

```typescript
// packages/core/src/providers/trading212.ts
import { resolveCountry } from '../country-map.js';
import { calcDividendTax } from '../tax/rules.js';
import type { BrokerProvider, BrokerProviderResult } from './types.js';
import type { Dividend, InterestEntry, Trade } from '../types/index.js';

export const trading212Provider: BrokerProvider = {
    name: 'Trading 212',
    fileHandlers: [{
        id: 'trading212-statement',
        detectFile(content: string): boolean {
            try {
                return content.includes('Action,Time,ISIN,Ticker');
            } catch { return false; }
        },
        parseFile(content: string): BrokerProviderResult {
            const lines = content.split('\n').filter(l => l.trim());
            const trades: Trade[] = [];
            const dividends: Dividend[] = [];
            const interest: InterestEntry[] = [];

            for (let i = 1; i < lines.length; i++) {
                const fields = lines[i].split(',');
                if (fields.length < 8) continue;
                const action = fields[0];
                const symbol = fields[3]?.trim();
                if (!symbol) continue;

                if (action === 'Market buy' || action === 'Market sell') {
                    trades.push({
                        symbol,
                        dateTime: fields[1], // Already YYYY-MM-DD HH:MM:SS
                        quantity: action.includes('sell')
                            ? -parseFloat(fields[5]) : parseFloat(fields[5]),
                        price: parseFloat(fields[6]),
                        proceeds: action.includes('sell')
                            ? parseFloat(fields[7]) : 0,
                        commission: 0,
                        currency: fields[4],
                    });
                } else if (action === 'Dividend') {
                    const gross = parseFloat(fields[7]);
                    const wht = Math.abs(parseFloat(fields[8] ?? '0'));
                    const { bgTaxDue, whtCredit } = calcDividendTax(gross, wht);
                    dividends.push({
                        symbol,
                        country: resolveCountry(symbol), // Sync fallback
                        date: fields[1].split(' ')[0],
                        currency: fields[4],
                        grossAmount: gross,
                        withholdingTax: wht,
                        bgTaxDue, whtCredit,
                    });
                } else if (action === 'Interest') {
                    interest.push({
                        currency: fields[4],
                        date: fields[1].split(' ')[0],
                        description: 'Interest',
                        amount: parseFloat(fields[7]),
                    });
                }
            }
            return { trades, dividends, interest };
        },
    }],
    exportInstructions: [{
        label: 'provider.trading212.instructions.label',
        steps: ['provider.trading212.instructions.step1',
                'provider.trading212.instructions.step2'],
    }],
};
```

Key points:
- `dividends` call `resolveCountry()` and `calcDividendTax()` — **mandatory**
- `interest` entries include `currency` on each entry (not just the container)
- `trades` use negative quantity for sells
- Country resolution is sync here (fast path). The UI calls async `resolveCountries()` after import to fill gaps via OpenFIGI API.

## SPB-8 Architecture

BNB Form SPB-8 reports foreign financial assets. Core modules in `packages/core/src/spb8/`:

- **`assemble.ts`** — Pure function: groups holdings by ISIN, computes threshold (50,000 BGN)
- **`excel-generator.ts`** — Generates .xlsx matching BNB template (22 columns, merged cells, Times New Roman)
- **`import.ts`** — Reads previous SPB-8 .xlsx to extract start-of-year data
- **`price-service.ts`** — Fetches year-end market prices: Stooq (primary) + Yahoo Finance (fallback). Derives exchange suffix from ISIN country prefix (no hardcoded ticker maps). Detects rate limiting from both providers.
- **`bnb-template-filler.ts`** — Binary BIFF8 record patcher for the official BNB SPB-8 template (.xls). Preserves formatting (green headers, borders, column widths, hidden column A) by patching cell records in-place. Modifies SST (string table), <!-- cspell:disable-line -->LABELSST, BOUNDSHEET records; uses CFB library to read/write OLE compound file.

UI modules:
- **`pages/Spb8.tsx`** — Full SPB-8 page: threshold banner, personal data form, accounts/securities tables, price fetch, export
- **`crypto.ts`** — AES-GCM obfuscation for personal data (EGN, name) in localStorage. Uses hardcoded passphrase + PBKDF2 — prevents plaintext storage, not a defense against determined attacker with source access.

## SPB-8 Support for Providers

When adding a new provider, consider whether it can supply data for BNB Form SPB-8:

### Foreign Account Balances (Section 03)
If the broker provides cash balance data, return `foreignAccounts` in `BrokerProviderResult`:
- `type`: Always `'03'` for bank/brokerage accounts
- `maturity`: `'L'` for indefinite (brokerage), `'S'` for short-term (savings/current)
- `country`: ISO 3166-1 alpha-2 of the **broker entity** (not the exchange)
- `currency`: ISO 4217 code
- `amountStartOfYear` / `amountEndOfYear`: In original currency (NOT thousands)

### ISIN Mapping
If the broker's data includes ISIN codes, return `isinMap` in `BrokerProviderResult`:
- Key: ticker symbol (matching the symbols used in trades/holdings)
- Value: 12-character ISIN code

### Manual Foreign Bank Accounts (Import Page)
The Import page includes a "Foreign Bank Accounts" section where users can manually enter bank account balances (e.g. Revolut, Wise current accounts). These are stored as `ForeignAccountBalance` with `type: '03'` and appear in SPB-8 Section 03. Default country for Revolut is Lithuania (LT). Existing accounts can be edited or deleted. The broker dropdown auto-populates from imported files, and selecting a new currency triggers FX rate fetching from ECB. SPB-8 Section 03 amounts are displayed in thousands with 2 decimal places, Section 04 quantities use 2 decimal places. Country resolution uses ISIN domicile prefix (e.g. IE → Ireland) before exchange fallback.

### Revolut Savings Pattern
Revolut "savings" are money market fund shares (ISINs: IE0002RUHW32 GBP, IE000H9J0QX4 USD, IE000AZVL3K0 EUR). These are Section 04 securities, NOT Section 03 accounts. The savings balance prompt on the Import page includes an editable ISIN field (auto-populated from CSV) and stores positions as `savingsSecurities` in AppState. The `assembleSecurities()` function merges these with stock holdings for SPB-8 output.

## Error Handling Standard

### In `detectFile()`
- **NEVER throw.** Wrap in try-catch, return `false` on any error.
- Keep it cheap — check header/magic bytes only, don't parse the entire file.

### In `parseFile()`
- **Skip malformed rows** with a warning, don't fail the entire import.
- If a row has too few columns, skip it silently.
- If a price or quantity is NaN, skip the row.
- **Throw** only for unrecoverable errors (empty file, wrong format entirely).

### Pattern for defensive parsing
```typescript
for (let i = 1; i < lines.length; i++) {
    try {
        const fields = lines[i].split(',');
        if (fields.length < 5) continue; // Skip incomplete rows
        const quantity = parseFloat(fields[2]);
        if (isNaN(quantity)) continue; // Skip invalid numbers
        trades.push({ /* ... */ });
    } catch {
        // Skip row, continue parsing
    }
}
```

### Negative `detectFile()` test examples
Always test that `detectFile()` returns `false` safely for unexpected inputs:
```typescript
it('returns false for empty content', () => {
    expect(handler.detectFile('', 'empty.csv')).toBe(false);
});
it('returns false for binary content', () => {
    expect(handler.detectFile('\xFF\xD8\xFF\xE0JFIF', 'image.jpg')).toBe(false);
});
it('returns false for generic CSV', () => {
    expect(handler.detectFile('Name,Age\nAlice,30', 'data.csv')).toBe(false);
});
it('returns false for malformed CSV (no crash)', () => {
    expect(() => handler.detectFile('"unclosed quote', 'bad.csv')).not.toThrow();
});
```

### Security considerations
- **Input sanitization:** Symbols parsed from CSV are used in API calls (OpenFIGI) and Excel sheet names. Validate that symbols contain only alphanumeric characters, spaces, dots, and dashes. Reject anything with special characters (`<>"/\|?*`).
- **File size limits:** The UI should warn users about files > 10MB. Large CSVs can freeze the browser tab.
- **No code execution:** Never use `eval()`, `Function()`, or `new Function()` on CSV content. Parse as data only.
- **API rate limiting:** OpenFIGI allows <20 requests/minute without an API key. The `resolveCountries()` function batches symbols (max 100 per request) and has a 5-second timeout. Don't bypass these limits.

## Edge Cases and Common Pitfalls

### CSV Parsing
- **BOM handling:** Some Excel CSV exports include UTF-8 BOM. Use `content.replace(/^\uFEFF/, '')` before parsing.
- **Quoted fields:** Commas inside quoted fields (e.g., `"1,000"`) must be handled. Use a proper CSV row parser.
- **Date normalization:** All dates must be ISO `YYYY-MM-DD`. If your CSV uses `DD/MM/YYYY` or `MM-DD-YYYY`, convert in `parseFile()`.
- **DateTime for trades:** FIFO sorts by datetime, not just date. Format: `YYYY-MM-DD, HH:MM:SS`.

### Dividends and Withholding Tax
- **Separate WHT lines:** If your provider lists dividends and WHT as separate rows, use `matchWhtToDividends()` from `parsers/wht-matcher.ts` to combine them.
- **Dividend reversals:** Some brokers show dividend + reversal on same date. The parser should combine by symbol+date+currency (sum amounts). See `combineDividends()` in `ib-csv.ts`.
- **Always call `calcDividendTax()`** after resolving WHT — this computes the Bulgarian 5% tax and WHT credit.

### Symbols and Currency
- **Symbol aliases:** Some brokers use different tickers for the same instrument (e.g., CSPX vs SXR8). If your CSV has a symbol mapping section, build a `symbolAliases` map and normalize before processing.
- **Fractional shares:** Store to 8 decimal places. Never round. Excel uses `numFmt: '0.00000000'`.
- **Currency codes:** Must be 3-letter ISO codes (USD, EUR, GBP). Validate before storing.
- **All amounts in original currency.** FX conversion happens in the Excel generator and FIFO engine, not in the parser.

### Country Resolution
- **Sync fallback:** `resolveCountry(symbol)` checks hardcoded map only (fast, for tests)
- **Async with API:** `resolveCountries([{symbol, currency}])` calls OpenFIGI for unknowns
- Import.tsx uses the async version to batch-resolve all symbols after parsing

## Key Domain Rules

- **IB CSV has TWO Withholding Tax sections** — parser must not stop at first Total line
- **Dividends combine by symbol+date+currency** before WHT matching
- **FIFO sorts trades by datetime** (not just date) before processing
- **Excel formulas**: ArrayFormula ONLY for SWITCH. Plain formula for VLOOKUP.
- **Excel export is always in Bulgarian** — UI language setting does not affect export
- **Base currency**: BGN for tax year ≤2025, EUR for ≥2026. EUR/BGN fixed at 1.95583
- **ECB rates are EUR-native**: 1 EUR = X currency
- **Country resolution**: OpenFIGI API resolves exchange code → country. Note: for ETFs, exchange code gives listing location, not domicile. Add overrides to `COUNTRY_MAP` when needed.

## When Adding Features

1. Write failing test first
2. Implement minimally to pass
3. Refactor if needed
4. Run full test suite before committing

## When Fixing Bugs

1. Write a test that reproduces the bug
2. Verify test fails
3. Fix the code
4. Verify test passes
5. Run full test suite

## Ready Checklist

Run these before every push:

1. **Check if tests need updating or adding.** If you changed behavior, added a feature, or fixed a bug — ensure corresponding tests exist and cover the changes. Add new tests where missing.
2. **Run the code simplifier** on recently modified code. Review for reuse opportunities, unnecessary complexity, and code quality issues. Use the `/simplify` skill.
3. **Verify code practices are followed.** Check that changed code follows the conventions in this file (naming, error handling, patterns, test style, etc.).
4. **Check if README.md and AGENTS.md need updating.** If you added features, changed commands, modified architecture, or altered workflows — update the relevant documentation.
5. Run the verification commands:

```bash
pnpm --filter @bg-tax/core test   # All tests pass
pnpm --filter @bg-tax/ui test     # All UI tests pass
pnpm typecheck                     # TypeScript typecheck passes
pnpm format                        # Format code with dprint
pnpm format:check                  # Verify no unformatted files remain
pnpm lint:fix                      # Auto-fix lint issues
pnpm lint                          # Verify zero lint errors in source
pnpm spell                         # Spellcheck with cspell
```

**Fix all errors, not just new ones.** If the linter or formatter reports preexisting issues in files you didn't touch, fix them too. The goal is a clean `pnpm lint` and `pnpm format:check` with zero errors before every push.

If cspell flags a legitimate word, add it to `cspell-dict.txt`. Keep entries **lowercase and alphabetically sorted** using byte order (`LC_ALL=C sort -u cspell-dict.txt`). This puts Latin words first, then Cyrillic. Bulgarian words are handled by `@cspell/dict-bg-bg` (configured in `cspell.json`) — only add Bulgarian words to the project dict if they are missing from the standard dictionary.

## Public Status

This repo is public. Keep in mind:
- **No secrets/credentials** in code or config files
- **No personal data** (account numbers, real tax amounts) in test fixtures
- **No hardcoded paths** like `/Users/trifonov/` — use relative paths
- **License-compatible dependencies** only (MIT/Apache preferred)
- **GitHub Pages deployment** is pre-configured (`.github/workflows/deploy-pages.yml`)
- The app should work as both a Tauri desktop app AND a browser SPA on GitHub Pages

## Commit Messages

Format: `type: description`

Types: `feat`, `fix`, `test`, `chore`, `docs`, `refactor`

Examples:
- `feat: add GBP support to Revolut parser`
- `fix: handle ASML dividend reversal in WHT matcher`
- `test: add edge cases for FIFO partial lot splits`
