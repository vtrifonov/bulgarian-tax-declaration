# Bondora Provider Design Spec

## 1. Overview

Add a Bondora provider that parses the Bondora Account Statement CSV to extract interest income and account balances for Bulgarian tax declaration and SPB-8 reporting.

**Key characteristics:**
- Input format: CSV (text), Account Statement exported from Bondora
- Platform type: P2P lending (peer-to-peer consumer loans)
- Primary product: Go & Grow (simplified investing with daily liquidity)
- Bondora is registered in **Estonia** (country code: **EE**)
- All values in **EUR**
- No securities (no ISIN needed) — Bondora is a deposit/loan platform, not a brokerage

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| CSV format variant | Support both old (`TransferDate`, `Amount`, `Description`) and new (`Date`, `Turnover`, `Details`) column names | Bondora changed their export format around 2019; users may have either version |
| Interest classification | `TransferInterestRepaiment*` and `TransferExtraInterestRepaiment*` descriptions | Matches Bondora's naming convention — note "Repaiment" is Bondora's actual typo, not "Repayment" |
| Go & Grow interest | `TransferGoGrowInterest*` | Separate regex for Go & Grow product interest income |
| Account balance for SPB-8 | Derive from running sum of all `Turnover`/`Amount` values | The CSV is a full transaction log; the running sum at year boundaries gives start/end balances |
| SPB-8 Section | **03** (foreign bank accounts / payment accounts) | Bondora is a payment account, not a securities account |
| SPB-8 maturity | **S** (short-term) | Go & Grow has daily liquidity; even portfolio investments are short-term receivables |
| Currency | Always EUR | Bondora operates exclusively in EUR |
| Country | Always EE (Estonia) | Bondora AS is registered in Estonia |
| Tax treatment | Interest income → 10% flat tax in Bulgaria | P2P lending interest is taxable as interest income |
| Balance column | Use `BalanceAfterPayment` if present; otherwise compute running sum | Newer exports may include a balance column |

## 3. Bondora CSV Format

### Variant A — Older Format (pre-2019)

```csv
TransferDate,Description,Amount,Currency,LoanNumber,Counterparty,BalanceAfterPayment
15.03.2025 14:30,TransferDeposit,500.00,EUR,,Bondora,500.00
16.03.2025 09:15,TransferInterestRepaiment,0.52,EUR,12345,Borrower Name,500.52
17.03.2025 11:00,Withdraw,-200.00,EUR,,Bondora,300.52
```

**Columns:**
| Column | Description |
|---|---|
| `TransferDate` | Transaction timestamp (`DD.MM.YYYY HH:MM`) |
| `Description` | Transaction type identifier |
| `Amount` | Monetary value (positive = inflow, negative = outflow) |
| `Currency` | Always `EUR` |
| `LoanNumber` | Loan identifier (empty for deposits/withdrawals) |
| `Counterparty` | Payer/payee name |
| `BalanceAfterPayment` | Running account balance after this transaction |

### Variant B — Newer Format (post-2019)

```csv
Date,Details,Turnover,Transaction ID
2025-03-15 14:30:00,TransferDeposit,500.00,abc-123
2025-03-16 09:15:00,TransferInterestRepaiment,0.52,def-456
2025-03-17 11:00:00,Withdraw,-200.00,ghi-789
```

**Columns:**
| Column | Description |
|---|---|
| `Date` | Transaction timestamp (`YYYY-MM-DD HH:MM:SS`) |
| `Details` | Transaction type identifier |
| `Turnover` | Monetary value |
| `Transaction ID` | Unique transaction identifier |

### Transaction Type Classification (via Description/Details regex)

| Category | Regex Pattern | Tax Relevance |
|---|---|---|
| Interest | `^TransferInterestRepaiment` | Taxable interest income |
| Extra Interest | `^TransferExtraInterestRepaiment` | Taxable interest income |
| Go & Grow Interest | `^TransferGoGrowInterest` | Taxable interest income |
| Deposit | `^TransferDeposit\|^TransferGoGrowMainRepaiment\|^Incoming` | Not taxable (own money) |
| Withdrawal | `^Withdraw\|^TransferGoGrow$\|^Outgoing` | Not taxable (own money) |
| Fee | `^FX commission` | Deductible expense (informational) |
| Principal | `^TransferPrincipalRepaiment\|^Principal` | Not taxable (return of capital) |
| Investment | `^TransferInvestment\|^Investment\|^Bid` | Not taxable (internal transfer) |

