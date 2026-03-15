# Bulgarian Tax Declaration App — Design Spec

## Overview

A desktop application for Bulgarian taxpayers (expats/investors) to prepare their annual tax declaration (Годишна данъчна декларация по чл. 50 от ЗДДФЛ). The app parses broker statements and savings data, calculates taxes using Bulgarian tax rules, presents editable data tables, generates a formatted Excel export, and guides users on which numbers to enter in the official NRA declaration forms.

## Target Users

Bulgarian investors/expats with:
- Interactive Brokers accounts (stocks, ETFs, dividends)
- Revolut savings accounts (interest income)
- Other broker accounts (manual entry)

Users are assumed to understand basic investment concepts (dividends, FIFO, cost basis).

## Tech Stack

- **Tauri v2** — desktop shell (macOS, Windows, Linux)
- **TypeScript** — single language for all code
- **React** — UI framework
- **Monorepo** — `packages/core` (pure TS library) + `packages/ui` (Tauri + React app)

### Why This Stack

- Tauri produces small binaries (~5-10MB), uses system webview, zero runtime dependencies on macOS/Windows
- TypeScript everywhere means one language to maintain, test, and reason about
- Monorepo with separated core library enables future reuse (web app, CLI tool) without rewriting business logic
- React has the richest ecosystem for editable data tables (TanStack Table, AG Grid)

## Bulgarian Tax Rules

The app implements Bulgarian flat tax rates per ЗДДФЛ:

- **Capital gains** (Приложение 5): **10%** flat tax on profit from sale of securities
- **Foreign dividends** (Приложение 8, Таблица 1): **5%** flat tax on gross dividend amount
- **Foreign interest income** (Приложение 8, Таблица 6): **10%** flat tax on gross interest (Revolut savings, IB stock yield)

### WHT Credit Calculation

Withholding tax paid abroad can offset Bulgarian tax due, but never below zero:

```
tax_due = max(0, bg_tax_rate × gross_amount_in_base_ccy - wht_paid_in_base_ccy)
```

For dividends (5% BG rate): if WHT ≥ 5% of gross, no additional Bulgarian tax is owed (but no refund of excess WHT). For example:
- US dividend with 10% WHT → tax_due = max(0, 5% × gross - 10% × gross) = 0
- Irish ETF dividend with 0% WHT → tax_due = 5% × gross
- Dutch dividend with 15% WHT → tax_due = max(0, 5% × gross - 15% × gross) = 0

The WHT credit is capped at the Bulgarian tax amount — excess foreign WHT is not refundable.

## Architecture

### Package Structure

```
bulgarian-tax-declaration/
├── packages/
│   ├── core/                    # Pure TypeScript library (no UI dependencies)
│   │   ├── src/
│   │   │   ├── parsers/         # File parsers
│   │   │   │   ├── ib-csv.ts        # Interactive Brokers CSV parser
│   │   │   │   └── revolut-csv.ts   # Revolut savings CSV parser
│   │   │   ├── fx/              # Exchange rates
│   │   │   │   ├── ecb-api.ts       # ECB API client
│   │   │   │   ├── fx-cache.ts      # Local cache for fetched rates
│   │   │   │   └── gap-fill.ts      # Weekend/holiday rate gap-filling
│   │   │   ├── fifo/            # FIFO lot matching
│   │   │   │   └── engine.ts        # Buy/sell/split lot matching
│   │   │   ├── validation/      # Data validation
│   │   │   │   └── validator.ts     # Consistency checks and warnings
│   │   │   ├── tax/             # Bulgarian tax rules
│   │   │   │   ├── rules.ts         # Tax rates, WHT credits, exemptions
│   │   │   │   └── calculator.ts    # Per-category tax calculation
│   │   │   ├── declaration/     # NRA form mapping
│   │   │   │   ├── form-config/     # JSON configs per tax year
│   │   │   │   │   ├── 2025.json
│   │   │   │   │   └── 2026.json
│   │   │   │   └── mapper.ts        # Maps calculated data → form fields
│   │   │   ├── excel/           # Excel export
│   │   │   │   └── generator.ts     # Full xlsx generation (exceljs)
│   │   │   ├── types/           # Shared interfaces
│   │   │   │   └── index.ts
│   │   │   └── i18n/            # Localization
│   │   │       ├── bg.ts
│   │   │       └── en.ts
│   │   └── tests/
│   └── ui/                      # Tauri + React app
│       ├── src/
│       │   ├── components/      # React components
│       │   ├── pages/           # Year setup, Import, Workspace, Declaration
│       │   ├── hooks/           # Custom React hooks
│       │   └── store/           # App state management
│       └── src-tauri/           # Tauri Rust shell (minimal)
└── docs/
```

### Data Flow

