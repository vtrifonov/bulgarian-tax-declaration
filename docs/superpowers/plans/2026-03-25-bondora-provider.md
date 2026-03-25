# Bondora Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bondora provider that parses Account Statement CSVs to extract interest income and account balances for Bulgarian tax declaration and SPB-8 reporting.

**Architecture:** CSV parser handles two format variants (old/new column names). Interest transactions become `BrokerInterest` entries; running balance becomes `ForeignAccountBalance`. Provider registered in registry; Import.tsx gets detection + processing branch. Full Excel round-trip supported via existing sheet infrastructure.

**Tech Stack:** TypeScript, Vitest, ExcelJS

**Spec:** `docs/superpowers/specs/2026-03-25-bondora-provider-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/parsers/bondora-csv.ts` | CSV parser (both format variants) |
| Create | `packages/core/src/providers/bondora.ts` | BrokerProvider definition |
| Create | `packages/core/tests/fixtures/bondora-statement.csv` | Test fixture (Variant A — old format) |
| Create | `packages/core/tests/fixtures/bondora-statement-new.csv` | Test fixture (Variant B — new format) |
| Create | `packages/core/tests/parsers/bondora-csv.test.ts` | Parser unit tests (15 cases) |
| Create | `samples/bondora-account-statement.csv` | Sample file for integration tests |
| Modify | `packages/core/src/providers/registry.ts` | Add bondoraProvider to providers array |
| Modify | `packages/core/src/index.ts` | Export parseBondoraCsv |
| Modify | `packages/core/src/i18n/en.ts` | English export instructions + supported format string |
| Modify | `packages/core/src/i18n/bg.ts` | Bulgarian export instructions + supported format string |
| Modify | `packages/ui/src/store/app-state.ts` | Add `'bondora'` to ImportedFile type union |
| Modify | `packages/ui/src/pages/Import.tsx` | Add detection, processing branch, priority, broker mapping |
| Modify | `packages/core/tests/integration/round-trip.test.ts` | Add Bondora round-trip test (Test 34) |

---

### Task 1: Create test fixtures

**Files:**
- Create: `packages/core/tests/fixtures/bondora-statement.csv`
- Create: `packages/core/tests/fixtures/bondora-statement-new.csv`
- Create: `samples/bondora-account-statement.csv`

- [ ] **Step 1: Create Variant A fixture (old format)**

```csv
TransferDate,Description,Amount,Currency,LoanNumber,Counterparty,BalanceAfterPayment
01.01.2025 00:00,TransferDeposit,1000.00,EUR,,Bondora,1000.00
15.01.2025 09:15,TransferInterestRepaiment,0.52,EUR,12345,John Doe,1000.52
20.01.2025 11:30,TransferExtraInterestRepaiment,0.10,EUR,12345,John Doe,1000.62
01.02.2025 08:00,TransferGoGrowInterest,1.25,EUR,,Bondora,1001.87
15.02.2025 10:00,TransferPrincipalRepaiment,50.00,EUR,12345,John Doe,1051.87
01.03.2025 12:00,TransferInvestment,-200.00,EUR,67890,,851.87
15.03.2025 14:30,TransferDeposit,500.00,EUR,,Bondora,1351.87
01.06.2025 09:00,TransferGoGrowInterest,2.33,EUR,,Bondora,1354.20
15.06.2025 16:00,Withdraw,-300.00,EUR,,Bondora,1054.20
01.09.2025 09:00,TransferInterestRepaiment,0.75,EUR,23456,Jane Smith,1054.95
15.09.2025 11:00,FX commission,-0.50,EUR,,Bondora,1054.45
01.12.2025 09:00,TransferGoGrowInterest,1.80,EUR,,Bondora,1056.25
31.12.2025 23:59,TransferInterestRepaiment,-0.15,EUR,99999,Reversal,1056.10
```

Save to `packages/core/tests/fixtures/bondora-statement.csv`.

- [ ] **Step 2: Create Variant B fixture (new format)**

```csv
Date,Details,Turnover,Transaction ID
2025-01-01 00:00:00,TransferDeposit,1000.00,tx-001
2025-01-15 09:15:00,TransferInterestRepaiment,0.52,tx-002
2025-01-20 11:30:00,TransferExtraInterestRepaiment,0.10,tx-003
2025-02-01 08:00:00,TransferGoGrowInterest,1.25,tx-004
2025-02-15 10:00:00,TransferPrincipalRepaiment,50.00,tx-005
2025-03-01 12:00:00,TransferInvestment,-200.00,tx-006
2025-03-15 14:30:00,TransferDeposit,500.00,tx-007
2025-06-01 09:00:00,TransferGoGrowInterest,2.33,tx-008
2025-06-15 16:00:00,Withdraw,-300.00,tx-009
2025-09-01 09:00:00,TransferInterestRepaiment,0.75,tx-010
2025-09-15 11:00:00,FX commission,-0.50,tx-011
2025-12-01 09:00:00,TransferGoGrowInterest,1.80,tx-012
2025-12-31 23:59:00,TransferInterestRepaiment,-0.15,tx-013
```

