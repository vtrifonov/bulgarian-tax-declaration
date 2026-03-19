# SPB-8 Form Support — Design Specification

## Overview

Add support for generating BNB Form SPB-8 (Форма СПБ-8) — an annual statistical report filed with the Bulgarian National Bank by resident individuals declaring foreign financial assets and liabilities.

### Key Facts

- **Legal basis:** Article 13, BNB Ordinance No. 27
- **Filing threshold:** Total foreign assets >= 50,000 BGN at year-end
- **Deadline:** March 31 of the following year
- **Electronic filing:** Required if more than 5 data rows (via BNB ISIS portal with qualified electronic signature)
- **EUR/BGN:** Fixed at 1.95583

### Form Structure

- **Section 1:** Personal data (name, EGN, address, phone, email)
- **Section 2, rows 01-03:** Financial credits & foreign bank accounts (type, maturity, country, currency, amounts in thousands)
- **Section 2, row 04:** Securities acquired through foreign intermediaries (ISIN, quantity at year-start and year-end)

## Data Sources

### IB Activity Statement (CSV)

**Cash Report section** — provides foreign account balances for Section 03:
```
Cash Report,Data,Starting Cash,EUR,200,...
Cash Report,Data,Ending Cash,EUR,373.506,...
Cash Report,Data,Starting Cash,USD,9696.601,...
Cash Report,Data,Ending Cash,USD,3358.570,...
```
- Country: derived from statement header (e.g., "Interactive Brokers Ireland Limited" → **IE**, "Interactive Brokers LLC" → **US**)
- Maturity: **L** (indefinite brokerage cash account)
- One row per currency (EUR, USD, etc.)

**Financial Instrument Information section** — provides symbol-to-ISIN mapping:
```
Financial Instrument Information,Data,Stocks,AAPL,...,US0378331005,AAPL,NASDAQ,...
Financial Instrument Information,Data,Stocks,1810,...,KYG9830T1067,1810,SEHK,...
```
- Column `Security ID` contains the ISIN
- Used to populate `isin` field on holdings

### Revolut Savings Statements (CSV)

These are **money market fund shares**, not cash accounts. Each file represents a single currency fund:
- GBP fund: ISIN `IE0002RUHW32` (Irish-domiciled)
- USD fund: ISIN `IE000H9J0QX4` (Irish-domiciled)
- EUR fund: ISIN `IE000AZVL3K0` (Irish-domiciled)

File format:
```csv
Date,Description,"Value, EUR",Price per share,Quantity of shares
"Dec 31, 2025, 2:46:51 AM",Service Fee Charged EUR Class IE000AZVL3K0,-0.1273,,
"Dec 18, 2025, 1:37:50 PM",BUY EUR Class R IE000AZVL3K0,"1,820.19",1.00,"1,820.19"
"Nov 24, 2025, 2:41:40 PM",SELL EUR Class R IE000AZVL3K0,-150,1.00,150
```

- BUY/SELL transactions have "Price per share" and "Quantity of shares" columns
- ISIN is embedded in every transaction description
- Balance is computed by summing BUY quantities minus SELL quantities
- Reported in **Section 04** (securities), NOT Section 03 (accounts)
- Price per share is ~1.00 for these money market funds

### Revolut Account Statements (CSV)

Revolut current account statements have a **running Balance column**, allowing automatic extraction of start/end-of-year balances.

File format:
```csv
Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
Card Payment,Current,2025-01-18 00:00:34,2025-01-18 08:01:21,Sky,-2.99,0.00,EUR,COMPLETED,47.37
Transfer,Current,2025-01-20 22:13:00,2025-01-20 22:13:00,From Flexible Cash Funds,50.00,0.00,EUR,COMPLETED,97.37
```

- Filter to `Product=Current` and `State=COMPLETED` rows only (ignore `Savings` rows)
- **Start-of-year balance:** First row's Balance minus first row's Amount (reconstructs pre-transaction balance)
- **End-of-year balance:** Last `Current` row's Balance
- Currency detected from the `Currency` column
- Country: **LT** (Revolut Bank UAB, Lithuania)
- Maturity: **S** (short-term current account)

Note: The file may also contain `Savings` product rows — these are separate from the current account and should be ignored (savings are covered by the savings statement parser as money market fund shares).

### Revolut Investment Statements (CSV)

The current Revolut investments parser already handles this format. For SPB-8, the relevant data is:
- Holdings at year-start and year-end (derived from BUY/SELL transactions)
- ISIN resolution needed for each ticker (via ISIN map or manual entry)

2026 format:
```csv
Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2026-01-21T14:30:00.316Z,GOOG,BUY - MARKET,0.00623014,USD 321.02,USD 2,USD,1.1751
```

## Data Model

### New Types

