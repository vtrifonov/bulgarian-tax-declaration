# Bondora Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bondora provider that parses Account Statement CSV exports to extract interest income and account balances for Bulgarian tax declaration (NRA) and SPB-8 (BNB) reporting.

**Architecture:** The provider follows the existing BrokerProvider pattern with a single TextFileHandler. The CSV parser detects two format variants (old/new column names) and extracts interest entries + foreign account balance. No new dependencies required — reuses the existing `parseCSVRow` utility from `revolut-csv.ts`.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-bondora-provider-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/core/src/parsers/bondora-csv.ts` | CSV parser for both format variants |
| Create | `packages/core/src/providers/bondora.ts` | BrokerProvider definition with file handler |
| Modify | `packages/core/src/providers/registry.ts` | Register Bondora provider |
| Modify | `packages/core/src/i18n/en.ts` | English export instructions |
| Modify | `packages/core/src/i18n/bg.ts` | Bulgarian export instructions |
| Modify | `packages/core/src/index.ts` | Export new parser |
| Create | `packages/core/tests/parsers/bondora-csv.test.ts` | Parser unit tests |
| Create | `packages/core/tests/fixtures/bondora-statement.csv` | Test fixture (Variant A — old format) |
| Create | `packages/core/tests/fixtures/bondora-statement-new.csv` | Test fixture (Variant B — new format) |
| Modify | `packages/ui/src/pages/Import.tsx` | Add Bondora file detection, processing branch, and import priority |
| Modify | `packages/ui/src/store/app-state.ts` | Add `'bondora'` to `ImportedFile['type']` union |
| Create | `samples/bondora-account-statement.csv` | Synthetic sample for integration tests |
| Modify | `packages/core/tests/integration/round-trip.test.ts` | Add Bondora round-trip test case |
| Modify | `cspell-dict.txt` | Add `Bondora`, `Repaiment` |

---

### Task 1: Create CSV Parser

**Files:**
- Create: `packages/core/src/parsers/bondora-csv.ts`

- [ ] **Step 1: Create `bondora-csv.ts` with format detection**

Import `parseCSVRow` from `revolut-csv.ts`. Define the exported interface and main parse function:

```typescript
import { parseCSVRow } from './revolut-csv.js';
import type { BrokerInterest, InterestEntry, ForeignAccountBalance } from '../types/index.js';

export interface BondoraParseResult {
    interest: BrokerInterest;
    foreignAccount: ForeignAccountBalance;
    warnings: string[];
}

export function parseBondoraCsv(content: string): BondoraParseResult;
```

Implementation:
1. Strip UTF-8 BOM if present: `content = content.replace(/^\uFEFF/, '')`
2. Split content into lines, filter empty
3. Parse header row → detect variant by checking for `TransferDate` (variant A) vs `Date` + `Details` + `Turnover` (variant B)
4. Build column index map for: date, description, amount, balance (optional)
5. Define interest regex: `/^Transfer(Extra)?InterestRepaiment|^TransferGoGrowInterest/` (note: "Repaiment" is Bondora's actual typo — add a code comment explaining this)
6. Iterate data rows:
   - Parse date to ISO `YYYY-MM-DD`
   - Classify description: if matches interest regex → create `InterestEntry`
   - Skip rows with malformed/unparseable dates (don't throw — AGENTS.md error handling rule)
   - Track balance: use `BalanceAfterPayment` column if present, otherwise compute running sum of amount values
7. Compute `amountStartOfYear` and `amountEndOfYear` from balance tracking
8. Emit warning if no balance column found and start-of-year balance defaults to 0
9. Emit warning if zero interest entries found: "No interest income found in this statement"
10. Return `{ interest, foreignAccount, warnings }`

- [ ] **Step 2: Implement date parsing for both variants**

```typescript
/** Variant A: "15.03.2025 14:30" → "2025-03-15" */
/** Variant B: "2025-03-15 14:30:00" → "2025-03-15" */
function parseBondoraDate(raw: string, variant: 'A' | 'B'): string;
```

Variant A: split on `.` and space, rearrange day/month/year.
Variant B: take first 10 characters (already ISO format).

---

### Task 2: Create Provider and Register

**Files:**
- Create: `packages/core/src/providers/bondora.ts`
- Modify: `packages/core/src/providers/registry.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `bondora.ts` provider**