## 4. Data Model Mapping

### Interest Income → `BrokerInterest`

```typescript
{
    broker: 'Bondora',
    currency: 'EUR',
    entries: InterestEntry[]  // one per interest transaction
}
```

Each interest transaction becomes an `InterestEntry`:
```typescript
{
    currency: 'EUR',
    date: '2025-03-16',        // parsed from TransferDate/Date
    description: 'TransferInterestRepaiment',
    amount: 0.52,
}
```

### Account Balance → `ForeignAccountBalance`

```typescript
{
    broker: 'Bondora',
    type: '03',                 // payment account
    maturity: 'S',              // short-term
    country: 'EE',              // Estonia
    currency: 'EUR',
    amountStartOfYear: 1234.56, // balance at first transaction of year
    amountEndOfYear: 2345.67,   // balance at last transaction of year
}
```

**Balance computation:**
1. If `BalanceAfterPayment` column exists (Variant A):
   - `amountStartOfYear` = first row's `BalanceAfterPayment` minus first row's `Amount`
   - `amountEndOfYear` = last row's `BalanceAfterPayment`
2. If no balance column (Variant B):
   - Compute running sum of `Turnover` values
   - `amountStartOfYear` = 0 (or sum up to first transaction, if previous year data present)
   - `amountEndOfYear` = running sum at last transaction

**Important — partial year and multi-year CSVs:**
- For **both variants**: if the CSV doesn't start from January 1 (partial year export), `amountStartOfYear` will reflect the balance before the first transaction in the file, NOT the actual Jan 1 balance. Users should be warned to verify/adjust manually.
- For **multi-year CSVs**: balances use the first/last transaction overall, not per tax year. The export instructions ask users to set the period to a single tax year to avoid this.

### `BrokerProviderResult`

```typescript
{
    savingsInterest: {
        broker: 'Bondora',
        currency: 'EUR',
        entries: InterestEntry[],
    },
    foreignAccounts: [ForeignAccountBalance],
    warnings: string[],
}
```

## 5. File Detection

The parser detects a Bondora CSV by checking the header row:

```typescript
function detectFile(content: string, _filename: string): boolean {
    try {
        const firstLine = content.split('\n')[0] ?? '';
        // Variant A: old format
        if (firstLine.includes('TransferDate') && firstLine.includes('Description') && firstLine.includes('Amount')) {
            return true;
        }
        // Variant B: new format — require all four columns to avoid false positives with generic CSVs
        if (firstLine.includes('Date') && firstLine.includes('Details')
            && firstLine.includes('Turnover') && firstLine.includes('Transaction ID')) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}
```

**Notes:**
- `detectFile` must accept `(content, filename)` to match the `TextFileHandler` interface, even if `filename` is unused.
- `detectFile` must NEVER throw (AGENTS.md rule) — wrap in try-catch, return `false` on error.
- Variant B detection requires all 4 columns (`Date`, `Details`, `Turnover`, `Transaction ID`) to avoid matching generic CSVs that happen to use common column names.
- Detection ordering in `Import.tsx` must come AFTER IB and Revolut checks.

## 6. Parser Module

### `packages/core/src/parsers/bondora-csv.ts`

```typescript
export interface BondoraParseResult {
    interest: BrokerInterest;
    foreignAccount: ForeignAccountBalance;
    warnings: string[];
}

export function parseBondoraCsv(content: string): BondoraParseResult;
```

**Implementation strategy:**
1. Strip UTF-8 BOM if present: `content.replace(/^\uFEFF/, '')`
2. Parse header row → detect variant (A or B) by column names
3. Map column names to a unified accessor (date, description, amount, balance)
4. Iterate rows:
   - Parse date → ISO format
   - Classify description via regex → interest / deposit / withdrawal / etc.
   - If interest → push to `InterestEntry[]`
   - Track running balance (or use `BalanceAfterPayment` if available)
4. After all rows: compute start-of-year and end-of-year balances
5. Return `BondoraParseResult`

### Date Parsing

| Variant | Input Format | Example |
|---|---|---|
| A | `DD.MM.YYYY HH:MM` | `15.03.2025 14:30` |
| B | `YYYY-MM-DD HH:MM:SS` | `2025-03-15 14:30:00` |

