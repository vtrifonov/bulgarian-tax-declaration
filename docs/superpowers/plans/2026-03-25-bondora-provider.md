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
1. Split content into lines, filter empty
2. Parse header row → detect variant by checking for `TransferDate` (variant A) vs `Date` + `Details` + `Turnover` (variant B)
3. Build column index map for: date, description, amount, balance (optional)
4. Define interest regex: `/^Transfer(Extra)?InterestRepaiment|^TransferGoGrowInterest/`
5. Iterate data rows:
   - Parse date to ISO `YYYY-MM-DD`
   - Classify description: if matches interest regex → create `InterestEntry`
   - Track balance: use `BalanceAfterPayment` column if present, otherwise compute running sum of amount values
6. Compute `amountStartOfYear` and `amountEndOfYear` from balance tracking
7. Emit warning if no balance column found and start-of-year balance defaults to 0
8. Return `{ interest, foreignAccount, warnings }`

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
        detectFile(content: string): boolean {
            const firstLine = content.split('\n')[0] ?? '';
            // Variant A
            if (firstLine.includes('TransferDate') && firstLine.includes('Description') && firstLine.includes('Amount')) {
                return true;
            }
            // Variant B — strict: require all three columns
            if (firstLine.includes('Date') && firstLine.includes('Details') && firstLine.includes('Turnover')) {
                return true;
            }
            return false;
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

- [ ] **Step 2: Add Bulgarian strings**

```typescript
'provider.bondora.instructions.account.label': 'Bondora Извлечение',
'provider.bondora.instructions.account.step1': 'Влезте в Bondora акаунта си',
'provider.bondora.instructions.account.step2': 'Отидете на Statements → Account Statement',
'provider.bondora.instructions.account.step3': 'Задайте период: данъчната година (1 януари – 31 декември)',
'provider.bondora.instructions.account.step4': 'Натиснете Create report и изтеглете CSV файла',
```

---

### Task 4: Create Test Fixtures

**Files:**
- Create: `packages/core/tests/fixtures/bondora-statement.csv`
- Create: `packages/core/tests/fixtures/bondora-statement-new.csv`

- [ ] **Step 1: Create Variant A fixture**

Old-format CSV with realistic data covering a full year. Include:
- 2+ deposit transactions
- 5+ interest transactions (`TransferInterestRepaiment`, `TransferExtraInterestRepaiment`)
- 1+ Go & Grow interest (`TransferGoGrowInterest`)
- 2+ principal repayments
- 1 withdrawal
- 1 fee transaction
- `BalanceAfterPayment` column with running balance

Use dates spanning Jan–Dec of 2025. Realistic EUR amounts (interest 0.01–5.00, deposits 100–1000).

- [ ] **Step 2: Create Variant B fixture**

New-format CSV with same transaction mix but using `Date`, `Details`, `Turnover`, `Transaction ID` columns. No `BalanceAfterPayment` column.

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

- [ ] **Step 2: Run tests and verify ≥ 70% coverage**

```bash
pnpm --filter @bg-tax/core test -- --coverage bondora
```

---

### Task 6: Verify Integration

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @bg-tax/core test
```

Ensure no regressions in existing provider tests.

- [ ] **Step 2: Verify provider detection ordering**

Confirm that Bondora's `detectFile` does not false-positive on IB or Revolut CSVs by checking the test fixtures from other providers.