Follow the Revolut provider pattern (`revolut.ts`). Single file handler:

```typescript
import type { BrokerProvider, BrokerProviderResult } from './types.js';
import { parseBondoraCsv } from '../parsers/bondora-csv.js';

export const bondoraProvider: BrokerProvider = {
    name: 'Bondora',
    fileHandlers: [{
        id: 'bondora-account-statement',
        kind: 'text' as const,
        detectFile(content: string, _filename: string): boolean {
            try {
                const firstLine = content.split('\n')[0] ?? '';
                // Variant A
                if (firstLine.includes('TransferDate') && firstLine.includes('Description') && firstLine.includes('Amount')) {
                    return true;
                }
                // Variant B — strict: require all four columns to avoid false positives with generic CSVs
                if (firstLine.includes('Date') && firstLine.includes('Details')
                    && firstLine.includes('Turnover') && firstLine.includes('Transaction ID')) {
                    return true;
                }
                return false;
            } catch {
                return false;
            }
        },
        parseFile(content: string): BrokerProviderResult {
            const result = parseBondoraCsv(content);
            return {
                savingsInterest: result.interest,
                foreignAccounts: [result.foreignAccount],
                warnings: result.warnings,
            };
        },
    }],
    exportInstructions: [{
        label: 'provider.bondora.instructions.account.label',
        steps: [
            'provider.bondora.instructions.account.step1',
            'provider.bondora.instructions.account.step2',
            'provider.bondora.instructions.account.step3',
            'provider.bondora.instructions.account.step4',
        ],
    }],
};
```

- [ ] **Step 2: Register in `registry.ts`**

Add `bondoraProvider` import and append to the `providers` array.

- [ ] **Step 3: Export from `index.ts`**

Add `export { parseBondoraCsv } from './parsers/bondora-csv.js';` to the package index.

---

### Task 3: Add i18n Strings

**Files:**
- Modify: `packages/core/src/i18n/en.ts`
- Modify: `packages/core/src/i18n/bg.ts`

- [ ] **Step 1: Add English strings**

Add after the E*TRADE instructions block:

```typescript
'provider.bondora.instructions.account.label': 'Bondora Account Statement',
'provider.bondora.instructions.account.step1': 'Log in to your Bondora account',
'provider.bondora.instructions.account.step2': 'Go to Statements → Account Statement',
'provider.bondora.instructions.account.step3': 'Set the period to the tax year (Jan 1 – Dec 31)',
'provider.bondora.instructions.account.step4': 'Click Create report and download the CSV file',
```

Also update the `import.supported` string to include Bondora:
```typescript
'import.supported': 'Supported: Interactive Brokers CSV, Revolut Savings CSV, Revolut Investments CSV, Revolut Account CSV, E*TRADE PDF, Bondora Account Statement CSV',
```

- [ ] **Step 2: Add Bulgarian strings**

```typescript
'provider.bondora.instructions.account.label': 'Bondora Извлечение',
'provider.bondora.instructions.account.step1': 'Влезте в Bondora акаунта си',
'provider.bondora.instructions.account.step2': 'Отидете на Statements → Account Statement',
'provider.bondora.instructions.account.step3': 'Задайте период: данъчната година (1 януари – 31 декември)',
'provider.bondora.instructions.account.step4': 'Натиснете Create report и изтеглете CSV файла',
```

Also update the `import.supported` string to include Bondora:
```typescript
'import.supported': 'Поддържани: Interactive Brokers CSV, Revolut Savings CSV, Revolut Investments CSV, Revolut Account CSV, E*TRADE PDF, Bondora Account Statement CSV',
```

- [ ] **Step 3: Add `Bondora` and `Repaiment` to `cspell-dict.txt`**

---

### Task 4: Create Test Fixtures and Sample File

**Files:**
- Create: `packages/core/tests/fixtures/bondora-statement.csv`
- Create: `packages/core/tests/fixtures/bondora-statement-new.csv`
- Create: `samples/bondora-account-statement.csv`

- [ ] **Step 1: Create Variant A fixture**

Old-format CSV with realistic data covering a full year. Include:
- 2+ deposit transactions
- 5+ interest transactions (`TransferInterestRepaiment`, `TransferExtraInterestRepaiment`)
- 1+ Go & Grow interest (`TransferGoGrowInterest`)
- 1+ negative interest amount (reversal)
- 2+ principal repayments
- 1 withdrawal
- 1 fee transaction
- `BalanceAfterPayment` column with running balance