```typescript
/** Foreign account balance for SPB-8 Section 03 */
export interface ForeignAccountBalance {
    broker: string;
    type: '01' | '02' | '03';
    maturity: 'L' | 'S';
    country: string;          // ISO 3166-1 alpha-2
    currency: string;          // ISO 4217
    amountStartOfYear: number; // In original currency (NOT thousands)
    amountEndOfYear: number;
}

/** Securities holding snapshot for SPB-8 Section 04 */
export interface Spb8Security {
    isin: string;
    currency: string;          // ISO 4217 — needed for threshold calculation
    quantityStartOfYear: number;
    quantityEndOfYear: number;
}

/** Personal data for SPB-8 Section 1 (all optional) */
export interface Spb8PersonalData {
    name?: string;
    egn?: string;
    address?: {
        city?: string;
        postalCode?: string;
        district?: string;
        street?: string;
        number?: string;
        entrance?: string;
    };
    phone?: string;
    email?: string;
}

/** Complete SPB-8 form data (computed, not stored) */
export interface Spb8FormData {
    year: number;
    reportType: 'P' | 'R';
    personalData: Spb8PersonalData;
    accounts: ForeignAccountBalance[];
    securities: Spb8Security[];
    thresholdMet: boolean;
    totalBgn: number;
}
```

### AppState Extensions

```typescript
export interface AppState {
    // ... existing fields ...
    foreignAccounts?: ForeignAccountBalance[];
    spb8PersonalData?: Spb8PersonalData;
}
```

### Holding Extension

Add optional `isin` field to existing `Holding` interface:

```typescript
export interface Holding {
    // ... existing fields ...
    isin?: string;
}
```

## ISIN Resolution

### Sources (in priority order)

1. **IB CSV parser** — extracts ISIN from "Financial Instrument Information" section's `Security ID` column
2. **Revolut savings parser** — extracts ISIN from transaction description (e.g., "BUY EUR Class R **IE000AZVL3K0**")
3. **Hardcoded map** — `ISIN_MAP` in `packages/core/src/isin-map.ts`, seeded from known ticker-to-ISIN mappings
4. **Manual override** — user edits ISIN in the holdings table or SPB-8 page

### Module: `packages/core/src/isin-map.ts`

Follows the same pattern as `country-map.ts`:

```typescript
export const ISIN_MAP: Record<string, string> = {
    AAPL: 'US0378331005',
    MSFT: 'US5949181045',
    // ... seeded from SPB-8 specification reference table
};

export function resolveIsinSync(symbol: string): string;
export async function resolveIsins(
    symbols: { symbol: string; currency: string }[],
    fetchFn?: typeof fetch,
): Promise<Record<string, string>>;
```

### ISIN Validation