```
Upload files ──→ Parsers ──→ Raw data ──→ Merge with imported holdings
                                              │
                                              ▼
                                        FIFO engine ──→ Holdings (remaining lots)
                                              │          Sales (matched disposals)
                                              ▼
                                        Tax calculator ──→ Per-category taxes
                                              │
                                              ▼
                                        Declaration mapper ──→ Form field values
                                              │
                                              ▼
                                        Excel generator ──→ Данъчна {YEAR}.xlsx
```

### State Management

All state lives in memory during the session. Auto-saved to a JSON file on every edit (debounced ~2s) so no work is lost. Manual save/export also available.

```typescript
interface AppState {
  taxYear: number;
  baseCurrency: 'BGN' | 'EUR';
  language: 'en' | 'bg';
  holdings: Holding[];      // Cumulative, carried forward
  sales: Sale[];            // Current year
  dividends: Dividend[];    // Current year
  stockYield: StockYieldEntry[];  // Current year
  revolutInterest: RevolutInterest[];  // Current year
  fxRates: Map<string, Map<string, number>>;  // currency → date → rate
  manualEntries: ManualEntry[];  // User additions from other brokers
}
```

### Undo/Redo

All table edits (add, edit, delete row) are tracked in an undo stack. Standard keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z) supported. The undo stack is session-scoped (not persisted across app restarts). Implementation: store diffs (old value → new value) rather than full state snapshots.

## Core Data Types

```typescript
interface Holding {
  id: string;
  broker: string;           // 'IB' | 'E*Trade' | 'Elana' | custom
  country: string;          // 'САЩ' | 'Германия' | 'Ирландия' | 'Хонконг' | etc.
  symbol: string;           // 'AAPL', 'CSPX/SXR8', 'ISPAd/ISPA'
  dateAcquired: string;     // 'YYYY-MM-DD'
  quantity: number;
  currency: string;         // 'USD' | 'EUR' | 'HKD' | 'BGN'
  unitPrice: number;
  notes?: string;
}

interface Sale {
  id: string;
  broker: string;
  country: string;
  symbol: string;
  dateAcquired: string;     // From the matched holding lot
  dateSold: string;
  quantity: number;
  currency: string;
  buyPrice: number;
  sellPrice: number;
  fxRateBuy: number;        // FX rate on acquisition date
  fxRateSell: number;       // FX rate on sale date
}

interface Dividend {
  symbol: string;
  country: string;
  date: string;
  currency: string;
  grossAmount: number;      // Original currency
  withholdingTax: number;   // WHT paid at source
  bgTaxDue: number;         // max(0, 5% × gross_base_ccy - wht_base_ccy)
  whtCredit: number;        // min(wht_base_ccy, 5% × gross_base_ccy)
  notes?: string;
}

interface StockYieldEntry {
  date: string;
  symbol: string;
  currency: string;
  amount: number;
}

interface RevolutInterest {
  currency: string;         // 'EUR' | 'USD' | 'GBP'
  entries: {
    date: string;
    description: string;    // 'Interest PAID' | 'Service Fee Charged'
    amount: number;
  }[];
}
```

## Features

### 1. Year Setup

The app opens to a year setup screen:
- **Tax year selector** — defaults to previous year (current year - 1)
- **Base currency** — auto-detected: BGN for ≤2025, EUR for ≥2026. Editable.
- **Language toggle** — English / Български
- **Import previous holdings** — four options:
  - From previous year's app export (.json) — recommended, lossless
  - From previous year's app-generated `Данъчна {YEAR}.xlsx` — parses the known "Притежания" sheet format only (not arbitrary Excel files)
  - Manual entry (add individual lots via in-app table)
  - Start fresh (no prior holdings)

### 2. Data Import

Drag-and-drop area for file uploads:
- **Interactive Brokers CSV** — activity statement (`U{account}_{start}_{end}.csv`)
  - Parses: Trades, Dividends, Withholding Tax, Stock Yield Enhancement, Payment in Lieu of Dividends
  - Beware: CSV may have TWO Withholding Tax sections — must parse both
- **Revolut Savings CSVs** — one per currency/vault
  - Parses: Interest PAID, Service Fee Charged (excludes BUY/SELL/Reinvested)
  - Date format: `%b %d, %Y, %I:%M:%S %p` — strip time component
- **FX Rates** — auto-fetched from ECB API on import, no user action needed
  - ECB endpoint: `https://data-api.ecb.europa.eu/service/data/EXR/D.{CCY}.EUR.SP00.A`
  - 4 quarterly requests per currency per year (ECB 3-month limit)
  - Converts to base currency: BGN rate = ECB rate × 1.95583
  - Gap-fills weekends/holidays by carrying forward previous business day rate
  - Currencies auto-detected from imported data (USD, GBP, HKD, etc.)
  - **Caching**: fetched rates cached locally (in app data directory) so subsequent sessions don't re-fetch. Cache keyed by currency+year, invalidated on manual request.
  - **Fallback**: if ECB API is unreachable, use cached rates if available. If no cache, show warning and allow manual rate entry in the FX Rates tab. The app never blocks on missing rates — it marks affected calculations as "FX rate missing" and lets the user resolve.