Both are converted to ISO date `YYYY-MM-DD` for `InterestEntry.date`.

## 7. Provider Registration

### `packages/core/src/providers/bondora.ts`

```typescript
export const bondoraProvider: BrokerProvider = {
    name: 'Bondora',
    fileHandlers: [{
        id: 'bondora-account-statement',
        kind: 'text',
        detectFile(content: string, _filename: string): boolean { /* try-catch wrapped */ },
        parseFile(content: string): BrokerProviderResult { ... },
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

### Export Instructions

**English:**
1. Log in to your Bondora account
2. Go to Statements → Account Statement
3. Set the period to the tax year (Jan 1 – Dec 31)
4. Click Create report and download the CSV file

**Bulgarian:**
1. Влезте в Bondora акаунта си
2. Отидете на Statements → Account Statement
3. Задайте период: данъчната година (1 януари – 31 декември)
4. Натиснете Create report и изтеглете CSV файла

### Registry Update

```typescript
// packages/core/src/providers/registry.ts
import { bondoraProvider } from './bondora.js';

export const providers: BrokerProvider[] = [
    ibProvider,
    revolutProvider,
    etradeProvider,
    bondoraProvider,  // NEW
];
```

## 8. Testing Strategy

### Unit Tests: `packages/core/tests/parsers/bondora-csv.test.ts`

**Test fixture:** `packages/core/tests/fixtures/bondora-statement.csv`

Fixture should contain a realistic mix of transaction types:
- Deposits, withdrawals
- Interest payments (`TransferInterestRepaiment`, `TransferExtraInterestRepaiment`)
- Go & Grow interest (`TransferGoGrowInterest`)
- Principal repayments
- Fees
- Multiple dates spanning a full year

**Test cases:**
1. Parses Variant A (old format) — correct interest entries extracted
2. Parses Variant B (new format) — correct interest entries extracted
3. Interest amounts sum correctly
4. Non-interest transactions excluded from interest entries
5. Foreign account balance computed correctly (start/end of year)
6. Balance from `BalanceAfterPayment` column when present
7. Balance from running sum when no balance column
8. Date parsing — both DD.MM.YYYY and YYYY-MM-DD formats
9. Empty CSV → throws error
10. Warning emitted when start-of-year balance cannot be determined
11. File detection — `detectFile` returns `true` for both variants, `false` for IB/Revolut CSVs
12. BOM prefix — CSV with `\uFEFF` prefix parses correctly
13. Negative interest amount — reversal entry included with negative amount
14. Zero interest entries — CSV with only deposits/withdrawals returns empty entries array gracefully
15. Malformed date — row with invalid date is skipped (not thrown)

### Integration Round-Trip Test

Per AGENTS.md, add a test case in `tests/integration/round-trip.test.ts` verifying:
- Parse Bondora CSV → export Excel → re-import Excel → export Excel produces identical results
- Both `brokerInterest` (→ `Bondora Лихви EUR` sheet) and `foreignAccounts` (→ `СПБ-8 Сметки` sheet) survive the round-trip

### Sample File

Create `samples/bondora-account-statement.csv` (synthetic data covering all transaction types) per AGENTS.md requirements.

### Coverage Target: ≥ 70%

## 9. Excel Round-Trip

Interest entries appear in the `Bondora Лихви EUR` sheet (following the `{Broker} Лихви {CCY}` naming convention already used for Revolut/IB).

Foreign account balance appears in the `СПБ-8 Сметки` sheet alongside IB and Revolut accounts.

## 10. Tax Declaration Integration

Bondora interest income is reported in the annual Bulgarian tax declaration (NRA form):

- **Form location:** Приложение 8, Таблица 6 (Appendix 8, Table 6 — Foreign Interest Income)
- **Column 4:** Gross interest amount (converted to base currency BGN/EUR)
- **Column 7:** Tax due = gross × 10%
- **No WHT credit:** Bondora does not withhold tax, so the full 10% is due

**Automatic flow:** Once Bondora interest is stored in `state.brokerInterest`, the existing Declaration page (`Declaration.tsx`) automatically:
1. Iterates all `brokerInterest` entries (lines 65-75)
2. Converts each broker's interest sum to base currency
3. Calculates 10% tax
4. Aggregates with other interest sources (IB stock yield, Revolut savings, etc.)
5. Maps totals to Appendix 8, Table 6 fields via form config

No changes needed in the tax calculation or declaration mapping — only the import pipeline must store Bondora interest correctly in `state.brokerInterest`.

## 11. UI Impact

Import.tsx changes required — the Import page uses **hardcoded file detection** (`detectFileType` function) and provider-specific processing branches for text/CSV files (the generic provider abstraction is only used for binary files like E*TRADE PDFs):

1. **`detectFileType()`** — Add a `'bondora'` case that checks the header for Bondora column names (must be ordered after IB/Revolut checks to avoid false positives)
2. **Processing branch** — Add an `else if (fileType === 'bondora')` block that:
   - Calls `parseBondoraCsv(content)`
   - Sets `source: { type: 'Bondora', file: file.name }` on each interest entry (matching Revolut pattern)
   - Adds the `BrokerInterest` result to `state.brokerInterest` using `importBrokerInterest([...existing, entry])` (NOT `addBrokerInterest` — must follow Revolut pattern of replacing the full array)
   - On duplicate (same broker+currency already exists): records error status and returns early (matching Revolut dedup pattern)
   - Adds the `ForeignAccountBalance` to `state.foreignAccounts`
   - Records the imported file with summary message
3. **`importPriority()`** — Add `'bondora'` with priority 55 (after E*TRADE)
4. **`importedBrokers` memo** — Add `'bondora'` → `'Bondora'` mapping
5. **`ImportedFile['type']`** — Add `'bondora'` to the union type in `app-state.ts`
6. **`import.supported` i18n** — Update both `en.ts` and `bg.ts` to include Bondora in the supported formats string shown in the drag-and-drop area
7. **Error message** — Update unrecognized file message to include Bondora (but NOT E*TRADE PDF, since PDFs go through a separate binary handler path)

Other UI pages need no changes:
- Workspace interest table already shows all `brokerInterest` entries
- Declaration page already aggregates all broker interest for tax calculation
- SPB-8 page already shows all `foreignAccounts`

## 12. Known Limitations (v1)

- **No secondary market P&L:** Bondora secondary market profits/losses are not parsed (rarely used by Bulgarian investors)
- **Partial-year balance:** For both variants, if the CSV doesn't cover the full year from Jan 1, `amountStartOfYear` reflects the pre-first-transaction balance, not the actual Jan 1 balance. Users must verify/adjust manually.
- **Multi-year CSV:** If the statement spans multiple years, all interest entries are imported (no year filtering at parse time) and balance uses first/last overall transaction. Users should export single-year statements.
- **No year-mismatch validation:** The validator does not currently warn when interest entry dates don't match the selected tax year (pre-existing gap for all `brokerInterest`, not Bondora-specific).
- **Go & Grow only:** Most Bulgarian Bondora investors use Go & Grow; Portfolio Manager loan-level data (individual loan IDs, default tracking) is out of scope for v1
- **Single currency:** Only EUR is supported (Bondora operates exclusively in EUR)

## 13. Out of Scope (v1)

- Bondora API integration (programmatic data fetch)
- PDF tax report parsing (PDF format, less structured than CSV)
- Monthly Overview report parsing
- Cash Flow report parsing
- Secondary market trade tracking
- Loan-level investment details

## 14. File Structure

```
packages/core/src/
  parsers/
    bondora-csv.ts              — CSV parser (both format variants)
  providers/
    bondora.ts                  — BrokerProvider definition
    registry.ts                 — Register Bondora provider (modify)
  i18n/
    en.ts                       — English export instructions (modify)
    bg.ts                       — Bulgarian export instructions (modify)

packages/core/tests/
  parsers/
    bondora-csv.test.ts         — Parser unit tests
  fixtures/
    bondora-statement.csv       — Test fixture (Variant A)
    bondora-statement-new.csv   — Test fixture (Variant B)
  integration/
    round-trip.test.ts          — Add Bondora round-trip test case (modify)

samples/
  bondora-account-statement.csv — Synthetic sample for integration tests (create)

packages/ui/src/
  pages/
    Import.tsx                  — Add Bondora detection + processing branch (modify)
  store/
    app-state.ts                — Add 'bondora' to ImportedFile type union (modify)
```