- Must be exactly 12 characters (2-letter country prefix + 9 alphanumeric + 1 check digit)
- Warn (don't block) if ISIN is missing for any holding — user can fill in manually

## SPB-8 Data Assembly

### Module: `packages/core/src/spb8/assemble.ts`

```typescript
export function assembleSpb8(
    state: AppState,
    personalData: Spb8PersonalData,
    reportType: 'P' | 'R',
    previousYearSecurities?: Spb8Security[],
): Spb8FormData;
```

### Securities (Section 04) Assembly

1. Collect all non-consumed holdings from AppState (these represent end-of-year positions)
2. Revolut savings fund positions flow through AppState.holdings like any other holding (with ISIN pre-populated by the savings parser)
3. Resolve ISIN for each holding (parser-provided → ISIN_MAP → manual)
4. Group by ISIN — sum quantities across all lots with the same ISIN
5. End-of-year quantities = sum of current (non-consumed) holdings per ISIN
6. Start-of-year quantities (in priority order):
   a. If `previousYearSecurities` provided → use matching ISIN's end-of-year value as this year's start
   b. Otherwise → reconstruct from AppState: for each ISIN, compute `endOfYearQty + totalSoldQty - totalBoughtQty` where:
      - `totalSoldQty` = sum of `sale.quantity` from `state.sales` where `sale.isin === isin` (matched via holdings' ISIN)
      - `totalBoughtQty` = sum of `holding.quantity` from `state.holdings` where `holding.dateAcquired` falls within the tax year and `holding.isin === isin`
7. Include a row if held at either date (even if 0 at one end)
8. Securities with missing ISIN are flagged as warnings but still included (user must resolve before export)

### Accounts (Section 03) Assembly

1. Take `foreignAccounts` from AppState (parsed from IB Cash Report + Revolut account statements + manual entries)
2. Group by country + currency + maturity
3. Aggregate amounts within each group
4. Convert to thousands and round to whole numbers (at Excel generation time, not here)

### Threshold Check

```
totalBgn = 0
for each account:
    totalBgn += amountEndOfYear * fxRate(currency)  // stored in original currency
for each security:
    totalBgn += quantityEndOfYear * unitPrice * fxRate(currency)
    // unitPrice comes from the Holding's unitPrice (cost basis as approximation)
    // For accurate threshold, user should verify total value
thresholdMet = totalBgn >= 50000
```

Note: EUR/BGN is fixed at 1.95583. Other rates from BNB/ECB via existing FX service. The threshold is **informational only** — it doesn't block export. The user is responsible for determining whether filing is required.

## Parser Extensions

### IB CSV Parser (`packages/core/src/parsers/ib-csv.ts`)

**New sections to parse:**

1. **Cash Report** — extract `Starting Cash` and `Ending Cash` per currency (skip `Base Currency Summary` rows, only take actual currency rows like EUR, USD)
2. **Financial Instrument Information** — extract `Symbol` → `Security ID` (ISIN) mapping

**Important: all column references must use the Header row's column names, not hardcoded indices.** The IB CSV parser already builds `columnMaps` from header rows — the new sections follow the same pattern.

**Cash Report parsing:**
- Section name: `Cash Report`
- Header columns: `Currency Summary, Currency, Total, Securities, Futures, ...`
- Filter Data rows where `Currency Summary` column is `Starting Cash` or `Ending Cash`
- Skip rows where `Currency` column is `Base Currency Summary` (aggregated totals)
- Extract currency from the `Currency` column
- Extract amount from the `Total` column

**Financial Instrument Information parsing:**
- Section name: `Financial Instrument Information`
- Header columns: `Asset Category, Symbol, Description, Conid, Security ID, Underlying, Listing Exch, Multiplier, Type, Code`
- Map: `Symbol` column → `Security ID` column (contains ISIN)

**BrokerProviderResult additions:**
```typescript
export interface BrokerProviderResult {
    // ... existing fields ...
    foreignAccounts?: ForeignAccountBalance[];
    isinMap?: Record<string, string>;
}
```

### Revolut Savings Parser (`packages/core/src/parsers/revolut-csv.ts`)

**Extend to also return holdings data:**

- Parse BUY/SELL transactions (currently skipped)
- Extract ISIN from description (general ISIN regex: `[A-Z]{2}[A-Z0-9]{9}[0-9]`)
- Compute running balance of shares
- Determine year-start and year-end quantities from the transaction dates
- Return positions alongside existing interest data

**New return structure** — extend or add a new function:
```typescript
export interface RevolutSavingsResult {
    interest: BrokerInterest;
    holdings: {
        isin: string;
        currency: string;
        quantityStartOfYear: number;
        quantityEndOfYear: number;
    }[];
}
```

### Revolut Account Statement Parser (NEW)

**New parser:** `packages/core/src/parsers/revolut-account.ts`

Parses Revolut current account statements to extract cash balances for SPB-8 Section 03.

```typescript
export function parseRevolutAccountStatement(csv: string): ForeignAccountBalance;
```

**Detection:** Header starts with `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance`

**Logic:**
1. Filter to rows where `Product=Current` and `State=COMPLETED`
2. Start-of-year balance = first row's `Balance` - first row's `Amount`
3. End-of-year balance = last row's `Balance`
4. Currency from `Currency` column
5. Country: `LT`, Maturity: `S`, Type: `03`

**Register** as a new file handler in the Revolut provider (`revolut.ts`).

## Excel Generator

### Module: `packages/core/src/spb8/excel-generator.ts`

Generates .xlsx file replicating the BNB SPB-8 template layout.

### Layout (hardcoded, based on BNB template analysis)

- **19 columns** (A-S), Times New Roman font
- **Row 2:** "Форма СПБ-8"
- **Row 3:** Full report title
- **Row 5:** Year field (col I = "за", col N = year)
- **Row 7-8:** Report type (P/R checkboxes)
- **Rows 11-20:** Section 1 — personal data
- **Row 23:** Section 2 header
- **Row 24-25:** Column headers for accounts (type, maturity, country, currency, amounts in thousands)
- **Rows 26-28+:** Account data rows (01, 02, 03) — dynamic, insert additional rows if needed
- **Row 30-31:** Column headers for securities (type, ISIN, quantities)
- **Row 32+:** Securities data rows (04) — dynamic, one per ISIN
- **Footer (dynamic position):** Legal disclaimer, preparer details, BNB contact info

### Dynamic Row Management

The BNB template has 3 predefined rows for accounts (26=type 01, 27=type 02, 28=type 03). When multiple accounts of the same type exist (e.g., EUR and USD cash at IB, both type 03), additional rows must be inserted after the corresponding type row. The Excel generator must:
1. Replicate merged cell structure (columns N-Q for start amount, R-S for end amount) on inserted rows
2. Shift all subsequent rows down (securities section + footer)

Similarly, securities rows (type 04) start at the first available row after accounts and grow dynamically.

Footer start row = `lastSecurityDataRow + 3`

The footer shifts down based on the number of data rows. This is safe because BNB's electronic filing validates by content, not by fixed row position.

### Number Formatting

- **Section 03 amounts:** Whole numbers in thousands (e.g., 5432 USD → `5`)
- **Section 04 quantities:** Exact share count (no rounding for equities)

## UI: SPB-8 Page

### New page: `packages/ui/src/pages/Spb8.tsx`

**Layout:**
1. **Threshold banner** — shows total BGN value and whether filing is required
2. **Report type toggle** — Initial (P) / Corrective (R)
3. **Personal data form** (collapsible) — optional fields, persisted in AppState
4. **Accounts table** — editable, auto-populated from parsed IB data. User can add/remove rows for manual accounts (e.g., Revolut current account balances)
5. **Securities table** — read-only, derived from holdings + Revolut savings. Shows ISIN, symbol (reference), start/end quantities. Warning icon if ISIN missing
6. **Import previous SPB-8** button — loads .xlsx file, extracts Section 04 quantities for start-of-year
7. **Export SPB-8** button — generates .xlsx

**Navigation:** New top-level tab "СПБ-8" (or "SPB-8" in English), visible when holdings exist.

**State:** `spb8PersonalData` stored in Zustand AppState, persisted across sessions.

## Previous SPB-8 Import

### Module: `packages/core/src/spb8/import.ts`

```typescript
export function importPreviousSpb8(buffer: ArrayBuffer): {
    securities: Spb8Security[];
    personalData?: Spb8PersonalData;
};
```

- Supports **.xlsx only** for v1. Shows error with "please save as .xlsx" for .xls files.
- Parses the known row structure to extract ISIN + end-of-year quantities
- Optionally extracts personal data from Section 1

## Provider Documentation Update

Update `AGENTS.md` to document what a new provider should return for SPB-8 support:

- `foreignAccounts?: ForeignAccountBalance[]` — cash/account balances if the broker provides them
- `isinMap?: Record<string, string>` — symbol-to-ISIN mappings if available in the data
- Document the Revolut savings pattern (money market fund shares with embedded ISINs)
- Add guidance on determining broker country code for Section 03

## Testing Strategy

### Unit Tests

- `assembleSpb8()` — test grouping, threshold calculation, start-of-year reconstruction
- ISIN resolution — sync map, async fallback, validation
- IB Cash Report parsing — multi-currency, start/end extraction
- Revolut savings position computation — BUY/SELL aggregation, year boundaries
- Excel generator — cell positions, merged cells, dynamic rows, number formatting

### Integration Tests

- Full pipeline: import IB CSV + Revolut savings → assemble SPB-8 → export Excel → verify structure
- Import previous SPB-8 → use as start-of-year → export new SPB-8

### Test Fixtures

- Synthetic IB CSV with Cash Report + Financial Instrument Information sections
- Synthetic Revolut savings CSV with BUY/SELL transactions
- Sample SPB-8 .xlsx for import testing

## Known Limitations (v1)

- **Debt vs equity distinction:** All securities reported as share count. Debt securities (bonds) should use nominal value per the official spec, but this requires asset class classification not yet available. Bond ETFs are correctly reported as shares (they are equity shares in the ETF fund).
- **Threshold uses cost basis:** Market value would be more accurate but requires current price data. Marked as informational — user verifies.

## Out of Scope (v1)

- .xls file reading (import requires .xlsx)
- Automatic Revolut current account balance extraction (manual entry)
- BNB ISIS portal integration (electronic submission)
- Sections 01 (granted credits) and 02 (received credits) — rarely used by individual investors
- OpenFIGI-based ISIN resolution (hardcoded map + parser extraction covers common cases)

## File Structure

```
packages/core/src/
  types/index.ts              — add ForeignAccountBalance, Spb8Security, Spb8PersonalData, Spb8FormData
  isin-map.ts                 — ISIN_MAP + resolveIsinSync + resolveIsins
  spb8/
    assemble.ts               — assembleSpb8() pure function
    excel-generator.ts        — generateSpb8Excel()
    import.ts                 — importPreviousSpb8()
  parsers/
    ib-csv.ts                 — extend: Cash Report + Financial Instrument Info
    revolut-csv.ts            — extend: BUY/SELL position tracking for savings funds
    revolut-account.ts        — NEW: Revolut current account balance extraction
  providers/
    types.ts                  — extend BrokerProviderResult
    revolut.ts                — register new revolut-account file handler

packages/ui/src/
  pages/Spb8.tsx              — new SPB-8 page
  store/app-state.ts          — add foreignAccounts, spb8PersonalData to state
```