Save to `packages/core/tests/fixtures/bondora-statement-new.csv`.

- [ ] **Step 3: Create sample file for integration tests**

Copy the Variant A fixture to `samples/bondora-account-statement.csv`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/fixtures/bondora-statement.csv packages/core/tests/fixtures/bondora-statement-new.csv samples/bondora-account-statement.csv
git commit -m "test: add Bondora CSV test fixtures and sample file"
```

---

### Task 2: Write parser unit tests (TDD — tests first)

**Files:**
- Create: `packages/core/tests/parsers/bondora-csv.test.ts`

- [ ] **Step 1: Write all test cases**

The tests import `parseBondoraCsv` and `detectBondoraCsv` from `../../src/parsers/bondora-csv.js`. Load fixtures with `readFileSync`. Test cases per spec section 8:

1. Parses Variant A — correct interest entries extracted (7 interest transactions)
2. Parses Variant B — same interest entries extracted
3. Interest amounts sum correctly (0.52 + 0.10 + 1.25 + 2.33 + 0.75 + 1.80 + (-0.15) = 6.60)
4. Non-interest transactions excluded (deposits, withdrawals, principal, investment, fees)
5. Foreign account balance from BalanceAfterPayment (Variant A): start = 0, end = 1056.10
6. Balance from running sum (Variant B): start = 0, end ≈ 1056.10
7. Date parsing — Variant A dates are DD.MM.YYYY → YYYY-MM-DD
8. Date parsing — Variant B dates are YYYY-MM-DD HH:MM:SS → YYYY-MM-DD
9. Empty CSV → throws error
10. File detection — returns true for both variants
11. File detection — returns false for IB/Revolut/generic CSVs
12. BOM prefix — CSV with `\uFEFF` prefix parses correctly
13. Negative interest amount — reversal entry included with negative amount (-0.15)
14. Zero interest entries — deposits-only CSV returns empty entries
15. Malformed date — row with invalid date is skipped

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @bg-tax/core test -- --run tests/parsers/bondora-csv.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/parsers/bondora-csv.test.ts
git commit -m "test: add Bondora CSV parser unit tests (red)"
```

---

### Task 3: Implement CSV parser

**Files:**
- Create: `packages/core/src/parsers/bondora-csv.ts`

Key implementation details:
- Strip BOM: `content.replace(/^\uFEFF/, '')`
- Detect variant by checking header for `TransferDate` (A) or `Date`+`Details`+`Turnover`+`Transaction ID` (B)
- Map column indices for unified access
- Interest regex: `/^Transfer(?:Interest|ExtraInterest)Repaiment|^TransferGoGrowInterest/`
- Date A: `DD.MM.YYYY HH:MM` → `YYYY-MM-DD`
- Date B: `YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DD`
- Balance A: `firstRow.BalanceAfterPayment - firstRow.Amount` (start), `lastRow.BalanceAfterPayment` (end)
- Balance B: running sum of Turnover, start = 0
- Skip rows with invalid dates or NaN amounts
- Return `{ interest: BrokerInterest, foreignAccount: ForeignAccountBalance, warnings: string[] }`

- [ ] **Step 1: Create the parser module**

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @bg-tax/core test -- --run tests/parsers/bondora-csv.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/parsers/bondora-csv.ts
git commit -m "feat: add Bondora CSV parser (both format variants)"
```

---

### Task 4: Create provider and register it

**Files:**
- Create: `packages/core/src/providers/bondora.ts`
- Modify: `packages/core/src/providers/registry.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the provider module**

The provider has one `TextFileHandler` with id `'bondora-account-statement'`. `detectFile` delegates to `detectBondoraCsv`. `parseFile` calls `parseBondoraCsv` and maps to `BrokerProviderResult`:
- `savingsInterest` → parsed interest
- `foreignAccounts` → `[parsed.foreignAccount]`

Export instructions use 4 i18n keys (see Task 5).

- [ ] **Step 2: Register in registry.ts**

Add import and append `bondoraProvider` to the `providers` array.

- [ ] **Step 3: Export from index.ts**

Add after the `parseEtradePdf` export line:
```typescript
export { detectBondoraCsv, parseBondoraCsv } from './parsers/bondora-csv.js';
export type { BondoraParseResult } from './parsers/bondora-csv.js';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bg-tax/core test -- --run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/bondora.ts packages/core/src/providers/registry.ts packages/core/src/index.ts
git commit -m "feat: register Bondora provider in provider registry"
```

---

### Task 5: Add i18n keys