### 3. Main Workspace

Tabbed interface with editable data tables:

**Holdings (Притежания)**
- All stock holdings, cumulative across years
- Columns: Broker, Country, Symbol, Date Acquired, Quantity, Currency, Unit Price, Total (ccy), FX Rate, Total (base ccy), Notes
- Sortable by date, symbol, broker
- Add/edit/delete rows manually
- FIFO lot tracking: sells matched against oldest lots first

**Sales (Продажби)**
- Stock sales for the tax year, auto-populated from IB CSV trades
- Columns: Broker, Country, Symbol, Date Acquired, Date Sold, Qty, Currency, Buy Price, Sell Price, FX Rate Buy, FX Rate Sell, Proceeds (base ccy), Cost (base ccy), P/L (base ccy)
- FIFO-matched against holdings — partial lot splits supported

**Dividends (Дивиденти)**
- Ordered by symbol, then date within symbol
- Columns: Symbol, Country, Date, Currency, Gross Dividend, WHT, BG Tax Due, WHT Credit, FX Rate, Dividend (base ccy), WHT (base ccy), Notes
- Combines same-date entries (e.g., BABA ordinary + bonus)
- Nets reversals (e.g., ASML reversal + re-entry)
- WHT matching: each WHT line matched back to dividend by symbol+date+currency (symbol+date alone is not unique — multiple dividend types can occur on the same day for the same symbol)

**Stock Yield (IB Stock Yield Enhancement)**
- Daily entries per symbol from IB's Stock Yield Enhancement Program
- Columns: Date, Symbol, Currency, Amount, FX Rate, Amount (base ccy)

**Revolut Interest**
- Summary tab showing per-currency totals + tax due (10%)
- Detail view per currency with daily Interest PAID / Service Fee entries
- Net interest = Interest PAID + Service Fee Charged (fee is negative)

**FX Rates**
- View/verify auto-fetched rates
- One sub-tab per currency (USD, GBP, HKD, etc.)
- Shows date, rate, source (ECB)
- Not a required import — populated automatically

### 4. Declaration Guide

Maps calculated totals to NRA form fields. Configurable per tax year via JSON:

**Приложение 5** — Доходи от прехвърляне на права или имущество:
- Proceeds from stock sales
- Acquisition cost
- Profit/loss
- Tax due (10%)

**Приложение 8** — Доходи от чужбина:
- Foreign dividends: gross amount, WHT paid, tax due (5%), WHT credit
- Foreign interest (Revolut, IB stock yield): gross amount, tax due (10%)

**Част IV** — Изчисляване на данъка:
- Aggregated totals from all appendices

Display format: card per form section showing the exact field reference (e.g., "Ред 1, Кол. 4") with the calculated value, so users can directly transcribe to the NRA online form.

### 5. Excel Export

Single button generates the complete `Данъчна {YEAR}.xlsx` matching the established format:

**Sheets generated:**
- FX rate sheets (USD, GBP, HKD) — date + rate columns
- Yearly USD — historical rates
- Притежания — all holdings with formulas (SWITCH for currency, VLOOKUP for FX, ROUND for BGN)
- Продажби — sales with FIFO lot matching
- Дивиденти — dividends ordered by symbol then date
- IB Stock Yield — daily entries
- Revolut Лихва — summary per currency with references to detail sheets
- Revolut EUR/USD/GBP {YEAR} — daily interest detail

**Excel format requirements:**
- Font: Aptos Narrow, size 12
- Number formats: dates `yyyy-mm-dd`, BGN amounts `#,##0.00 "BGN"`, currency amounts `#,##0.00`
- Formulas preserved (VLOOKUP for FX rates, SWITCH for currency mapping, ROUND for totals)
- Use ArrayFormula for SWITCH formulas (exceljs requirement for _xlfn prefix)
- Do NOT use ArrayFormula for simple VLOOKUP (causes Excel "content problem" errors)

## IB CSV Parser Details

The IB CSV is section-based. Key sections and their parsing:

**Trades**: `Trades,Data,Order,Stocks,{currency},{symbol},{datetime},{qty},{price},...`
- Positive quantity = buy → add to holdings
- Negative quantity = sell → FIFO match against holdings, create sale record

**Dividends**: `Dividends,Data,{currency},{date},{description},{amount}`
- Description contains symbol and dividend details
- Combine same-date entries for same symbol

