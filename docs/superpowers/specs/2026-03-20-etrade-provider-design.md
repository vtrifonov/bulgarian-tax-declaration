# E*TRADE Provider Design Spec

## 1. Overview

Add an E*TRADE (Morgan Stanley) provider that parses quarterly PDF client statements to extract holdings, interest income, cash balances, and activity data for Bulgarian tax declaration purposes.

**Key characteristics:**
- Input format: PDF (binary), not CSV/text like existing providers
- Statements are quarterly (Q1-Q4) or annual
- Account type: "Morgan Stanley at Work Self-Directed Account" (E*TRADE from Morgan Stanley)
- All values in USD
- Broker country: US

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| PDF parsing library | `pdf-parse` | Lightweight wrapper around pdf.js, extracts text content |
| MMF distributions | Treat as **interest** (10% BG tax) | TREASURY LIQUIDITY FUND is a money market fund. Consistent with how Revolut MMF savings are classified. Maps to `BrokerInterest` type. |
| Prior-year transactions | Include all | Bulgarian tax law uses cash basis (year of receipt) |
| Holdings import | Skip if prior holdings exist; extract only new current-year acquisitions | Consistent with IB/Revolut behavior |
| Cost basis | Use statement's Total Cost column | E*TRADE reports the tax-relevant cost basis |
| Foreign account | Cash balance only (type 03) | Stock holdings not reported as foreign account |
| Multiple files | Support both quarterly and annual PDFs | Parse each independently, merge in UI |
| Cost basis changes across quarters | Ignored (known limitation) | Cost basis may change due to stock plan vesting; not parseable at grant-level granularity from these PDFs |

## 3. FileHandler Interface Extension

The `FileHandler` type becomes a union of text and binary handlers:

```typescript
export interface TextFileHandler {
    id: string;
    kind: 'text';
    detectFile(content: string, filename: string): boolean;
    parseFile(content: string): BrokerProviderResult;
}

export interface BinaryFileHandler {
    id: string;
    kind: 'binary';
    detectBinary(buffer: ArrayBuffer, filename: string): boolean;
    parseBinary(buffer: ArrayBuffer): Promise<BrokerProviderResult>;
}

export type FileHandler = TextFileHandler | BinaryFileHandler;
```

- Existing text-based providers (IB, Revolut) use `TextFileHandler` with `kind: 'text'`
- E*TRADE uses `BinaryFileHandler` with `kind: 'binary'`
- The `kind` discriminant allows the UI to dispatch correctly without guessing

**UI file reading flow:**
```
For each file:
  1. Check provider handlers for binary handlers first
     - If filename.endsWith('.pdf') → read as arrayBuffer(), try binary handlers
  2. If no binary handler matched → read as text(), try text handlers
  3. If no handler matched → show error
```

## 4. Data Extraction

### 4.1 PDF Text Extraction

Use `pdf-parse` to extract text from the PDF. The text output preserves the general structure but loses exact table alignment. We parse sections by identifying known headers.

**Known risk**: pdf-parse extracts text as a flat string and may not preserve exact column positions for table data. The parser must use robust regex patterns that match by value patterns (dollar amounts, numbers) rather than relying on column alignment. During development, the actual pdf-parse output from the real PDFs will be captured and used to build resilient patterns. If pdf-parse output proves unreliable for table data, `pdf.js-extract` (which provides positional x/y data) can be evaluated as a drop-in replacement.

### 4.2 Section Detection

Sections are identified by these headers in the extracted text:

| Section | Header Pattern | Data Extracted |
|---|---|---|
| Period | `"For the Period <start> - <end>"` | Statement date range |
| Account Summary | `"Account Summary"` | Beginning/ending total value |
| Balance Sheet | `"BALANCE SHEET"` | Cash and stock values at period start/end |
| Holdings | `"COMMON STOCKS"` or `"STOCKS"` | Stock positions with quantity, cost, market value |
| Cash/MMF | `"CASH, BANK DEPOSIT PROGRAM AND MONEY MARKET FUNDS"` | Cash/MMF balance and yield |
| Activity | `"CASH FLOW ACTIVITY BY DATE"` | Interest (MMF dividends), trades, other transactions |
| Income Summary | `"INCOME AND DISTRIBUTION SUMMARY"` | Total income for verification |

**Validation**: If an expected section is not found, the parser should emit a warning (not fail silently). Missing sections are acceptable (e.g., no trades quarter) but unexpected missing sections (e.g., no Balance Sheet) should warn.