**Files:**
- Modify: `packages/core/src/i18n/en.ts`
- Modify: `packages/core/src/i18n/bg.ts`

- [ ] **Step 1: Add English keys**

Add 4 export instruction keys after E*TRADE keys. Update `import.supported` to include `Bondora CSV`.

- [ ] **Step 2: Add Bulgarian keys**

Same 4 keys in Bulgarian. Update `import.supported` to include `Bondora CSV`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/i18n/en.ts packages/core/src/i18n/bg.ts
git commit -m "feat: add Bondora i18n keys for export instructions"
```

---

### Task 6: UI integration — Import.tsx and app-state.ts

**Files:**
- Modify: `packages/ui/src/store/app-state.ts`
- Modify: `packages/ui/src/pages/Import.tsx`

- [ ] **Step 1: Add `'bondora'` to ImportedFile type union**

- [ ] **Step 2: Add Bondora detection in `detectFileType()`**

Add AFTER Revolut checks and BEFORE `return null`. Check header for Variant A (`TransferDate` + `Description` + `Amount`) or Variant B (`Date` + `Details` + `Turnover` + `Transaction ID`).

- [ ] **Step 3: Add import priority**

Add `case 'bondora': return 55;` in `importPriority()`.

- [ ] **Step 4: Add processing branch**

Add `else if (fileType === 'bondora')` block before the final `else` (Revolut savings). Pattern:
1. Dynamic import `parseBondoraCsv` from `@bg-tax/core`
2. Dedup check: skip if `broker === 'Bondora' && currency === 'EUR'` already exists
3. Set `source` on each entry: `{ type: 'Bondora', file: file.name }`
4. Call `importBrokerInterest([...existing, interest])`
5. Replace existing Bondora EUR foreign account: `setForeignAccounts([...filtered, foreignAccount])`
6. Record imported file with summary message

- [ ] **Step 5: Add broker mapping in `importedBrokers` memo**

Add `if (f.type === 'bondora') brokers.add('Bondora');`

- [ ] **Step 6: Update unrecognized file error message**

Include Bondora in the error message string.

- [ ] **Step 7: Run typecheck and UI tests**

```bash
pnpm typecheck
pnpm --filter @bg-tax/ui test -- --run
```

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/store/app-state.ts packages/ui/src/pages/Import.tsx
git commit -m "feat: add Bondora detection and processing in Import page"
```

---

### Task 7: Integration round-trip test

**Files:**
- Modify: `packages/core/tests/integration/round-trip.test.ts`

- [ ] **Step 1: Add Test 34 — Bondora interest + foreign account round-trip**

1. Parse `samples/bondora-account-statement.csv` with `parseBondoraCsv`
2. Build `AppState` with `brokerInterest: [parsed.interest]` and `foreignAccounts: [parsed.foreignAccount]`
3. `generateExcel(state)` → `importFullExcel(buffer)` → verify counts, broker, currency, amounts
4. Second round-trip: re-export → re-import → verify identical

- [ ] **Step 2: Run integration test**

Run: `pnpm --filter @bg-tax/core test -- --run tests/integration/round-trip.test.ts`
Expected: Test 34 passes

- [ ] **Step 3: Run full test suite**

Run: `pnpm --filter @bg-tax/core test -- --run`

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/integration/round-trip.test.ts
git commit -m "test: add Bondora interest + foreign account round-trip test"
```

---

### Task 8: Update Import.test.tsx mock

**Files:**
- Modify: `packages/ui/src/pages/Import.test.tsx`

- [ ] **Step 1: Add `parseBondoraCsv` and `detectBondoraCsv` to the `@bg-tax/core` mock**

- [ ] **Step 2: Run UI tests**

Run: `pnpm --filter @bg-tax/ui test -- --run`

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/pages/Import.test.tsx
git commit -m "test: add Bondora parser mock to Import.test.tsx"
```

---

### Task 9: Update documentation and cspell

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `cspell-dict.txt` (if needed)

- [ ] **Step 1: Update AGENTS.md**

Add Bondora to provider examples and import order.

- [ ] **Step 2: Update README.md**

Add Bondora to supported data sources.

- [ ] **Step 3: Run spellcheck and add words if needed**

Run: `pnpm spell`. If "bondora" or "repaiment" are flagged, add to `cspell-dict.txt` (lowercase, alphabetically sorted).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md cspell-dict.txt
git commit -m "docs: add Bondora to supported providers documentation"
```

---

### Task 10: Ready Checklist

- [ ] **Step 1: Full test suite**

```bash
pnpm --filter @bg-tax/core test
pnpm --filter @bg-tax/ui test
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Format and lint**

```bash
pnpm format
pnpm format:check
pnpm lint:fix
pnpm lint
```

- [ ] **Step 4: Spellcheck**

```bash
pnpm spell
```

- [ ] **Step 5: Fix any issues and commit**