**Withholding Tax**: `Withholding Tax,Data,{currency},{date},{description},{amount}`
- **Critical**: CSV may have TWO WHT sections — must parse both!
- First section may have only EUR WHT + prior year adjustments
- Main USD WHT in second section
- Match each WHT to its dividend by symbol + date + currency
- Combine same-date dividend entries before WHT matching (e.g., BABA ordinary + bonus → single entry)

**Stock Yield Enhancement**: `Stock Yield Enhancement Program Securities Lent Interest Details,Data,...`
- Daily interest entries per symbol

**Payment in Lieu of Dividends**: separate section, treated as dividends

**Section boundaries**: stop parsing at `Total` line or next section header.

## FIFO Engine

The FIFO engine maintains a queue of lots per symbol.

**Pre-processing**: before FIFO matching, all trades are sorted by datetime (not just date). IB CSV may list sells before buys that occurred on the same day — sorting by execution time ensures buys are processed first when they happened first.

```
Sort all trades by (date, time) ascending

On BUY(symbol, date, qty, price):
  → Append new lot to symbol's queue

On SELL(symbol, date, qty, price):
  → While qty > 0:
    → Take oldest lot from queue
    → If lot.qty <= qty:
      → Create sale record (full lot consumed)
      → qty -= lot.qty
      → Remove lot from queue
    → Else:
      → Create sale record (partial: qty shares at lot.price)
      → lot.qty -= qty
      → qty = 0 (lot remains in queue with reduced qty)
```

## Base Currency Transition (BGN → EUR)

For tax year ≤2025: base currency is BGN, EUR/BGN fixed at 1.95583.
For tax year ≥2026: base currency is EUR, no BGN conversion needed.

Implementation:
- Base currency stored in app state, configurable per year
- All "convert to base currency" operations use a single function that checks base currency
- FX rates from ECB are EUR-native; for BGN multiply by 1.95583, for EUR use directly
- Excel export column headers change: "Общо BGN" → "Общо EUR"
- Declaration form field mapping changes per year (via JSON config)

## Localization

Two languages: English (default) and Bulgarian.

- UI text: EN/BG toggle, all labels and messages localized
- Excel export: always Bulgarian (column names, sheet names, comments) — matches official declaration format
- Declaration guide: always Bulgarian (form field names are in Bulgarian)

String tables in `packages/core/src/i18n/` — flat key-value maps, no heavy i18n framework needed.

## Validation

The validation layer runs after every data change and surfaces warnings (non-blocking) in the UI:

- **Negative holdings** — sell quantity exceeds available lots for a symbol (FIFO mismatch)
- **Unmatched WHT** — withholding tax entry with no corresponding dividend
- **Missing FX rates** — calculations that need an FX rate but don't have one
- **Duplicate entries** — same trade/dividend appearing twice (e.g., overlapping CSV imports)
- **Year mismatch** — transactions outside the selected tax year

Warnings appear as a notification badge on affected tabs. Each warning links to the specific row. Warnings do not block export — the user can choose to proceed with unresolved issues.

## Persistence

- **Auto-save**: state auto-saved to JSON file on every edit (debounced ~2s) in the app data directory
- **Manual save/load**: explicit save to user-chosen location, load from any saved JSON
- **App export**: same JSON format, used as import for next year's session
- **Excel export**: complete formatted xlsx
- **FX rate cache**: fetched ECB rates cached locally by currency+year
- **No database**: everything is file-based

## Country and Symbol Mapping

ETF symbol notation uses slash for dual-listed: `CSPX/SXR8`, `GLDV/ZPRG`, `ISPAd/ISPA`

Country mapping for tax purposes:
- Irish-domiciled ETFs (CSPX, GLDV, VHYL, JGPI, VWCE) → "Ирландия"
- German-traded ETFs (ISPAd, LHA, SAP, TMV, TKWY) → "Германия"
- US stocks → "САЩ"
- HK stocks (1810/BABA HK) → "Хонконг"
- Dutch stocks (ASML) → "Нидерландия (Холандия)"
- UK stocks (RIO) → "Великобритания"

WHT rates by country:
- US: 10% (standard treaty rate)
- Ireland: 0% (ETF dividends)
- Hong Kong: 0%
- Netherlands: 15%
- Exceptions: ET (~47%), BABA (0%), RIO (0%)

## Future Expansion (Out of Scope for v1)

- **Corporate actions** (stock splits, mergers, spinoffs, return of capital) — for v1, users handle these via manual lot adjustments in the Holdings tab
- Additional broker parsers (Trading 212, eToro, Elana)
- Crypto exchanges
- Employment income
- Rental income
- Direct NRA XML submission
- Multi-user support
- Auto-update mechanism