### 4.3 Holdings Extraction

From the "COMMON STOCKS" section:

```
Security Description              Quantity    Share Price    Total Cost    Market Value    Unrealized Gain/(Loss)
PROGRESS SOFTWARE (PRGS)           829.000      $51.510     $19,838.49     $42,701.79          $22,863.30
```

Extracted fields:
- `symbol`: Ticker in parentheses (e.g., "PRGS")
- `securityName`: Full name (e.g., "PROGRESS SOFTWARE")
- `quantity`: Number of shares
- `totalCost`: Cost basis (for FIFO)
- `marketValue`: Current market value
- `costPrice`: Derived as `totalCost / quantity`

Maps to `IBOpenPosition` (used generically for open positions across providers):
```typescript
{ symbol: 'PRGS', currency: 'USD', quantity: 829, costPrice: 23.93 }
```

Note: The `IBOpenPosition` type name is IB-specific but used generically. Consider renaming to `OpenPosition` in a future refactor.

### 4.4 MMF Interest Extraction

From the "CASH FLOW ACTIVITY BY DATE" section:

```
Activity  Settlement  Activity Type  Description                  Comments                                    Quantity  Price  Credits/(Debits)
Date      Date
1/2                   Dividend       TREASURY LIQUIDITY FUND      Transaction Reportable for the Prior Year.                   $16.45
2/3                   Dividend       TREASURY LIQUIDITY FUND DIV PAYMENT                                                       15.85
```

Despite the E*TRADE label "Dividend", TREASURY LIQUIDITY FUND is a money market fund. These distributions are **interest income** under Bulgarian tax law (10% tax rate).

Extracted fields:
- `date`: Activity Date, converted to ISO format (M/D → YYYY-MM-DD using statement year)
- `description`: Fund name (TREASURY LIQUIDITY FUND)
- `amount`: Credits/(Debits) value

Maps to `BrokerInterest` (same pattern as Revolut savings):
```typescript
{
    broker: 'E*TRADE',
    currency: 'USD',
    entries: [
        { date: '2025-01-02', amount: 16.45, currency: 'USD', source: { type: 'E*TRADE', file: '...' } },
        { date: '2025-02-03', amount: 15.85, currency: 'USD', source: { type: 'E*TRADE', file: '...' } },
        // ... more entries
    ]
}
```

**Note on "real" dividends**: If E*TRADE statements show dividends from actual equity holdings (not MMF), those should be classified as `Dividend` type with 5% BG tax. The parser distinguishes by checking the description: entries containing "LIQUIDITY FUND", "MONEY MARKET", or "MMF" are interest; others are dividends.

### 4.5 Cash Balance Extraction

From the "BALANCE SHEET" section:

```
                          Last Period        This Period
                         (as of 12/31/24)   (as of 12/31/25)
Cash, BDP, MMFs           $4,645.52          $4,829.45
```

Maps to `ForeignAccountBalance`:
```typescript
{
    broker: 'E*TRADE',
    type: '03',        // Bank deposit
    maturity: 'L',     // Long-term
    country: 'US',
    currency: 'USD',
    amountStartOfYear: 4645.52,
    amountEndOfYear: 4829.45
}
```

For start-of-year: use Q1's "Last Period" (or the earliest available statement's previous period).
For end-of-year: use Q4's "This Period" (or the latest available statement's current period).

### 4.6 Trade Extraction (Future-proofing)

The current statements show no stock trades, but the parser should handle "Bought" and "Sold" activity types when they appear:

```
Activity  Settlement  Activity Type  Description    Comments  Quantity  Price    Credits/(Debits)
Date      Date
5/15      5/17        Bought         AAPL                     10        $150.00  ($1,500.00)
```

Maps to `Trade` (all E*TRADE values are USD):
```typescript
{
    symbol: 'AAPL',
    dateTime: '2025-05-15',
    quantity: 10,          // positive for buy, negative for sell
    price: 150.00,
    proceeds: 0,           // 0 for buys; absolute value for sells
    commission: 0,         // E*TRADE shows net amounts; commission not broken out
    currency: 'USD'        // Always USD for E*TRADE
}
```

For sells, `quantity` is negative and `proceeds` is the absolute value of the Credits/(Debits) column.

## 5. Multi-File Merging

When multiple quarterly PDFs are imported:

Each `parseBinary` call returns **all transactions from that single PDF** — no cross-file awareness. The **UI layer** (Import.tsx) is responsible for merging across multiple E*TRADE files, similar to how it handles multiple Revolut files.