Use dates spanning Jan–Dec of 2025. Realistic EUR amounts (interest 0.01–5.00, deposits 100–1000).

- [ ] **Step 2: Create Variant B fixture**

New-format CSV with same transaction mix but using `Date`, `Details`, `Turnover`, `Transaction ID` columns. No `BalanceAfterPayment` column.

- [ ] **Step 3: Create sample file**

Copy Variant A fixture to `samples/bondora-account-statement.csv` (per AGENTS.md requirement for integration tests).

---

### Task 5: Write Unit Tests

**Files:**
- Create: `packages/core/tests/parsers/bondora-csv.test.ts`

- [ ] **Step 1: Write parser tests**

Test cases (minimum):

1. **Variant A — interest extraction**: Parse old-format fixture, verify correct number of `InterestEntry` items with correct dates and amounts
2. **Variant B — interest extraction**: Same verification with new-format fixture
3. **Interest sum**: Total interest amount matches expected sum
4. **Non-interest excluded**: Deposits, withdrawals, principal repayments not in interest entries
5. **Foreign account balance (Variant A)**: `amountStartOfYear` and `amountEndOfYear` computed correctly from `BalanceAfterPayment`
6. **Foreign account balance (Variant B)**: Balance computed from running sum, warning emitted
7. **Foreign account metadata**: `broker='Bondora'`, `type='03'`, `maturity='S'`, `country='EE'`, `currency='EUR'`
8. **Date parsing — Variant A**: `DD.MM.YYYY HH:MM` → `YYYY-MM-DD`
9. **Date parsing — Variant B**: `YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DD`
10. **Empty CSV**: Throws descriptive error
11. **File detection**: Provider's `detectFile` returns `true` for both variants, `false` for IB/Revolut CSVs
12. **BOM handling**: CSV with `\uFEFF` prefix parses correctly
13. **Negative interest**: Reversal entry with negative amount is included in entries (reduces total)
14. **Zero interest entries**: CSV with only deposits/withdrawals returns empty entries array + warning
15. **Malformed date**: Row with unparseable date is skipped, not thrown

- [ ] **Step 2: Run tests and verify ≥ 70% coverage**

```bash
pnpm --filter @bg-tax/core test -- --coverage bondora
```

---

### Task 6: Import Page Integration

**Files:**
- Modify: `packages/ui/src/store/app-state.ts`
- Modify: `packages/ui/src/pages/Import.tsx`

**Context:** Import.tsx uses hardcoded `detectFileType()` and provider-specific processing branches for text/CSV files. The generic provider abstraction is only used for binary files (E*TRADE PDFs). Bondora needs explicit integration.

- [ ] **Step 1: Add `'bondora'` to `ImportedFile['type']` union**

In `app-state.ts`, find the `ImportedFile` type and add `'bondora'` to the `type` union.

- [ ] **Step 2: Add Bondora detection to `detectFileType()`**

In `Import.tsx`, add after the Revolut investments check and before `return null`. **Must come AFTER IB and Revolut checks** to avoid false positives. Also note: the existing `else { /* revolut savings */ }` block must be restructured to `else if (fileType === 'revolut')` to accommodate the new Bondora branch.

```typescript
// Bondora Account Statement (old or new format)
const firstLine = content.split('\n')[0] ?? '';
if (firstLine.includes('TransferDate') && firstLine.includes('Description') && firstLine.includes('Amount')) {
    return 'bondora';
}
// Variant B — require all 4 columns to avoid false positives with generic CSVs
if (firstLine.includes('Date') && firstLine.includes('Details')
    && firstLine.includes('Turnover') && firstLine.includes('Transaction ID')) {
    return 'bondora';
}
```

- [ ] **Step 3: Add `'bondora'` to `importPriority()`**

```typescript
case 'bondora':
    return 55;  // After E*TRADE (50)
```

- [ ] **Step 4: Add `'bondora'` to `importedBrokers` memo**

```typescript
if (f.type === 'bondora') brokers.add('Bondora');
```

- [ ] **Step 5: Add Bondora processing branch**

Add an `else if (fileType === 'bondora')` block in the file processing section. **Follow the exact Revolut savings pattern** (line ~860) for state management:

```typescript
} else if (fileType === 'bondora') {
    const result = parseBondoraCsv(content);

    // Set source on each interest entry (matching Revolut pattern at line ~877)
    const source = { type: 'Bondora', file: file.name };
    for (const e of result.interest.entries) {
        e.source = source;
    }

    // Dedup by broker+currency — show error on duplicate (matching Revolut pattern at line ~866)
    const existing = useAppStore.getState().brokerInterest;
    const isDuplicate = existing.some(bi => bi.broker === 'Bondora' && bi.currency === result.interest.currency);
    if (isDuplicate) {
        addImportedFile({
            name: file.name,
            type: 'bondora',
            status: 'error',
            message: 'This file appears to already be imported (Bondora EUR interest exists). Skipping to prevent duplicates.',
        });
        return;
    }

    // Use importBrokerInterest (replaces full array) — NOT addBrokerInterest (appends)
    importBrokerInterest([...existing, result.interest]);

    // Add foreign account balance (replace if same broker+currency already exists)
    const currentAccounts = useAppStore.getState().foreignAccounts ?? [];
    const existingBondoraIdx = currentAccounts.findIndex(
        a => a.broker === 'Bondora' && a.currency === result.foreignAccount.currency
    );
    if (existingBondoraIdx >= 0) {
        const updated = [...currentAccounts];
        updated[existingBondoraIdx] = result.foreignAccount;
        setForeignAccounts(updated);
    } else {
        setForeignAccounts([...currentAccounts, result.foreignAccount]);
    }

    const netInterest = result.interest.entries.reduce((s, e) => s + e.amount, 0);
    addImportedFile({
        name: file.name,
        type: 'bondora',
        status: 'success',
        message: `EUR: ${result.interest.entries.length} interest entries, net ${netInterest.toFixed(2)} EUR` +
            (result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : ''),
    });
}
```

**Note:** `importBrokerInterest` is already in the destructured store actions (line ~179). No dependency array change needed since `importBrokerInterest` is already listed in the `processFile` callback deps (line ~921).

- [ ] **Step 6: Add `parseBondoraCsv` import**

Add to the core imports at the top of `Import.tsx`:

```typescript
import { parseBondoraCsv } from '@bg-tax/core';
```

- [ ] **Step 7: Update unrecognized file error message**

Update the error message at line ~540 to include Bondora. Note: do NOT mention E*TRADE PDF here — PDFs go through the separate binary handler path and never reach this error:

```typescript
'Unrecognized CSV format. Expected IB activity statement, Revolut savings/investments/account CSV, or Bondora account statement CSV.'
```

---

### Task 7: Round-Trip Integration Test

**Files:**
- Modify: `packages/core/tests/integration/round-trip.test.ts`

- [ ] **Step 1: Add Bondora round-trip test case**

Per AGENTS.md requirement, add a test that verifies the invariant: parse CSV → export Excel → re-import Excel → export Excel produces identical results.

The test should:
1. Parse `samples/bondora-account-statement.csv` via `parseBondoraCsv()`
2. Build minimal AppState with the resulting `brokerInterest` and `foreignAccounts`
3. Export to Excel workbook
4. Verify the `Bondora Лихви EUR` sheet exists with correct data
5. Re-import the Excel via `importFullExcel()`
6. Verify `brokerInterest` and `foreignAccounts` match the original

---

### Task 8: Verify Integration

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @bg-tax/core test
```

Ensure no regressions in existing provider tests.

- [ ] **Step 2: Verify provider detection ordering**

Confirm that Bondora's `detectFile` does not false-positive on IB or Revolut CSVs by checking the test fixtures from other providers. Also verify that generic CSVs with `Date` column are not matched (Variant B requires all 4 columns including `Transaction ID`).

- [ ] **Step 3: Verify tax declaration flow**

Confirm that Bondora interest stored in `state.brokerInterest` is automatically picked up by the Declaration page's interest tax calculation (Appendix 8, Table 6). The existing code at `Declaration.tsx` lines 65-78 iterates all `brokerInterest` entries — no code changes needed, just verify the data flows correctly end-to-end.

- [ ] **Step 4: Verify undo/redo**

Confirm that `importBrokerInterest` and `setForeignAccounts` are tracked by the undo middleware. Import a Bondora file, then undo — the state should revert.
