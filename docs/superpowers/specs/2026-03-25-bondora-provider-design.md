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
| Interest classification | `TransferInterestRepaiment*` and `TransferExtraInterestRepaiment*` descriptions | Matches Bondora's naming convention for interest payments on loans |
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

**Important:** Since Variant B may not include a starting balance, users should be warned that start-of-year balance may need manual adjustment if the statement doesn't cover the full year from account opening.

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
function detectFile(content: string): boolean {
    const firstLine = content.split('\n')[0] ?? '';
    // Variant A: old format
    if (firstLine.includes('TransferDate') && firstLine.includes('Description') && firstLine.includes('Amount')) {
        return true;
    }
    // Variant B: new format — require all three to avoid false positives
    if (firstLine.includes('Date') && firstLine.includes('Details') && firstLine.includes('Turnover')) {
        return true;
    }
    return false;
}
```

**Note:** Variant B detection must be strict (require all 3 columns) to avoid matching other CSV formats that contain a generic `Date` column.

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
1. Parse header row → detect variant (A or B) by column names
2. Map column names to a unified accessor (date, description, amount, balance)
3. Iterate rows:
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
        detectFile(content: string): boolean { ... },
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

### Coverage Target: ≥ 70%

## 9. Excel Round-Trip

Interest entries appear in the `Bondora Лихви EUR` sheet (following the `{Broker} Лихви {CCY}` naming convention already used for Revolut/IB).

Foreign account balance appears in the `СПБ-8 Сметки` sheet alongside IB and Revolut accounts.

## 10. UI Impact

Minimal UI changes needed:
- The Import page already handles any registered `BrokerProvider` with `TextFileHandler`
- Bondora files will be auto-detected when dropped/selected
- Interest will appear in the interest table
- Foreign account will appear in the SPB-8 accounts table

## 11. Known Limitations (v1)

- **No secondary market P&L:** Bondora secondary market profits/losses are not parsed (rarely used by Bulgarian investors)
- **Start-of-year balance for Variant B:** If the CSV doesn't include a `BalanceAfterPayment` column and doesn't start from account opening, the start-of-year balance will be 0 and needs manual correction
- **Go & Grow only:** Most Bulgarian Bondora investors use Go & Grow; Portfolio Manager loan-level data (individual loan IDs, default tracking) is out of scope for v1
- **Single currency:** Only EUR is supported (Bondora operates exclusively in EUR)

## 12. Out of Scope (v1)

- Bondora API integration (programmatic data fetch)
- PDF tax report parsing (PDF format, less structured than CSV)
- Monthly Overview report parsing
- Cash Flow report parsing
- Secondary market trade tracking
- Loan-level investment details

## 13. File Structure

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
```