**Merge rules in the UI:**

1. **Holdings**: Replace — each new E*TRADE file replaces the previous E*TRADE holdings (last file wins, which should be the most recent quarter)
2. **Interest (MMF)**: Append — collect from all quarters. Deduplication by `(date, amount)` as safety net, though quarterly statements only include their period's activity.
3. **Cash balances**: Replace — latest E*TRADE file's cash balance replaces previous. User should import Q4 (or annual) last to get correct end-of-year values.
4. **Trades**: Append — collect from all quarters. Deduplicate by `(date, symbol, quantity, amount)`.
5. **Dividends** (if any equity dividends appear): Same as interest — append and deduplicate.

## 6. File Structure

```
packages/core/src/providers/etrade.ts                  — BrokerProvider definition
packages/core/src/parsers/etrade-pdf.ts                — PDF text extraction + section parsing logic
packages/core/src/parsers/__tests__/etrade-pdf.test.ts — Parser unit tests (text-level fixtures, no binary PDFs)
```

## 7. UI Changes

### 7.1 Import Page (`Import.tsx`)

- **File reading**: For `.pdf` files, read as `arrayBuffer()` instead of `text()`. Use `handler.kind` discriminant to dispatch.
- **Provider detection**: Iterate all providers' handlers. For `kind: 'binary'` handlers, call `detectBinary(buffer, filename)`. For `kind: 'text'` handlers, call `detectFile(content, filename)`.
- **Import processing**:
  1. Parse PDF → extract interest, holdings, cash balances, (trades if any)
  2. Group interest entries by currency → import as `BrokerInterest` (same pattern as Revolut savings)
  3. Resolve countries for holdings via `resolveCountries`
  4. Handle holdings: if prior holdings exist, only add new current-year acquisitions
  5. Set foreign account balances
  6. Merge results from multiple E*TRADE PDFs (replace holdings/cash, append interest/trades)
- **File type**: Add `'etrade'` to `ImportedFile['type']` union. A single type is sufficient.
- **File badge**: Add UI rendering for E*TRADE file type (label: "E*TRADE", color: distinct from IB/Revolut)

### 7.2 Provider Registry

Add `etradeProvider` to `packages/core/src/providers/registry.ts`.

### 7.3 i18n

Add export instruction keys for E*TRADE:
```
provider.etrade.instructions.statement.label
provider.etrade.instructions.statement.step1  — "Log in to your E*TRADE account at www.etrade.com"
provider.etrade.instructions.statement.step2  — "Go to Accounts → Documents → Statements"
provider.etrade.instructions.statement.step3  — "Select the tax year and download quarterly or annual Client Statements"
provider.etrade.instructions.statement.step4  — "Save the PDF file(s) and import them here"
```

## 8. Testing Strategy

**Approach**: Mock `pdf-parse` output at the text level. Tests provide pre-extracted text strings (matching the real PDF text output format) to the section parsers. This avoids needing real/synthetic PDF binary fixtures and makes tests fast and deterministic.

- **Unit tests** for each section parser function (`parseHoldings`, `parseInterest`, `parseCashBalance`, `parseTrades`): feed synthetic text snippets matching the pdf-parse output format
- **Integration test**: Mock `pdf-parse` to return a full multi-section text output, verify the complete `BrokerProviderResult`
- **Edge cases**: Empty sections, missing quarters, single annual statement, statements with no trades, statements with only MMF interest
- **Coverage target**: ≥70% line coverage for the E*TRADE parser module (per AGENTS.md requirement)
- **Validation**: During development, capture actual pdf-parse text output from the real E*TRADE PDFs. Use this captured text as the basis for test fixtures (as string constants). This ensures tests match real-world output.

## 9. Dependencies

- `pdf-parse` (npm package) — added to `packages/core/package.json`
- No other new dependencies
- **Fallback**: If pdf-parse proves unreliable for table data extraction, evaluate `pdf.js-extract` which provides positional (x, y) data for each text element

## 10. Out of Scope

- Renaming `IBOpenPosition` to `OpenPosition` (separate refactor)
- Tax lot detail parsing (E*TRADE says "visit www.etrade.com" for this)
- Options transactions
- Margin interest
- Stock plan vesting grant-level tracking (cost basis changes across quarters are noted but not parsed individually)
- PRGS equity dividends (not present in current statements; parser supports them if they appear)
