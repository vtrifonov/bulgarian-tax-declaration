# Bulgarian Tax Declaration App — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri v2 desktop app that parses IB/Revolut statements, calculates Bulgarian taxes (FIFO, WHT credits), and exports a formatted Excel declaration.

**Architecture:** Monorepo with `packages/core` (pure TS library — parsers, FIFO, tax, Excel) and `packages/ui` (Tauri v2 + React). Core has zero UI dependencies so it can be reused in CLI/web contexts later. All state in-memory with JSON auto-save.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Tauri v2, React, TanStack Table, exceljs

---

## File Structure

```
bulgarian-tax-declaration/
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json                    # shared TS config
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts                  # public API barrel
│   │   │   ├── types/
│   │   │   │   └── index.ts              # Holding, Sale, Dividend, etc.
│   │   │   ├── parsers/
│   │   │   │   ├── ib-csv.ts             # IB activity statement parser
│   │   │   │   ├── ib-csv-types.ts       # Raw IB parsed types
│   │   │   │   ├── revolut-csv.ts        # Revolut savings CSV parser
│   │   │   │   ├── wht-matcher.ts        # Matches WHT entries to dividends
│   │   │   │   └── excel-import.ts       # Imports holdings from prior-year app-generated xlsx
│   │   │   ├── fx/
│   │   │   │   ├── ecb-api.ts            # ECB Data API client
│   │   │   │   ├── fx-service.ts         # Orchestrates fetch + cache + gap-fill
│   │   │   │   ├── fx-cache.ts           # File-based JSON cache
│   │   │   │   └── gap-fill.ts           # Weekend/holiday carry-forward
│   │   │   ├── fifo/
│   │   │   │   └── engine.ts             # FIFO lot matching (buy/sell/split)
│   │   │   ├── tax/
│   │   │   │   ├── rules.ts              # BG tax rates + WHT credit formula
│   │   │   │   └── calculator.ts         # Per-category tax calculation
│   │   │   ├── validation/
│   │   │   │   └── validator.ts          # Warnings: negative holdings, unmatched WHT, etc.
│   │   │   ├── declaration/
│   │   │   │   ├── form-config/
│   │   │   │   │   ├── 2025.json         # NRA form field mapping for 2025
│   │   │   │   │   └── 2026.json         # NRA form field mapping for 2026 (EUR)
│   │   │   │   └── mapper.ts             # Calculated data → form fields
│   │   │   ├── excel/
│   │   │   │   ├── generator.ts          # Main xlsx generation orchestrator
│   │   │   │   ├── sheets/
│   │   │   │   │   ├── fx-sheet.ts       # FX rate sheets (USD, GBP, HKD)
│   │   │   │   │   ├── holdings-sheet.ts # Притежания sheet
│   │   │   │   │   ├── sales-sheet.ts    # Продажби sheet
│   │   │   │   │   ├── dividends-sheet.ts# Дивиденти sheet
│   │   │   │   │   ├── stock-yield-sheet.ts # IB Stock Yield sheet
│   │   │   │   │   └── revolut-sheet.ts  # Revolut Лихва + detail sheets
│   │   │   │   └── styles.ts             # Shared Excel styles (Aptos Narrow 12, formats)
│   │   │   ├── i18n/
│   │   │   │   ├── index.ts              # t() function, setLanguage()
│   │   │   │   ├── bg.ts                 # Bulgarian strings
│   │   │   │   └── en.ts                 # English strings
│   │   │   └── country-map.ts            # Symbol → country mapping
│   │   └── tests/
│   │       ├── fixtures/
│   │       │   ├── ib-minimal.csv        # Minimal IB CSV with all sections
│   │       │   ├── revolut-eur.csv       # EUR savings (5 cols)
│   │       │   └── revolut-usd.csv       # USD savings (7 cols)
│   │       ├── parsers/
│   │       │   ├── ib-csv.test.ts
│   │       │   ├── revolut-csv.test.ts
│   │       │   ├── wht-matcher.test.ts
│   │       │   └── excel-import.test.ts
│   │       ├── fx/
│   │       │   ├── ecb-api.test.ts
│   │       │   └── gap-fill.test.ts
│   │       ├── fifo/
│   │       │   └── engine.test.ts
│   │       ├── tax/
│   │       │   ├── rules.test.ts
│   │       │   └── calculator.test.ts
│   │       ├── validation/
│   │       │   └── validator.test.ts
│   │       ├── declaration/
│   │       │   └── mapper.test.ts
│   │       └── excel/
│   │           └── generator.test.ts
│   └── ui/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx                  # React entry
│       │   ├── App.tsx                   # Router + layout
│       │   ├── store/
│       │   │   ├── app-state.ts          # Zustand store
│       │   │   └── undo.ts              # Undo/redo middleware
│       │   ├── pages/
│       │   │   ├── YearSetup.tsx         # Year, currency, language, import
│       │   │   ├── Import.tsx            # File upload (drag & drop)
│       │   │   ├── Workspace.tsx         # Tabbed data tables
│       │   │   └── Declaration.tsx       # NRA form guide
│       │   ├── components/
│       │   │   ├── DataTable.tsx         # Reusable editable table (TanStack)
│       │   │   ├── FileDropZone.tsx      # Drag & drop file area
│       │   │   ├── TabBar.tsx            # Workspace tab navigation
│       │   │   ├── ValidationBadge.tsx   # Warning badge on tabs
│       │   │   └── DeclarationCard.tsx   # Form field reference card
│       │   ├── hooks/
│       │   │   ├── useAutoSave.ts        # Debounced auto-save
│       │   │   └── useFxRates.ts         # FX rate fetching
│       │   └── styles/
│       │       └── globals.css
│       └── src-tauri/
│           ├── Cargo.toml
│           ├── tauri.conf.json
│           └── src/
│               └── main.rs               # Minimal Tauri entry
└── docs/
```

---

## Chunk 1: Project Scaffolding + Core Types

### Task 1: Initialize monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "bulgarian-tax-declaration",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "test:core": "pnpm --filter @bg-tax/core test",
    "build": "pnpm -r build",
    "dev": "pnpm --filter @bg-tax/ui dev"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@bg-tax/core": ["packages/core/src/index.ts"],
      "@bg-tax/core/*": ["packages/core/src/*"]
    }
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
target/
.DS_Store
*.tsbuildinfo
```

- [ ] **Step 5: Create .npmrc**

```
shamefully-hoist=true
```

- [ ] **Step 6: Run `pnpm init` is not needed (we wrote package.json). Install pnpm lockfile:**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration && pnpm install`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: initialize pnpm monorepo"
```

---

### Task 2: Scaffold packages/core

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Create packages/core/package.json**

```json
{
  "name": "@bg-tax/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "exceljs": "^4.4.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Note: `crypto.randomUUID()` is available natively in Node 20+, no uuid package needed.

- [ ] **Step 2: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/core/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create packages/core/src/index.ts**

```typescript
export * from './types/index.js';
```

- [ ] **Step 5: Install deps**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration && pnpm install`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold packages/core with vitest"
```

---

### Task 3: Define core data types

**Files:**
- Create: `packages/core/src/types/index.ts`
- Test: `packages/core/tests/types.test.ts`

- [ ] **Step 1: Write types test**

```typescript
import { describe, it, expect } from 'vitest';
import type { Holding, Sale, Dividend, StockYieldEntry, RevolutInterest, AppState } from '../../src/types/index.js';

describe('Core types', () => {
  it('creates a valid Holding', () => {
    const h: Holding = {
      id: '1',
      broker: 'IB',
      country: 'САЩ',
      symbol: 'AAPL',
      dateAcquired: '2025-01-21',
      quantity: 50,
      currency: 'USD',
      unitPrice: 250.42,
    };
    expect(h.symbol).toBe('AAPL');
    expect(h.quantity).toBeGreaterThan(0);
  });

  it('creates a valid Sale', () => {
    const s: Sale = {
      id: '1',
      broker: 'IB',
      country: 'САЩ',
      symbol: 'AAPL',
      dateAcquired: '2024-03-15',
      dateSold: '2025-06-20',
      quantity: 10,
      currency: 'USD',
      buyPrice: 170.00,
      sellPrice: 250.00,
      fxRateBuy: 1.78,
      fxRateSell: 1.85,
    };
    expect(s.dateSold > s.dateAcquired).toBe(true);
  });

  it('creates a valid Dividend with WHT credit', () => {
    const d: Dividend = {
      symbol: 'MSFT',
      country: 'САЩ',
      date: '2025-03-13',
      currency: 'USD',
      grossAmount: 166.00,
      withholdingTax: 16.60,
      bgTaxDue: 0,        // 5% of gross < 10% WHT
      whtCredit: 8.30,    // min(16.60, 5% × gross)
    };
    expect(d.bgTaxDue).toBe(0);
  });

  it('creates a valid RevolutInterest', () => {
    const r: RevolutInterest = {
      currency: 'EUR',
      entries: [
        { date: '2025-01-01', description: 'Interest PAID', amount: 0.2973 },
        { date: '2025-01-01', description: 'Service Fee Charged', amount: -0.1273 },
      ],
    };
    const net = r.entries.reduce((sum, e) => sum + e.amount, 0);
    expect(net).toBeCloseTo(0.17);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration && pnpm --filter @bg-tax/core test`
Expected: FAIL — types don't exist yet

- [ ] **Step 3: Write the types**

```typescript
// packages/core/src/types/index.ts

export interface Holding {
  id: string;
  broker: string;
  country: string;
  symbol: string;
  dateAcquired: string;  // YYYY-MM-DD
  quantity: number;
  currency: string;
  unitPrice: number;
  notes?: string;
}

export interface Sale {
  id: string;
  broker: string;
  country: string;
  symbol: string;
  dateAcquired: string;
  dateSold: string;
  quantity: number;
  currency: string;
  buyPrice: number;
  sellPrice: number;
  fxRateBuy: number;
  fxRateSell: number;
}

export interface Dividend {
  symbol: string;
  country: string;
  date: string;
  currency: string;
  grossAmount: number;
  withholdingTax: number;
  bgTaxDue: number;
  whtCredit: number;
  notes?: string;
}

export interface StockYieldEntry {
  date: string;
  symbol: string;
  currency: string;
  amount: number;
}

export interface RevolutInterestEntry {
  date: string;
  description: string;
  amount: number;
}

export interface RevolutInterest {
  currency: string;
  entries: RevolutInterestEntry[];
}

export interface ManualEntry {
  id: string;
  type: 'holding' | 'sale' | 'dividend';
  data: Holding | Sale | Dividend;
}

export type BaseCurrency = 'BGN' | 'EUR';
export type Language = 'en' | 'bg';

export interface AppState {
  taxYear: number;
  baseCurrency: BaseCurrency;
  language: Language;
  holdings: Holding[];
  sales: Sale[];
  dividends: Dividend[];
  stockYield: StockYieldEntry[];
  revolutInterest: RevolutInterest[];
  fxRates: Record<string, Record<string, number>>;  // currency → date → rate
  manualEntries: ManualEntry[];
}

/** Validation warning — non-blocking */
export interface ValidationWarning {
  type: 'negative-holdings' | 'unmatched-wht' | 'missing-fx' | 'duplicate' | 'year-mismatch';
  message: string;
  tab: string;
  rowId?: string;
}

/** IB CSV raw parsed data before FIFO processing */
export interface IBParsedData {
  trades: IBTrade[];
  dividends: IBDividend[];
  withholdingTax: IBWithholdingTax[];
  stockYield: StockYieldEntry[];
}

export interface IBTrade {
  currency: string;
  symbol: string;
  dateTime: string;  // YYYY-MM-DD, HH:MM:SS
  quantity: number;  // positive=buy, negative=sell
  price: number;
  proceeds: number;
  commission: number;
}

export interface IBDividend {
  currency: string;
  date: string;
  symbol: string;
  description: string;
  amount: number;
}

export interface IBWithholdingTax {
  currency: string;
  date: string;
  symbol: string;
  description: string;
  amount: number;  // negative = tax paid
}

/** Parse error — non-fatal, collected alongside parsed data */
export interface ParseError {
  line: number;
  message: string;
  severity: 'warning' | 'error';
}

/** Parser result — always returns data + errors (never throws) */
export interface ParseResult<T> {
  data: T;
  errors: ParseError[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration && pnpm --filter @bg-tax/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: define core data types (Holding, Sale, Dividend, etc.)"
```

---

## Chunk 2: Parsers

### Task 4: Create test fixtures

**Files:**
- Create: `packages/core/tests/fixtures/ib-minimal.csv`
- Create: `packages/core/tests/fixtures/revolut-eur.csv`
- Create: `packages/core/tests/fixtures/revolut-usd.csv`

- [ ] **Step 1: Create minimal IB CSV fixture**

Create `packages/core/tests/fixtures/ib-minimal.csv` with representative rows from each section: Statement header, a few Trades (buy only + one sell for testing), Dividends (including BABA same-day combo, ASML reversal), TWO Withholding Tax sections (EUR then USD, including prior-year adjustments), and Stock Yield Enhancement Interest Details. Use realistic data derived from the real IB CSV structure:

```csv
Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers Ireland Limited
Statement,Data,Title,Activity Statement
Statement,Data,Period,"January 1, 2025 - December 31, 2025"
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,EUR,CSPX,"2025-01-21, 10:26:07",1,614.28,614.38,-614.28,-1.25,615.53,0,0.1,O
Trades,Data,Order,Stocks,USD,AAPL,"2025-03-10, 14:30:00",10,170.50,171.00,-1705.00,-1.00,1706.00,0,5.00,O
Trades,Data,Order,Stocks,USD,AAPL,"2025-09-15, 10:00:00",-5,250.00,250.00,1250.00,-1.00,-852.50,396.50,0,O
Trades,SubTotal,,Stocks,EUR,CSPX,,1,,,-614.28,-1.25,615.53,0,0.1,
Trades,Total,,Stocks,EUR,,,,,,-614.28,-1.25,615.53,0,0.1,
Trades,Total,,Stocks,USD,,,,,,-455.00,-2.00,853.50,396.50,5.00,
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,EUR,2025-02-19,ASML(NL0010273215) Cash Dividend EUR 1.52 per Share (Ordinary Dividend),10.64
Dividends,Data,EUR,2025-02-19,ASML(NL0010273215) Cash Dividend EUR 1.52 per Share - Reversal (Ordinary Dividend),-10.64
Dividends,Data,EUR,2025-02-19,ASML(NL0010273215) Cash Dividend EUR 1.52 per Share (Ordinary Dividend),10.64
Dividends,Data,Total,,,10.64
Dividends,Data,USD,2025-02-13,AAPL(US0378331005) Cash Dividend USD 0.25 per Share (Ordinary Dividend),12.50
Dividends,Data,USD,2025-07-10,BABA(US01609W1027) Cash Dividend USD 1.05 per Share (Ordinary Dividend),10.50
Dividends,Data,USD,2025-07-10,BABA(US01609W1027) Cash Dividend USD 0.95 per Share (Bonus Dividend),9.50
Dividends,Data,USD,2025-03-13,MSFT(US5949181045) Cash Dividend USD 0.83 per Share (Ordinary Dividend),166.00
Dividends,Data,Total,,,198.50
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,EUR,2025-02-19,ASML(NL0010273215) Cash Dividend EUR 1.52 per Share - NL Tax,-1.60,
Withholding Tax,Data,Total,,,-1.60,
Withholding Tax,Data,USD,2024-12-04,VCLT(US92206C8139) Cash Dividend USD 0.3267 per Share - US Tax,1.05,
Withholding Tax,Data,USD,2024-12-04,VCLT(US92206C8139) Cash Dividend USD 0.3267 per Share - US Tax,-0.10,
Withholding Tax,Data,USD,2025-02-13,AAPL(US0378331005) Cash Dividend USD 0.25 per Share - US Tax,-1.25,
Withholding Tax,Data,USD,2025-03-13,MSFT(US5949181045) Cash Dividend USD 0.83 per Share - US Tax,-16.60,
Withholding Tax,Data,Total,,,-16.90,
Stock Yield Enhancement Program Securities Lent Interest Details,Header,Currency,Value Date,Symbol,Start Date,Quantity,Collateral Amount,Market-based Rate (%),Interest Rate on Customer Collateral (%),Interest Paid to Customer,Code
Stock Yield Enhancement Program Securities Lent Interest Details,Data,EUR,2025-01-02,ISPAd,2025-01-02,-42,1300.95,1.62,0.81,0.03,Po
Stock Yield Enhancement Program Securities Lent Interest Details,Data,EUR,2025-01-03,ISPAd,2025-01-03,-42,1300.95,1.62,0.81,0.03,Po
Stock Yield Enhancement Program Securities Lent Interest Details,Data,Total,,,,,,,,0.06,
```

- [ ] **Step 2: Create Revolut EUR fixture (5 columns)**

Create `packages/core/tests/fixtures/revolut-eur.csv`:

```csv
Date,Description,"Value, EUR",Price per share,Quantity of shares
"Jan 3, 2025, 2:46:51 AM",Service Fee Charged EUR Class IE000AZVL3K0,-0.1273,,
"Jan 3, 2025, 2:46:51 AM",Interest PAID EUR Class R IE000AZVL3K0,0.2973,,
"Jan 2, 2025, 2:39:57 AM",BUY EUR Class R IE000AZVL3K0,-100.00,1.0000,100.00
"Jan 2, 2025, 2:39:57 AM",Interest PAID EUR Class R IE000AZVL3K0,0.2973,,
"Jan 1, 2025, 2:46:51 AM",Service Fee Charged EUR Class IE000AZVL3K0,-0.1273,,
"Jan 1, 2025, 2:46:51 AM",Interest PAID EUR Class R IE000AZVL3K0,0.2973,,
"Jan 1, 2025, 2:46:51 AM",Interest Reinvested EUR Class R IE000AZVL3K0,0.5000,,
```

- [ ] **Step 3: Create Revolut USD fixture (7 columns)**

Create `packages/core/tests/fixtures/revolut-usd.csv`:

```csv
Date,Description,"Value, USD","Value, EUR",FX Rate,Price per share,Quantity of shares
"Jan 3, 2025, 2:42:40 AM",Service Fee Charged USD Class IE000H9J0QX4,-0.0566,-0.0482,0.8518,,
"Jan 3, 2025, 2:42:40 AM",Interest PAID USD Class R IE000H9J0QX4,0.1466,0.1249,0.8518,,
"Jan 2, 2025, 2:33:08 AM",BUY USD Class R IE000H9J0QX4,-50.00,-42.59,0.8518,,50.00
"Jan 2, 2025, 2:33:08 AM",Interest PAID USD Class R IE000H9J0QX4,0.1566,0.1333,0.8514,,
"Jan 1, 2025, 2:42:40 AM",Service Fee Charged USD Class IE000H9J0QX4,-0.0566,-0.0482,0.8518,,
"Jan 1, 2025, 2:42:40 AM",Interest PAID USD Class R IE000H9J0QX4,0.1466,0.1249,0.8518,,
```

- [ ] **Step 4: Commit fixtures**

```bash
git add -A && git commit -m "test: add IB and Revolut CSV test fixtures"
```

---

### Task 5: IB CSV parser

**Files:**
- Create: `packages/core/src/parsers/ib-csv.ts`
- Test: `packages/core/tests/parsers/ib-csv.test.ts`

- [ ] **Step 1: Write IB parser tests**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIBCsv } from '../../src/parsers/ib-csv.js';

const fixture = readFileSync(join(__dirname, '../fixtures/ib-minimal.csv'), 'utf-8');

describe('parseIBCsv', () => {
  const result = parseIBCsv(fixture);

  it('parses trades', () => {
    expect(result.trades).toHaveLength(3); // 1 EUR buy + 1 USD buy + 1 USD sell
    const buy = result.trades.find(t => t.symbol === 'CSPX');
    expect(buy).toBeDefined();
    expect(buy!.quantity).toBe(1);
    expect(buy!.price).toBe(614.28);
    expect(buy!.currency).toBe('EUR');
  });

  it('distinguishes buys from sells', () => {
    const sell = result.trades.find(t => t.quantity < 0);
    expect(sell).toBeDefined();
    expect(sell!.symbol).toBe('AAPL');
    expect(sell!.quantity).toBe(-5);
  });

  it('parses dividends and combines same-date BABA entries', () => {
    const baba = result.dividends.filter(d => d.symbol === 'BABA');
    // BABA has ordinary + bonus on same date — should be combined into one entry
    expect(baba).toHaveLength(1);
    expect(baba[0].amount).toBeCloseTo(20.00); // 10.50 + 9.50
  });

  it('nets ASML reversal', () => {
    const asml = result.dividends.filter(d => d.symbol === 'ASML');
    expect(asml).toHaveLength(1);
    expect(asml[0].amount).toBeCloseTo(10.64); // 10.64 - 10.64 + 10.64
  });

  it('parses BOTH withholding tax sections', () => {
    // EUR section has ASML, USD section has AAPL + MSFT + prior-year VCLT adjustments
    const eurWht = result.withholdingTax.filter(w => w.currency === 'EUR');
    const usdWht = result.withholdingTax.filter(w => w.currency === 'USD');
    expect(eurWht.length).toBeGreaterThan(0);
    expect(usdWht.length).toBeGreaterThan(0);
  });

  it('includes prior-year WHT adjustments', () => {
    const priorYear = result.withholdingTax.filter(w => w.date.startsWith('2024'));
    expect(priorYear.length).toBeGreaterThan(0);
  });

  it('parses stock yield entries', () => {
    expect(result.stockYield.length).toBeGreaterThan(0);
    expect(result.stockYield[0].symbol).toBe('ISPAd');
  });

  it('extracts symbol from dividend description', () => {
    const msft = result.dividends.find(d => d.symbol === 'MSFT');
    expect(msft).toBeDefined();
    expect(msft!.amount).toBe(166.00);
  });

  it('stops parsing section at Total line', () => {
    // Should not include Total rows as data
    const totalTrades = result.trades.filter(t => t.symbol === '');
    expect(totalTrades).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @bg-tax/core test -- tests/parsers/ib-csv.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement IB CSV parser**

Create `packages/core/src/parsers/ib-csv.ts`. Key implementation details:
- Split CSV by lines, parse each line respecting quoted fields (commas inside quotes)
- Track current section by first field (`Trades`, `Dividends`, `Withholding Tax`, `Stock Yield...`)
- Skip `Header`, `SubTotal`, `Total` rows
- For Trades: extract currency (field 4), symbol (5), dateTime (6), quantity (7), price (8)
- For Dividends: extract symbol from description using regex `^(\w+)\(`
- Combine dividends by symbol+date+currency (sum amounts)
- For WHT: extract symbol from description, keep all entries (including prior-year)
- For Stock Yield: extract from `Interest Paid to Customer` column
- Critical: do NOT stop collecting a section type when a Total is seen — another block of the same type may follow (the TWO WHT sections issue)

```typescript
import type { IBParsedData, IBTrade, IBDividend, IBWithholdingTax, StockYieldEntry } from '../types/index.js';

export function parseIBCsv(csv: string): IBParsedData {
  const lines = parseCsvLines(csv);
  const trades: IBTrade[] = [];
  const rawDividends: IBDividend[] = [];
  const withholdingTax: IBWithholdingTax[] = [];
  const stockYield: StockYieldEntry[] = [];

  for (const fields of lines) {
    const section = fields[0];
    const rowType = fields[1]; // Header, Data, SubTotal, Total

    if (rowType !== 'Data') continue;

    if (section === 'Trades' && fields[2] === 'Order' && fields[3] === 'Stocks') {
      trades.push(parseTrade(fields));
    } else if (section === 'Dividends' && fields[2] !== 'Total' && !fields[2].startsWith('Total')) {
      // This also captures "Payment in Lieu of Dividend" entries — they appear
      // in the Dividends section with description like "VCLT(...) Payment in Lieu of Dividend"
      // and are treated identically to regular dividends for tax purposes (5% rate + WHT credit)
      const div = parseDividendLine(fields);
      if (div) rawDividends.push(div);
    } else if (section === 'Withholding Tax' && fields[2] !== 'Total' && !fields[2].startsWith('Total')) {
      const wht = parseWhtLine(fields);
      if (wht) withholdingTax.push(wht);
    } else if (section.startsWith('Stock Yield Enhancement Program Securities Lent Interest Details') && fields[2] !== 'Total') {
      const sy = parseStockYieldLine(fields);
      if (sy) stockYield.push(sy);
    }
  }

  const dividends = combineDividends(rawDividends);
  return { trades, dividends, withholdingTax, stockYield };
}

function parseCsvLines(csv: string): string[][] {
  return csv.split('\n')
    .filter(line => line.trim())
    .map(line => parseCSVRow(line));
}

function parseCSVRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function extractSymbol(description: string): string {
  // "AAPL(US0378331005) Cash Dividend..." → "AAPL"
  // "SBUX (US8552441094) Cash Dividend..." → "SBUX" (note space before paren)
  const match = description.match(/^(\S+?)[\s(]/);
  return match ? match[1] : description.split('(')[0].trim();
}

function parseTrade(fields: string[]): IBTrade {
  return {
    currency: fields[4],
    symbol: fields[5],
    dateTime: fields[6],
    quantity: parseFloat(fields[7].replace(/,/g, '')),
    price: parseFloat(fields[8]),
    proceeds: parseFloat(fields[10]),
    commission: parseFloat(fields[11]),
  };
}

function parseDividendLine(fields: string[]): IBDividend | null {
  const currency = fields[2];
  const date = fields[3];
  const description = fields[4];
  const amount = parseFloat(fields[5]);
  if (isNaN(amount)) return null;
  return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseWhtLine(fields: string[]): IBWithholdingTax | null {
  const currency = fields[2];
  const date = fields[3];
  const description = fields[4];
  const amount = parseFloat(fields[5]);
  if (isNaN(amount)) return null;
  return { currency, date, symbol: extractSymbol(description), description, amount };
}

function parseStockYieldLine(fields: string[]): StockYieldEntry | null {
  const currency = fields[2];
  const date = fields[3];
  const symbol = fields[4];
  const amount = parseFloat(fields[10]);
  if (isNaN(amount)) return null;
  return { date, symbol, currency, amount };
}

/** Combine dividends by symbol+date+currency (sum amounts) */
function combineDividends(raw: IBDividend[]): IBDividend[] {
  const map = new Map<string, IBDividend>();
  for (const d of raw) {
    const key = `${d.symbol}|${d.date}|${d.currency}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount += d.amount;
    } else {
      map.set(key, { ...d });
    }
  }
  return [...map.values()].filter(d => Math.abs(d.amount) > 0.001);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bg-tax/core test -- tests/parsers/ib-csv.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: IB CSV parser with multi-WHT-section support"
```

---

### Task 6: Revolut CSV parser

**Files:**
- Create: `packages/core/src/parsers/revolut-csv.ts`
- Test: `packages/core/tests/parsers/revolut-csv.test.ts`

- [ ] **Step 1: Write Revolut parser tests**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRevolutCsv } from '../../src/parsers/revolut-csv.js';

const eurFixture = readFileSync(join(__dirname, '../fixtures/revolut-eur.csv'), 'utf-8');
const usdFixture = readFileSync(join(__dirname, '../fixtures/revolut-usd.csv'), 'utf-8');

describe('parseRevolutCsv', () => {
  it('parses EUR savings (5-column format)', () => {
    const result = parseRevolutCsv(eurFixture);
    expect(result.currency).toBe('EUR');
    // Should only have Interest PAID and Service Fee Charged — no BUY, no Reinvested
    const descriptions = result.entries.map(e => e.description);
    expect(descriptions.every(d => d === 'Interest PAID' || d === 'Service Fee Charged')).toBe(true);
  });

  it('excludes BUY/SELL/Reinvested rows', () => {
    const result = parseRevolutCsv(eurFixture);
    const buyRows = result.entries.filter(e => e.description.includes('BUY'));
    expect(buyRows).toHaveLength(0);
    const reinvested = result.entries.filter(e => e.description.includes('Reinvested'));
    expect(reinvested).toHaveLength(0);
  });

  it('parses USD savings (7-column format)', () => {
    const result = parseRevolutCsv(usdFixture);
    expect(result.currency).toBe('USD');
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('strips time from dates', () => {
    const result = parseRevolutCsv(eurFixture);
    for (const entry of result.entries) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('parses amounts correctly', () => {
    const result = parseRevolutCsv(eurFixture);
    const interest = result.entries.find(e => e.description === 'Interest PAID');
    expect(interest).toBeDefined();
    expect(interest!.amount).toBeCloseTo(0.2973);
    const fee = result.entries.find(e => e.description === 'Service Fee Charged');
    expect(fee!.amount).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @bg-tax/core test -- tests/parsers/revolut-csv.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Revolut parser**

```typescript
import type { RevolutInterest } from '../types/index.js';

export function parseRevolutCsv(csv: string): RevolutInterest {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('Empty CSV');

  const header = lines[0];
  const currency = detectCurrency(header);
  const valueColIndex = getValueColumnIndex(header, currency);

  const entries: RevolutInterest['entries'] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    const description = fields[1]?.trim() ?? '';

    // Only keep Interest PAID and Service Fee Charged
    const descType = classifyDescription(description);
    if (!descType) continue;

    const date = parseRevolutDate(fields[0]);
    const amount = parseFloat(fields[valueColIndex]);
    if (isNaN(amount)) continue;

    entries.push({ date, description: descType, amount });
  }

  return { currency, entries };
}

function detectCurrency(header: string): string {
  // "Value, EUR" or "Value, USD" or "Value, GBP"
  const match = header.match(/Value, (\w{3})/);
  if (!match) throw new Error('Cannot detect currency from header: ' + header);
  return match[1];
}

function getValueColumnIndex(header: string, currency: string): number {
  const fields = parseCSVRow(header);
  // Find the column "Value, {currency}"
  return fields.findIndex(f => f.includes(`Value, ${currency}`));
}

function classifyDescription(desc: string): string | null {
  if (desc.startsWith('Interest PAID')) return 'Interest PAID';
  if (desc.startsWith('Service Fee Charged')) return 'Service Fee Charged';
  return null; // Skip BUY, SELL, Reinvested, etc.
}

function parseRevolutDate(raw: string): string {
  // "Jan 3, 2025, 2:46:51 AM" → "2025-01-03"
  // Remove time part: everything after the year
  const cleaned = raw.replace(/"/g, '').trim();
  const match = cleaned.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!match) throw new Error('Cannot parse date: ' + raw);
  const [, monthStr, day, year] = match;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const month = months[monthStr];
  if (!month) throw new Error('Unknown month: ' + monthStr);
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function parseCSVRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bg-tax/core test -- tests/parsers/revolut-csv.test.ts`
Expected: PASS

- [ ] **Step 5: Update barrel export**

Add to `packages/core/src/index.ts`:
```typescript
export { parseIBCsv } from './parsers/ib-csv.js';
export { parseRevolutCsv } from './parsers/revolut-csv.js';
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Revolut CSV parser (EUR 5-col, USD/GBP 7-col)"
```

---

### Task 6b: WHT-to-Dividend matcher

**Files:**
- Create: `packages/core/src/parsers/wht-matcher.ts`
- Test: `packages/core/tests/parsers/wht-matcher.test.ts`

This is the critical step that merges the separate `IBDividend[]` and `IBWithholdingTax[]` arrays from the IB parser into final `Dividend[]` objects with correct WHT amounts.

**Order of operations:**
1. Combine raw dividends by symbol+date+currency (already done in parser)
2. Combine raw WHT entries by symbol+date+currency (sum amounts)
3. Match combined WHT to combined dividends by the same key
4. Unmatched WHT → standalone Dividend row with gross=0

- [ ] **Step 1: Write WHT matcher tests**

```typescript
import { describe, it, expect } from 'vitest';
import { matchWhtToDividends } from '../../src/parsers/wht-matcher.js';
import type { IBDividend, IBWithholdingTax } from '../../src/types/index.js';

describe('matchWhtToDividends', () => {
  it('matches WHT to dividend by symbol+date+currency', () => {
    const dividends: IBDividend[] = [
      { currency: 'USD', date: '2025-02-13', symbol: 'AAPL', description: '', amount: 12.50 },
    ];
    const whts: IBWithholdingTax[] = [
      { currency: 'USD', date: '2025-02-13', symbol: 'AAPL', description: '', amount: -1.25 },
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].grossAmount).toBe(12.50);
    expect(result.matched[0].withholdingTax).toBe(1.25); // Normalized to positive
    expect(result.unmatched).toHaveLength(0);
  });

  it('combines multiple WHT entries for same symbol+date+currency before matching', () => {
    // ET has two WHT lines: -6.50 and -24.05 on same date
    const dividends: IBDividend[] = [
      { currency: 'USD', date: '2025-02-19', symbol: 'ET', description: '', amount: 65.00 },
    ];
    const whts: IBWithholdingTax[] = [
      { currency: 'USD', date: '2025-02-19', symbol: 'ET', description: '', amount: -6.50 },
      { currency: 'USD', date: '2025-02-19', symbol: 'ET', description: '', amount: -24.05 },
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].withholdingTax).toBeCloseTo(30.55); // |(-6.50) + (-24.05)|
  });

  it('handles BABA same-day ordinary + bonus (already combined by parser)', () => {
    const dividends: IBDividend[] = [
      { currency: 'USD', date: '2025-07-10', symbol: 'BABA', description: '', amount: 20.00 }, // combined: 10.50 + 9.50
    ];
    const whts: IBWithholdingTax[] = []; // BABA has 0% WHT
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].withholdingTax).toBe(0);
  });

  it('handles ASML reversal+re-entry (net positive) with WHT', () => {
    const dividends: IBDividend[] = [
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: 10.64 }, // already netted by parser
    ];
    const whts: IBWithholdingTax[] = [
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: -1.60 },
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: 1.60 },  // reversal
      { currency: 'EUR', date: '2025-02-19', symbol: 'ASML', description: '', amount: -1.60 },
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].withholdingTax).toBeCloseTo(1.60); // net: |-1.60 + 1.60 + -1.60| = 1.60
  });

  it('creates unmatched WHT as standalone dividend row with gross=0', () => {
    const dividends: IBDividend[] = [];
    const whts: IBWithholdingTax[] = [
      { currency: 'USD', date: '2024-12-04', symbol: 'VCLT', description: 'prior year adj', amount: 0.95 }, // net of +1.05 and -0.10
    ];
    const result = matchWhtToDividends(dividends, whts);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].grossAmount).toBe(0);
    expect(result.unmatched[0].withholdingTax).toBeCloseTo(0.95);
    expect(result.unmatched[0].notes).toContain('Unmatched WHT');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement WHT matcher**

```typescript
import type { IBDividend, IBWithholdingTax, Dividend } from '../types/index.js';

interface MatchResult {
  matched: Dividend[];
  unmatched: Dividend[];
}

export function matchWhtToDividends(
  dividends: IBDividend[],
  whts: IBWithholdingTax[],
): MatchResult {
  // Step 1: Combine WHT entries by symbol+date+currency
  const whtMap = new Map<string, number>();
  for (const w of whts) {
    const key = `${w.symbol}|${w.date}|${w.currency}`;
    whtMap.set(key, (whtMap.get(key) ?? 0) + w.amount);
  }

  const matched: Dividend[] = [];
  const matchedKeys = new Set<string>();

  // Step 2: Match combined WHT to combined dividends
  for (const d of dividends) {
    const key = `${d.symbol}|${d.date}|${d.currency}`;
    const whtAmount = whtMap.get(key) ?? 0;
    matchedKeys.add(key);

    matched.push({
      symbol: d.symbol,
      country: '', // Filled later by country-map
      date: d.date,
      currency: d.currency,
      grossAmount: d.amount,
      withholdingTax: Math.abs(whtAmount), // Normalize to positive
      bgTaxDue: 0,   // Filled later by tax calculator
      whtCredit: 0,   // Filled later by tax calculator
    });
  }

  // Step 3: Unmatched WHT → standalone rows
  const unmatched: Dividend[] = [];
  for (const [key, amount] of whtMap) {
    if (matchedKeys.has(key)) continue;
    const [symbol, date, currency] = key.split('|');
    unmatched.push({
      symbol,
      country: '',
      date,
      currency,
      grossAmount: 0,
      withholdingTax: Math.abs(amount),
      bgTaxDue: 0,
      whtCredit: 0,
      notes: 'Unmatched WHT — prior-year adjustment or missing dividend',
    });
  }

  return { matched, unmatched };
}
```

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Update barrel export and commit**

```bash
git add -A && git commit -m "feat: WHT-to-dividend matcher with combining and unmatched handling"
```

---

### Task 6c: Excel import for previous-year holdings

**Files:**
- Create: `packages/core/src/parsers/excel-import.ts`
- Test: `packages/core/tests/parsers/excel-import.test.ts`

- [ ] **Step 1: Add exceljs dependency to core (if not already)**

Run: `pnpm --filter @bg-tax/core add exceljs`

- [ ] **Step 2: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { importHoldingsFromExcel } from '../../src/parsers/excel-import.js';
import ExcelJS from 'exceljs';

describe('importHoldingsFromExcel', () => {
  it('parses holdings from Притежания sheet', async () => {
    // Create a minimal xlsx matching the app's known export format
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Притежания');
    ws.addRow(['Брокер', 'Държава', 'Символ', 'Дата', 'Количество', 'Валута', 'Цена', 'Общо', 'Курс', 'Общо BGN', 'Бележки']);
    ws.addRow(['IB', 'САЩ', 'AAPL', '2024-03-15', 50, 'USD', 250.42, '', '', '', '']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const holdings = await importHoldingsFromExcel(buffer);

    expect(holdings).toHaveLength(1);
    expect(holdings[0].symbol).toBe('AAPL');
    expect(holdings[0].quantity).toBe(50);
    expect(holdings[0].unitPrice).toBe(250.42);
    expect(holdings[0].broker).toBe('IB');
  });

  it('throws if Притежания sheet is missing', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Other');
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(importHoldingsFromExcel(buffer)).rejects.toThrow('Притежания');
  });
});
```

- [ ] **Step 3: Implement**

```typescript
import ExcelJS from 'exceljs';
import type { Holding } from '../types/index.js';
import { randomUUID } from 'crypto';

export async function importHoldingsFromExcel(buffer: Buffer): Promise<Holding[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet('Притежания');
  if (!ws) throw new Error('Sheet "Притежания" not found — this may not be an app-generated Excel file');

  const holdings: Holding[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    const broker = String(row.getCell(1).value ?? '');
    const country = String(row.getCell(2).value ?? '');
    const symbol = String(row.getCell(3).value ?? '');
    const dateAcquired = String(row.getCell(4).value ?? '');
    const quantity = Number(row.getCell(5).value ?? 0);
    const currency = String(row.getCell(6).value ?? '');
    const unitPrice = Number(row.getCell(7).value ?? 0);
    const notes = String(row.getCell(11).value ?? '');

    if (symbol && quantity > 0) {
      holdings.push({ id: randomUUID(), broker, country, symbol, dateAcquired, quantity, currency, unitPrice, notes: notes || undefined });
    }
  });

  return holdings;
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add -A && git commit -m "feat: import holdings from app-generated Excel (Притежания sheet)"
```

---

## Chunk 3: FX Rates

### Task 7: FX gap-fill (pure logic, no network)

**Files:**
- Create: `packages/core/src/fx/gap-fill.ts`
- Test: `packages/core/tests/fx/gap-fill.test.ts`

- [ ] **Step 1: Write gap-fill tests**

```typescript
import { describe, it, expect } from 'vitest';
import { gapFillRates } from '../../src/fx/gap-fill.js';

describe('gapFillRates', () => {
  it('carries forward Friday rate to Saturday and Sunday', () => {
    const rates: Record<string, number> = {
      '2025-01-03': 1.0353,  // Friday
      '2025-01-06': 1.0400,  // Monday
    };
    const filled = gapFillRates(rates, '2025-01-03', '2025-01-06');
    expect(filled['2025-01-04']).toBe(1.0353); // Saturday
    expect(filled['2025-01-05']).toBe(1.0353); // Sunday
  });

  it('fills holiday gaps', () => {
    const rates: Record<string, number> = {
      '2025-12-24': 1.04,
      '2025-12-29': 1.05,
    };
    const filled = gapFillRates(rates, '2025-12-24', '2025-12-29');
    expect(filled['2025-12-25']).toBe(1.04);
    expect(filled['2025-12-26']).toBe(1.04);
    expect(filled['2025-12-27']).toBe(1.04);
    expect(filled['2025-12-28']).toBe(1.04);
  });

  it('preserves existing rates', () => {
    const rates: Record<string, number> = {
      '2025-01-02': 1.03,
      '2025-01-03': 1.04,
    };
    const filled = gapFillRates(rates, '2025-01-02', '2025-01-03');
    expect(filled['2025-01-02']).toBe(1.03);
    expect(filled['2025-01-03']).toBe(1.04);
  });

  it('handles empty input', () => {
    const filled = gapFillRates({}, '2025-01-01', '2025-01-05');
    expect(Object.keys(filled)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @bg-tax/core test -- tests/fx/gap-fill.test.ts`

- [ ] **Step 3: Implement gap-fill**

```typescript
export function gapFillRates(
  rates: Record<string, number>,
  startDate: string,
  endDate: string
): Record<string, number> {
  const result = { ...rates };
  const dates = Object.keys(rates).sort();
  if (dates.length === 0) return result;

  let current = new Date(startDate);
  const end = new Date(endDate);
  let lastRate: number | null = null;

  while (current <= end) {
    const dateStr = formatDate(current);
    if (result[dateStr] !== undefined) {
      lastRate = result[dateStr];
    } else if (lastRate !== null) {
      result[dateStr] = lastRate;
    }
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bg-tax/core test -- tests/fx/gap-fill.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: FX rate gap-fill (carry forward weekends/holidays)"
```

---

### Task 8: ECB API client

**Files:**
- Create: `packages/core/src/fx/ecb-api.ts`
- Test: `packages/core/tests/fx/ecb-api.test.ts`

- [ ] **Step 1: Write ECB API tests (with mocked fetch)**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchEcbRates } from '../../src/fx/ecb-api.js';

const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<message:GenericData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message" xmlns:generic="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic">
<message:DataSet>
<generic:Series>
<generic:Obs><generic:ObsDimension value="2025-01-02"/><generic:ObsValue value="1.0353"/></generic:Obs>
<generic:Obs><generic:ObsDimension value="2025-01-03"/><generic:ObsValue value="1.0345"/></generic:Obs>
</generic:Series>
</message:DataSet>
</message:GenericData>`;

describe('fetchEcbRates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockXml),
    }));
  });

  it('parses ECB XML into date→rate map', async () => {
    const rates = await fetchEcbRates('USD', '2025-01-01', '2025-03-31');
    expect(rates['2025-01-02']).toBe(1.0353);
    expect(rates['2025-01-03']).toBe(1.0345);
  });

  it('constructs correct ECB URL', async () => {
    await fetchEcbRates('USD', '2025-01-01', '2025-03-31');
    const fetchFn = fetch as unknown as ReturnType<typeof vi.fn>;
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('EXR/D.USD.EUR.SP00.A');
    expect(url).toContain('startPeriod=2025-01-01');
    expect(url).toContain('endPeriod=2025-03-31');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement ECB API client**

```typescript
export async function fetchEcbRates(
  currency: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> {
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?startPeriod=${startDate}&endPeriod=${endDate}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ECB API error: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  return parseEcbXml(xml);
}

function parseEcbXml(xml: string): Record<string, number> {
  const rates: Record<string, number> = {};
  // Match <generic:Obs> elements
  const obsRegex = /<generic:ObsDimension value="([^"]+)"\/><generic:ObsValue value="([^"]+)"\/>/g;
  let match;
  while ((match = obsRegex.exec(xml)) !== null) {
    rates[match[1]] = parseFloat(match[2]);
  }
  return rates;
}

/** Fetch rates for a full year in 4 quarterly requests (ECB 3-month limit) */
export async function fetchYearRates(
  currency: string,
  year: number,
): Promise<Record<string, number>> {
  const quarters = [
    [`${year}-01-01`, `${year}-03-31`],
    [`${year}-04-01`, `${year}-06-30`],
    [`${year}-07-01`, `${year}-09-30`],
    [`${year}-10-01`, `${year}-12-31`],
  ];
  const all: Record<string, number> = {};
  for (const [start, end] of quarters) {
    const rates = await fetchEcbRates(currency, start, end);
    Object.assign(all, rates);
  }
  return all;
}
```

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ECB API client with quarterly fetching"
```

---

### Task 9: FX service (orchestrates fetch + cache + gap-fill + base currency conversion)

**Files:**
- Create: `packages/core/src/fx/fx-cache.ts`
- Create: `packages/core/src/fx/fx-service.ts`
- Test: `packages/core/tests/fx/fx-service.test.ts`

- [ ] **Step 1: Write fx-cache (simple file-based JSON cache interface)**

```typescript
/** Cache interface — UI layer provides the actual file I/O implementation */
export interface FxCache {
  get(currency: string, year: number): Promise<Record<string, number> | null>;
  set(currency: string, year: number, rates: Record<string, number>): Promise<void>;
}

/** In-memory cache for testing and as fallback */
export class InMemoryFxCache implements FxCache {
  private store = new Map<string, Record<string, number>>();

  async get(currency: string, year: number): Promise<Record<string, number> | null> {
    return this.store.get(`${currency}-${year}`) ?? null;
  }

  async set(currency: string, year: number, rates: Record<string, number>): Promise<void> {
    this.store.set(`${currency}-${year}`, rates);
  }
}
```

- [ ] **Step 2: Write FX service**

```typescript
import type { BaseCurrency } from '../types/index.js';
import type { FxCache } from './fx-cache.js';
import { fetchYearRates } from './ecb-api.js';
import { gapFillRates } from './gap-fill.js';

const EUR_BGN_FIXED = 1.95583;

export class FxService {
  constructor(
    private cache: FxCache,
    private baseCurrency: BaseCurrency,
  ) {}

  /** Get rate for converting `currency` to base currency on `date` */
  getRate(
    currency: string,
    date: string,
    rates: Record<string, Record<string, number>>,
  ): number | null {
    if (currency === this.baseCurrency) return 1;
    if (currency === 'EUR' && this.baseCurrency === 'BGN') return EUR_BGN_FIXED;
    if (currency === 'BGN' && this.baseCurrency === 'EUR') return 1 / EUR_BGN_FIXED;

    const currencyRates = rates[currency];
    if (!currencyRates) return null;

    const ecbRate = currencyRates[date];
    if (ecbRate === undefined) return null;

    // ECB rates are EUR-native (1 EUR = X currency)
    // We need: 1 unit of currency = ? base currency
    // So: 1 USD = 1/ecbRate EUR
    if (this.baseCurrency === 'EUR') {
      return 1 / ecbRate;
    }
    // For BGN: 1 USD = (1/ecbRate) × EUR_BGN_FIXED BGN
    return EUR_BGN_FIXED / ecbRate;
  }

  /** Fetch and cache rates for all needed currencies for a year */
  async fetchRates(
    currencies: string[],
    year: number,
  ): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    const uniqueCurrencies = [...new Set(currencies.filter(c => c !== 'EUR' && c !== 'BGN'))];

    for (const ccy of uniqueCurrencies) {
      let rates = await this.cache.get(ccy, year);
      if (!rates) {
        try {
          rates = await fetchYearRates(ccy, year);
          await this.cache.set(ccy, year, rates);
        } catch {
          rates = {};
        }
      }
      result[ccy] = gapFillRates(rates, `${year}-01-01`, `${year}-12-31`);
    }
    return result;
  }
}
```

- [ ] **Step 3: Write tests for FxService.getRate**

```typescript
import { describe, it, expect } from 'vitest';
import { FxService } from '../../src/fx/fx-service.js';
import { InMemoryFxCache } from '../../src/fx/fx-cache.js';

describe('FxService.getRate', () => {
  const rates = {
    USD: { '2025-01-02': 1.0353 },  // 1 EUR = 1.0353 USD
    GBP: { '2025-01-02': 0.8290 },
  };

  it('converts USD to BGN', () => {
    const svc = new FxService(new InMemoryFxCache(), 'BGN');
    const rate = svc.getRate('USD', '2025-01-02', rates);
    // 1 USD = 1.95583 / 1.0353 BGN ≈ 1.8889
    expect(rate).toBeCloseTo(1.95583 / 1.0353, 4);
  });

  it('converts USD to EUR', () => {
    const svc = new FxService(new InMemoryFxCache(), 'EUR');
    const rate = svc.getRate('USD', '2025-01-02', rates);
    // 1 USD = 1/1.0353 EUR ≈ 0.9659
    expect(rate).toBeCloseTo(1 / 1.0353, 4);
  });

  it('returns 1 for same currency', () => {
    const svc = new FxService(new InMemoryFxCache(), 'EUR');
    expect(svc.getRate('EUR', '2025-01-02', rates)).toBe(1);
  });

  it('returns fixed rate for EUR→BGN', () => {
    const svc = new FxService(new InMemoryFxCache(), 'BGN');
    expect(svc.getRate('EUR', '2025-01-02', rates)).toBe(1.95583);
  });

  it('returns null for missing rate', () => {
    const svc = new FxService(new InMemoryFxCache(), 'BGN');
    expect(svc.getRate('USD', '2025-06-15', rates)).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Update barrel, commit**

```bash
git add -A && git commit -m "feat: FX service with ECB fetch, caching, gap-fill, base currency conversion"
```

---

## Chunk 4: FIFO Engine

### Task 10: FIFO lot matching

**Files:**
- Create: `packages/core/src/fifo/engine.ts`
- Test: `packages/core/tests/fifo/engine.test.ts`

- [ ] **Step 1: Write FIFO tests**

```typescript
import { describe, it, expect } from 'vitest';
import { FifoEngine } from '../../src/fifo/engine.js';
import type { Holding, Sale, IBTrade } from '../../src/types/index.js';

describe('FifoEngine', () => {
  it('matches sells against oldest lots first', () => {
    const existingHoldings: Holding[] = [
      { id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL', dateAcquired: '2023-01-15', quantity: 20, currency: 'USD', unitPrice: 150.00 },
      { id: '2', broker: 'IB', country: 'САЩ', symbol: 'AAPL', dateAcquired: '2024-06-10', quantity: 30, currency: 'USD', unitPrice: 200.00 },
    ];
    const trades: IBTrade[] = [
      { currency: 'USD', symbol: 'AAPL', dateTime: '2025-09-15, 10:00:00', quantity: -25, price: 250.00, proceeds: 6250, commission: -1 },
    ];

    const engine = new FifoEngine(existingHoldings);
    const { holdings, sales } = engine.processTrades(trades, 'IB', { AAPL: 'САЩ' });

    expect(sales).toHaveLength(2); // Consumes all 20 from lot 1, then 5 from lot 2
    expect(sales[0].quantity).toBe(20);
    expect(sales[0].buyPrice).toBe(150.00);
    expect(sales[1].quantity).toBe(5);
    expect(sales[1].buyPrice).toBe(200.00);

    // Remaining holdings: lot 2 with 25 shares
    const aaplHoldings = holdings.filter(h => h.symbol === 'AAPL');
    expect(aaplHoldings).toHaveLength(1);
    expect(aaplHoldings[0].quantity).toBe(25);
  });

  it('handles partial lot consumption', () => {
    const holdings: Holding[] = [
      { id: '1', broker: 'IB', country: 'САЩ', symbol: 'MSFT', dateAcquired: '2024-01-01', quantity: 100, currency: 'USD', unitPrice: 300.00 },
    ];
    const trades: IBTrade[] = [
      { currency: 'USD', symbol: 'MSFT', dateTime: '2025-06-01, 10:00:00', quantity: -30, price: 400.00, proceeds: 12000, commission: -1 },
    ];

    const engine = new FifoEngine(holdings);
    const result = engine.processTrades(trades, 'IB', { MSFT: 'САЩ' });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].quantity).toBe(30);
    expect(result.holdings.find(h => h.symbol === 'MSFT')?.quantity).toBe(70);
  });

  it('adds buys as new holdings', () => {
    const engine = new FifoEngine([]);
    const trades: IBTrade[] = [
      { currency: 'EUR', symbol: 'CSPX', dateTime: '2025-01-21, 10:26:07', quantity: 1, price: 614.28, proceeds: -614.28, commission: -1.25 },
    ];

    const result = engine.processTrades(trades, 'IB', { CSPX: 'Ирландия' });

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].symbol).toBe('CSPX');
    expect(result.holdings[0].unitPrice).toBe(614.28);
    expect(result.sales).toHaveLength(0);
  });

  it('sorts trades by datetime before processing (buy before sell on same day)', () => {
    const engine = new FifoEngine([]);
    const trades: IBTrade[] = [
      // Sell listed first in CSV, but buy happened earlier
      { currency: 'USD', symbol: 'TEST', dateTime: '2025-03-15, 14:00:00', quantity: -5, price: 110.00, proceeds: 550, commission: -1 },
      { currency: 'USD', symbol: 'TEST', dateTime: '2025-03-15, 09:00:00', quantity: 10, price: 100.00, proceeds: -1000, commission: -1 },
    ];

    const result = engine.processTrades(trades, 'IB', { TEST: 'САЩ' });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].buyPrice).toBe(100.00);
    expect(result.holdings.find(h => h.symbol === 'TEST')?.quantity).toBe(5);
  });

  it('generates validation warning for sell without sufficient holdings', () => {
    const engine = new FifoEngine([]);
    const trades: IBTrade[] = [
      { currency: 'USD', symbol: 'GHOST', dateTime: '2025-06-01, 10:00:00', quantity: -10, price: 50.00, proceeds: 500, commission: -1 },
    ];

    const result = engine.processTrades(trades, 'IB', { GHOST: 'САЩ' });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'negative-holdings', message: expect.stringContaining('GHOST') })
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement FIFO engine**

```typescript
import type { Holding, Sale, IBTrade, ValidationWarning } from '../types/index.js';
import { randomUUID } from 'crypto';

export interface FifoResult {
  holdings: Holding[];
  sales: Sale[];
  warnings: ValidationWarning[];
}

export class FifoEngine {
  private lots: Map<string, Holding[]>; // symbol → sorted lots (oldest first)

  constructor(existingHoldings: Holding[]) {
    this.lots = new Map();
    for (const h of existingHoldings) {
      const list = this.lots.get(h.symbol) ?? [];
      list.push({ ...h });
      this.lots.set(h.symbol, list);
    }
    // Sort each symbol's lots by dateAcquired
    for (const [, list] of this.lots) {
      list.sort((a, b) => a.dateAcquired.localeCompare(b.dateAcquired));
    }
  }

  processTrades(
    trades: IBTrade[],
    broker: string,
    countryMap: Record<string, string>,
  ): FifoResult {
    const sales: Sale[] = [];
    const warnings: ValidationWarning[] = [];

    // Sort trades by datetime ascending
    const sorted = [...trades].sort((a, b) => a.dateTime.localeCompare(b.dateTime));

    for (const trade of sorted) {
      if (trade.quantity > 0) {
        this.addLot(trade, broker, countryMap);
      } else if (trade.quantity < 0) {
        const result = this.sellLots(trade, broker, countryMap);
        sales.push(...result.sales);
        warnings.push(...result.warnings);
      }
    }

    // Flatten remaining lots into holdings array
    const holdings: Holding[] = [];
    for (const [, list] of this.lots) {
      holdings.push(...list.filter(h => h.quantity > 0));
    }

    return { holdings, sales, warnings };
  }

  private addLot(trade: IBTrade, broker: string, countryMap: Record<string, string>): void {
    const date = trade.dateTime.split(',')[0].trim();
    const lot: Holding = {
      id: randomUUID(),
      broker,
      country: countryMap[trade.symbol] ?? '',
      symbol: trade.symbol,
      dateAcquired: date,
      quantity: trade.quantity,
      currency: trade.currency,
      unitPrice: trade.price,
    };
    const list = this.lots.get(trade.symbol) ?? [];
    list.push(lot);
    this.lots.set(trade.symbol, list);
  }

  private sellLots(
    trade: IBTrade,
    broker: string,
    countryMap: Record<string, string>,
  ): { sales: Sale[]; warnings: ValidationWarning[] } {
    const sales: Sale[] = [];
    const warnings: ValidationWarning[] = [];
    let remaining = Math.abs(trade.quantity);
    const dateSold = trade.dateTime.split(',')[0].trim();
    const lots = this.lots.get(trade.symbol) ?? [];

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const consumed = Math.min(lot.quantity, remaining);

      sales.push({
        id: randomUUID(),
        broker,
        country: countryMap[trade.symbol] ?? '',
        symbol: trade.symbol,
        dateAcquired: lot.dateAcquired,
        dateSold,
        quantity: consumed,
        currency: trade.currency,
        buyPrice: lot.unitPrice,
        sellPrice: trade.price,
        fxRateBuy: 0,  // Filled later by FX service
        fxRateSell: 0,
      });

      lot.quantity -= consumed;
      remaining -= consumed;

      if (lot.quantity <= 0) {
        lots.shift();
      }
    }

    if (remaining > 0) {
      warnings.push({
        type: 'negative-holdings',
        message: `Sell of ${Math.abs(trade.quantity)} ${trade.symbol} exceeds available holdings by ${remaining}`,
        tab: 'Sales',
      });
    }

    return { sales, warnings };
  }
}
```

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: FIFO engine with datetime sorting and partial lot splits"
```

---

### Task 10b: Post-FIFO FX rate population

**Files:**
- Create: `packages/core/src/fifo/populate-fx.ts`
- Test: `packages/core/tests/fifo/populate-fx.test.ts`

The FIFO engine creates Sale objects with `fxRateBuy: 0, fxRateSell: 0`. This step fills them using the FX rates map. It also fills FX rates for dividends.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { populateSaleFxRates, populateDividendFxRates } from '../../src/fifo/populate-fx.js';
import type { Sale, Dividend } from '../../src/types/index.js';
import { FxService } from '../../src/fx/fx-service.js';
import { InMemoryFxCache } from '../../src/fx/fx-cache.js';

describe('populateSaleFxRates', () => {
  const fxRates = { USD: { '2024-03-15': 1.0900, '2025-09-15': 1.0800 } };
  const fxService = new FxService(new InMemoryFxCache(), 'BGN');

  it('fills fxRateBuy and fxRateSell from FX rates', () => {
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
      dateAcquired: '2024-03-15', dateSold: '2025-09-15',
      quantity: 5, currency: 'USD', buyPrice: 170, sellPrice: 250,
      fxRateBuy: 0, fxRateSell: 0,
    }];
    const filled = populateSaleFxRates(sales, fxRates, fxService);
    expect(filled[0].fxRateBuy).toBeCloseTo(1.95583 / 1.09, 3);
    expect(filled[0].fxRateSell).toBeCloseTo(1.95583 / 1.08, 3);
  });

  it('leaves fxRate as 0 when rate is missing (validation will warn)', () => {
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
      dateAcquired: '2024-03-15', dateSold: '2025-12-25', // no rate for this date
      quantity: 5, currency: 'USD', buyPrice: 170, sellPrice: 250,
      fxRateBuy: 0, fxRateSell: 0,
    }];
    const filled = populateSaleFxRates(sales, fxRates, fxService);
    expect(filled[0].fxRateBuy).toBeGreaterThan(0); // buy date has rate
    expect(filled[0].fxRateSell).toBe(0); // sell date missing
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { Sale, Dividend } from '../types/index.js';
import type { FxService } from '../fx/fx-service.js';

export function populateSaleFxRates(
  sales: Sale[],
  fxRates: Record<string, Record<string, number>>,
  fxService: FxService,
): Sale[] {
  return sales.map(s => ({
    ...s,
    fxRateBuy: fxService.getRate(s.currency, s.dateAcquired, fxRates) ?? 0,
    fxRateSell: fxService.getRate(s.currency, s.dateSold, fxRates) ?? 0,
  }));
}

export function populateDividendFxRates(
  dividends: Dividend[],
  fxRates: Record<string, Record<string, number>>,
  fxService: FxService,
): Dividend[] {
  return dividends.map(d => ({ ...d })); // FX conversion happens in tax calculator
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add -A && git commit -m "feat: post-FIFO FX rate population for sales"
```

---

## Chunk 5: Tax Calculator + Validation

### Task 11: Tax rules

**Files:**
- Create: `packages/core/src/tax/rules.ts`
- Test: `packages/core/tests/tax/rules.test.ts`

- [ ] **Step 1: Write tax rules tests**

```typescript
import { describe, it, expect } from 'vitest';
import { calcCapitalGainsTax, calcDividendTax, calcInterestTax } from '../../src/tax/rules.js';

describe('Bulgarian tax rules', () => {
  describe('calcCapitalGainsTax (10%)', () => {
    it('calculates 10% on profit', () => {
      expect(calcCapitalGainsTax(1000)).toBeCloseTo(100);
    });

    it('returns 0 for losses', () => {
      expect(calcCapitalGainsTax(-500)).toBe(0);
    });
  });

  describe('calcDividendTax (5% with WHT credit)', () => {
    it('US dividend (10% WHT > 5% BG rate) → no additional tax', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 100); // gross=1000 BGN, WHT=100 BGN (10%)
      expect(bgTaxDue).toBe(0);
      expect(whtCredit).toBe(50); // min(100, 5% × 1000) = 50
    });

    it('Irish ETF (0% WHT) → full 5% tax', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 0);
      expect(bgTaxDue).toBe(50);
      expect(whtCredit).toBe(0);
    });

    it('Dutch dividend (15% WHT) → no additional tax', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 150);
      expect(bgTaxDue).toBe(0);
      expect(whtCredit).toBe(50); // capped at BG tax amount
    });

    it('partial WHT credit (3% WHT < 5% BG rate)', () => {
      const { bgTaxDue, whtCredit } = calcDividendTax(1000, 30);
      expect(bgTaxDue).toBe(20); // 50 - 30
      expect(whtCredit).toBe(30);
    });
  });

  describe('calcInterestTax (10%)', () => {
    it('calculates 10% on gross interest', () => {
      expect(calcInterestTax(500)).toBe(50);
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement tax rules**

**Convention:** All amounts passed to tax functions are **positive** (absolute values). Callers must normalize WHT (IB CSV stores WHT as negative) before calling. This avoids sign confusion throughout the codebase.

```typescript
const CAPITAL_GAINS_RATE = 0.10;
const DIVIDEND_RATE = 0.05;
const INTEREST_RATE = 0.10;

export function calcCapitalGainsTax(profitInBaseCcy: number): number {
  return Math.max(0, profitInBaseCcy * CAPITAL_GAINS_RATE);
}

export interface DividendTaxResult {
  bgTaxDue: number;
  whtCredit: number;
}

/**
 * @param grossInBaseCcy — positive gross dividend in base currency
 * @param whtInBaseCcy — positive WHT amount in base currency (caller must Math.abs() the IB CSV value)
 */
export function calcDividendTax(grossInBaseCcy: number, whtInBaseCcy: number): DividendTaxResult {
  const bgTaxFull = grossInBaseCcy * DIVIDEND_RATE;
  const whtCredit = Math.min(whtInBaseCcy, bgTaxFull);
  const bgTaxDue = Math.max(0, bgTaxFull - whtInBaseCcy);
  return { bgTaxDue, whtCredit };
}

export function calcInterestTax(grossInBaseCcy: number): number {
  return grossInBaseCcy * INTEREST_RATE;
}

export { CAPITAL_GAINS_RATE, DIVIDEND_RATE, INTEREST_RATE };
```

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Bulgarian tax rules (10% gains, 5% dividends, 10% interest)"
```

---

### Task 12: Tax calculator (per-category aggregation)

**Files:**
- Create: `packages/core/src/tax/calculator.ts`
- Test: `packages/core/tests/tax/calculator.test.ts`

- [ ] **Step 1: Write calculator tests**

```typescript
import { describe, it, expect } from 'vitest';
import { TaxCalculator } from '../../src/tax/calculator.js';
import type { Sale, Dividend, StockYieldEntry, RevolutInterest } from '../../src/types/index.js';

describe('TaxCalculator', () => {
  const fxRates = { USD: { '2025-03-13': 1.0353, '2025-06-15': 1.08 } };

  it('calculates capital gains tax from sales', () => {
    const sales: Sale[] = [{
      id: '1', broker: 'IB', country: 'САЩ', symbol: 'AAPL',
      dateAcquired: '2024-01-01', dateSold: '2025-06-15',
      quantity: 10, currency: 'USD',
      buyPrice: 170, sellPrice: 250,
      fxRateBuy: 1.889, fxRateSell: 1.811,
    }];
    const calc = new TaxCalculator('BGN');
    const result = calc.calcCapitalGains(sales);
    // Proceeds: 10 × 250 × 1.811 = 4527.5 BGN
    // Cost: 10 × 170 × 1.889 = 3211.3 BGN
    // Profit: 1316.2 BGN → Tax: 131.62 BGN
    expect(result.totalProceeds).toBeCloseTo(4527.5, 0);
    expect(result.totalCost).toBeCloseTo(3211.3, 0);
    expect(result.taxDue).toBeCloseTo(131.62, 0);
  });

  it('calculates Revolut interest tax', () => {
    const revolut: RevolutInterest[] = [{
      currency: 'EUR',
      entries: [
        { date: '2025-01-01', description: 'Interest PAID', amount: 100 },
        { date: '2025-01-01', description: 'Service Fee Charged', amount: -10 },
      ],
    }];
    const calc = new TaxCalculator('BGN');
    const result = calc.calcRevolutInterest(revolut);
    // Net EUR = 90, BGN = 90 × 1.95583 = 176.0247
    expect(result[0].netInterestBaseCcy).toBeCloseTo(176.02, 0);
    expect(result[0].taxDue).toBeCloseTo(17.60, 0);
  });
});
```

- [ ] **Step 2: Implement TaxCalculator**

A class that takes baseCurrency and provides methods: `calcCapitalGains(sales)`, `calcDividendsTax(dividends, fxRates)`, `calcStockYieldTax(entries, fxRates)`, `calcRevolutInterest(entries)`. Each returns aggregated totals suitable for the declaration mapper.

- [ ] **Step 3: Run tests, commit**

```bash
git add -A && git commit -m "feat: tax calculator with per-category aggregation"
```

---

### Task 13: Validation layer

**Note on deduplication:** The FIFO engine produces `negative-holdings` warnings during trade processing. The validator does NOT re-check for negative holdings — it only checks for issues not caught by FIFO (unmatched WHT, missing FX, year mismatch, duplicates). The UI merges FIFO warnings + validator warnings into a single list.

**Files:**
- Create: `packages/core/src/validation/validator.ts`
- Test: `packages/core/tests/validation/validator.test.ts`

- [ ] **Step 1: Write validation tests**

```typescript
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/validation/validator.js';
import type { AppState } from '../../src/types/index.js';

describe('validate', () => {
  it('warns on unmatched WHT', () => {
    const state: Partial<AppState> = {
      taxYear: 2025,
      dividends: [
        { symbol: 'AAPL', country: 'САЩ', date: '2025-02-13', currency: 'USD', grossAmount: 0, withholdingTax: -1.25, bgTaxDue: 0, whtCredit: 0, notes: 'Unmatched WHT' },
      ],
    };
    const warnings = validate(state as AppState);
    expect(warnings.some(w => w.type === 'unmatched-wht')).toBe(true);
  });

  it('warns on missing FX rates', () => {
    const state: Partial<AppState> = {
      taxYear: 2025,
      baseCurrency: 'BGN',
      dividends: [
        { symbol: 'MSFT', country: 'САЩ', date: '2025-03-13', currency: 'USD', grossAmount: 166, withholdingTax: -16.6, bgTaxDue: 0, whtCredit: 0 },
      ],
      fxRates: {}, // No rates
    };
    const warnings = validate(state as AppState);
    expect(warnings.some(w => w.type === 'missing-fx')).toBe(true);
  });

  it('warns on year mismatch', () => {
    const state: Partial<AppState> = {
      taxYear: 2025,
      dividends: [
        { symbol: 'X', country: 'САЩ', date: '2024-12-15', currency: 'USD', grossAmount: 10, withholdingTax: 0, bgTaxDue: 0, whtCredit: 0 },
      ],
    };
    const warnings = validate(state as AppState);
    expect(warnings.some(w => w.type === 'year-mismatch')).toBe(true);
  });
});
```

- [ ] **Step 2: Implement validator**

```typescript
import type { AppState, ValidationWarning } from '../types/index.js';

export function validate(state: AppState): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  warnings.push(...checkUnmatchedWht(state));
  warnings.push(...checkMissingFx(state));
  warnings.push(...checkYearMismatch(state));
  return warnings;
}

function checkUnmatchedWht(state: AppState): ValidationWarning[] {
  return (state.dividends ?? [])
    .filter(d => d.grossAmount === 0 && d.withholdingTax !== 0)
    .map(d => ({
      type: 'unmatched-wht' as const,
      message: `Unmatched WHT for ${d.symbol} on ${d.date}: ${d.withholdingTax}`,
      tab: 'Dividends',
    }));
}

function checkMissingFx(state: AppState): ValidationWarning[] {
  if (state.baseCurrency === 'EUR') return []; // EUR dividends don't need FX
  const warnings: ValidationWarning[] = [];
  for (const d of state.dividends ?? []) {
    if (d.currency !== state.baseCurrency && d.currency !== 'EUR') {
      const rate = state.fxRates?.[d.currency]?.[d.date];
      if (rate === undefined) {
        warnings.push({
          type: 'missing-fx',
          message: `Missing FX rate for ${d.currency} on ${d.date}`,
          tab: 'Dividends',
        });
      }
    }
  }
  return warnings;
}

function checkYearMismatch(state: AppState): ValidationWarning[] {
  const year = String(state.taxYear);
  return (state.dividends ?? [])
    .filter(d => !d.date.startsWith(year))
    .map(d => ({
      type: 'year-mismatch' as const,
      message: `${d.symbol} dividend on ${d.date} is outside tax year ${state.taxYear}`,
      tab: 'Dividends',
    }));
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add -A && git commit -m "feat: validation layer (unmatched WHT, missing FX, year mismatch)"
```

---

## Chunk 6: Country Map + i18n + Declaration Mapper

### Task 14: Country/symbol mapping

**Files:**
- Create: `packages/core/src/country-map.ts`
- Test: `packages/core/tests/country-map.test.ts`

- [ ] **Step 1: Write tests and implement**

Map of known symbols to Bulgarian country names. The parser extracts the symbol; this module maps it. Includes a `resolveCountry(symbol)` function with fallback to empty string for unknown symbols.

Known mappings from the spec:
```typescript
const COUNTRY_MAP: Record<string, string> = {
  AAPL: 'САЩ', AMD: 'САЩ', AMZN: 'САЩ', AVGO: 'САЩ', BABA: 'Хонконг',
  BRK: 'САЩ', DAL: 'САЩ', ESTC: 'САЩ', ET: 'САЩ', GTLB: 'САЩ',
  META: 'САЩ', MDB: 'САЩ', MSFT: 'САЩ', NFLX: 'САЩ', NVDA: 'САЩ',
  PLTR: 'САЩ', PRGS: 'САЩ', PYPL: 'САЩ', QCOM: 'САЩ', ROKU: 'САЩ',
  SBUX: 'САЩ', VCLT: 'САЩ', XOM: 'САЩ',
  CSPX: 'Ирландия', SXR8: 'Ирландия', GLDV: 'Ирландия', ZPRG: 'Ирландия',
  VHYL: 'Ирландия', JGPI: 'Ирландия', VWCE: 'Ирландия',
  ISPA: 'Германия', ISPAd: 'Германия', LHA: 'Германия', SAP: 'Германия',
  TMV: 'Германия', TKWY: 'Германия',
  ASML: 'Нидерландия (Холандия)',
  RIO: 'Великобритания',
  '1810': 'Хонконг',
};
```

- [ ] **Step 2: Run tests, commit**

```bash
git add -A && git commit -m "feat: symbol → country mapping for Bulgarian declaration"
```

---

### Task 15: i18n string tables

**Files:**
- Create: `packages/core/src/i18n/index.ts`, `bg.ts`, `en.ts`

- [ ] **Step 1: Implement minimal i18n**

Simple `t(key)` function with `setLanguage()`. Flat key-value maps. Start with keys needed for the Excel export (sheet names, column headers) and UI labels. Bulgarian strings are the primary set (Excel is always BG).

- [ ] **Step 2: Test, commit**

```bash
git add -A && git commit -m "feat: i18n with BG/EN string tables"
```

---

### Task 16: Declaration mapper

**Files:**
- Create: `packages/core/src/declaration/mapper.ts`
- Create: `packages/core/src/declaration/form-config/2025.json`
- Create: `packages/core/src/declaration/form-config/2026.json`
- Test: `packages/core/tests/declaration/mapper.test.ts`

- [ ] **Step 1: Create 2025 form config JSON**

```json
{
  "year": 2025,
  "baseCurrency": "BGN",
  "appendix5": {
    "title": "Приложение 5 — Доходи от прехвърляне на права или имущество",
    "fields": [
      { "ref": "Ред 1, Кол. 3", "label": "Приходи от продажба на ценни книжа", "source": "capitalGains.totalProceeds" },
      { "ref": "Ред 1, Кол. 4", "label": "Цена на придобиване", "source": "capitalGains.totalCost" },
      { "ref": "Ред 1, Кол. 5", "label": "Печалба", "source": "capitalGains.profit" },
      { "ref": "Ред 1, Кол. 7", "label": "Данък (10%)", "source": "capitalGains.taxDue" }
    ]
  },
  "appendix8table1": {
    "title": "Приложение 8, Таблица 1 — Дивиденти от чужбина",
    "fields": [
      { "ref": "Кол. 4", "label": "Брутен размер на дивидента", "source": "dividends.totalGross" },
      { "ref": "Кол. 6", "label": "Удържан данък в чужбина", "source": "dividends.totalWht" },
      { "ref": "Кол. 7", "label": "Дължим данък (5%)", "source": "dividends.totalBgTax" },
      { "ref": "Кол. 8", "label": "Данъчен кредит", "source": "dividends.totalWhtCredit" }
    ]
  },
  "appendix8table6": {
    "title": "Приложение 8, Таблица 6 — Лихви от чужбина",
    "fields": [
      { "ref": "Кол. 4", "label": "Брутен размер на лихвата", "source": "interest.totalGross" },
      { "ref": "Кол. 7", "label": "Дължим данък (10%)", "source": "interest.totalTax" }
    ]
  }
}
```

- [ ] **Step 1b: Create 2026 form config JSON (EUR-based)**

```json
{
  "year": 2026,
  "baseCurrency": "EUR",
  "appendix5": {
    "title": "Приложение 5 — Доходи от прехвърляне на права или имущество",
    "fields": [
      { "ref": "Ред 1, Кол. 3", "label": "Приходи от продажба на ценни книжа", "source": "capitalGains.totalProceeds" },
      { "ref": "Ред 1, Кол. 4", "label": "Цена на придобиване", "source": "capitalGains.totalCost" },
      { "ref": "Ред 1, Кол. 5", "label": "Печалба", "source": "capitalGains.profit" },
      { "ref": "Ред 1, Кол. 7", "label": "Данък (10%)", "source": "capitalGains.taxDue" }
    ]
  },
  "appendix8table1": {
    "title": "Приложение 8, Таблица 1 — Дивиденти от чужбина",
    "fields": [
      { "ref": "Кол. 4", "label": "Брутен размер на дивидента", "source": "dividends.totalGross" },
      { "ref": "Кол. 6", "label": "Удържан данък в чужбина", "source": "dividends.totalWht" },
      { "ref": "Кол. 7", "label": "Дължим данък (5%)", "source": "dividends.totalBgTax" },
      { "ref": "Кол. 8", "label": "Данъчен кредит", "source": "dividends.totalWhtCredit" }
    ]
  },
  "appendix8table6": {
    "title": "Приложение 8, Таблица 6 — Лихви от чужбина",
    "fields": [
      { "ref": "Кол. 4", "label": "Брутен размер на лихвата", "source": "interest.totalGross" },
      { "ref": "Кол. 7", "label": "Дължим данък (10%)", "source": "interest.totalTax" }
    ]
  }
}
```

Note: The 2026 config has the same structure as 2025 for now. NRA may update field references for 2026 — update this JSON when the official form is published. The key difference is `baseCurrency: "EUR"` which affects column headers in Excel export.

- [ ] **Step 2: Implement mapper**

`mapToDeclaration(taxResults, formConfig)` — takes the aggregated results from TaxCalculator and the JSON config, returns an array of sections with field refs and values.

- [ ] **Step 3: Test, commit**

```bash
git add -A && git commit -m "feat: declaration mapper with 2025+2026 NRA form configs"
```

---

## Chunk 7: Excel Export

### Task 17: Excel styles + sheet generators

**Files:**
- Create: `packages/core/src/excel/styles.ts`
- Create: `packages/core/src/excel/sheets/fx-sheet.ts`
- Create: `packages/core/src/excel/sheets/holdings-sheet.ts`
- Create: `packages/core/src/excel/sheets/sales-sheet.ts`
- Create: `packages/core/src/excel/sheets/dividends-sheet.ts`
- Create: `packages/core/src/excel/sheets/stock-yield-sheet.ts`
- Create: `packages/core/src/excel/sheets/revolut-sheet.ts`
- Create: `packages/core/src/excel/generator.ts`
- Test: `packages/core/tests/excel/generator.test.ts`

- [ ] **Step 1: Add exceljs dependency**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration && pnpm --filter @bg-tax/core add exceljs`

- [ ] **Step 2: Create shared styles**

```typescript
// packages/core/src/excel/styles.ts
import type { Style } from 'exceljs';

export const FONT = { name: 'Aptos Narrow', size: 12 };

export const DATE_FORMAT = 'yyyy-mm-dd';
export const BGN_FORMAT = '#,##0.00 "BGN"';
export const EUR_FORMAT = '#,##0.00 "EUR"';
export const CCY_FORMAT = '#,##0.00';

export function baseCcyFormat(baseCurrency: string): string {
  return baseCurrency === 'BGN' ? BGN_FORMAT : EUR_FORMAT;
}

export const HEADER_STYLE: Partial<Style> = {
  font: { ...FONT, bold: true },
};
```

- [ ] **Step 3: Implement each sheet generator**

Each sheet module exports a function like `addFxSheet(workbook, currency, rates)` that creates and populates one worksheet. Key rules:
- FX sheet: date + rate columns, named by currency (e.g., "USD")
- Holdings: SWITCH formula for currency → FX sheet, VLOOKUP for rate, ROUND for total
- Use ArrayFormula ONLY for SWITCH (exceljs _xlfn prefix requirement)
- Use plain formula strings for VLOOKUP (ArrayFormula causes Excel errors)
- Dividends: ordered by symbol then date
- Revolut: summary sheet + per-currency detail sheets

- [ ] **Step 4: Implement generator orchestrator**

```typescript
// packages/core/src/excel/generator.ts
import ExcelJS from 'exceljs';
import type { AppState } from '../types/index.js';
// ... import sheet builders

export async function generateExcel(state: AppState): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // 1. FX rate sheets
  const currencies = detectCurrencies(state);
  for (const ccy of currencies) {
    addFxSheet(workbook, ccy, state.fxRates[ccy] ?? {}, state.taxYear);
  }

  // 2. Data sheets
  addHoldingsSheet(workbook, state);
  addSalesSheet(workbook, state);
  addDividendsSheet(workbook, state);
  addStockYieldSheet(workbook, state);
  addRevolutSheets(workbook, state);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

- [ ] **Step 5: Write test that generates and validates structure**

Test: create a minimal AppState, call `generateExcel`, read back with exceljs, verify sheet names, header rows, and a formula in a known cell.

- [ ] **Step 6: Run tests, commit**

```bash
git add -A && git commit -m "feat: Excel export generator with all sheets"
```

---

## Chunk 8: UI Shell (Tauri + React + State)

### Task 18: Scaffold Tauri v2 + React app

**Files:**
- Create: `packages/ui/` directory structure

- [ ] **Step 1: Initialize Tauri v2 project**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration/packages && pnpm create tauri-app ui --template react-ts --manager pnpm`

This scaffolds the Tauri + React + Vite project. Then:
- Update `packages/ui/package.json` to set name to `@bg-tax/ui` and add `@bg-tax/core` as workspace dependency
- Update `packages/ui/tsconfig.json` to extend from root
- Verify `packages/ui/src-tauri/tauri.conf.json` has correct app name

- [ ] **Step 2: Add workspace dependency on core**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration && pnpm --filter @bg-tax/ui add @bg-tax/core --workspace`

- [ ] **Step 3: Verify dev server starts**

Run: `cd /Users/trifonov/projects/bulgarian-tax-declaration && pnpm --filter @bg-tax/ui dev`
Expected: Tauri window opens with default React template

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold Tauri v2 + React UI package"
```

---

### Task 19: Zustand state store + auto-save

**Files:**
- Create: `packages/ui/src/store/app-state.ts`
- Create: `packages/ui/src/store/undo.ts`
- Create: `packages/ui/src/hooks/useAutoSave.ts`

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter @bg-tax/ui add zustand react-router-dom @tauri-apps/api @tauri-apps/plugin-fs @tauri-apps/plugin-dialog`

- [ ] **Step 2: Implement Zustand store**

The store holds the full `AppState` plus actions: `setTaxYear`, `setBaseCurrency`, `setLanguage`, `addHoldings`, `addSales`, `addDividends`, `updateRow`, `deleteRow`, `setFxRates`, etc.

**Undo/redo scope:** Only manual table edits (add, edit, delete row) are undoable. CSV imports and FIFO processing are NOT undoable — to "undo" an import, the user re-imports or starts fresh.

- [ ] **Step 3: Implement undo middleware**

```typescript
// packages/ui/src/store/undo.ts
import type { StateCreator, StoreMutatorIdentifier } from 'zustand';

interface UndoDiff {
  path: string;       // e.g., "holdings.3.quantity"
  oldValue: unknown;
  newValue: unknown;
}

interface UndoState {
  undoStack: UndoDiff[][];  // Each entry is a batch of diffs from one action
  redoStack: UndoDiff[][];
  undo: () => void;
  redo: () => void;
}

const MAX_UNDO = 100;

// Zustand middleware — wraps actions like updateRow/deleteRow to capture diffs
// Implementation: compare state snapshots before/after action, store diff
// On undo: apply oldValues from the diff batch
// On redo: apply newValues from the diff batch
```

- [ ] **Step 4: Implement auto-save hook**

```typescript
// packages/ui/src/hooks/useAutoSave.ts
import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/app-state';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

const SAVE_FILENAME = 'bg-tax-autosave.json';
const DEBOUNCE_MS = 2000;

export function useAutoSave() {
  const state = useAppStore();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const json = JSON.stringify(state, null, 2);
        await writeTextFile(SAVE_FILENAME, json, { baseDir: BaseDirectory.AppData });
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [state]);
}

/** Load auto-saved state on app startup */
export async function loadAutoSave(): Promise<Record<string, unknown> | null> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const json = await readTextFile(SAVE_FILENAME, { baseDir: BaseDirectory.AppData });
    return JSON.parse(json);
  } catch {
    return null; // No auto-save file or parse error — start fresh
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Zustand state store with undo/redo and auto-save"
```

---

### Task 20: App layout + routing

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/main.tsx`

- [ ] **Step 1: Set up React Router**

4 routes: `/` (Year Setup), `/import` (Data Import), `/workspace` (Main Workspace), `/declaration` (Declaration Guide)

- [ ] **Step 2: Create basic layout with navigation**

Top bar with: app title, language toggle (EN/BG), step indicators (Setup → Import → Workspace → Declaration), Export Excel button (visible on workspace/declaration).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: app layout with React Router navigation"
```

---

## Chunk 9: UI Pages

### Task 21: Year Setup page

**Files:**
- Create: `packages/ui/src/pages/YearSetup.tsx`

- [ ] **Step 1: Implement Year Setup**

- Tax year selector (dropdown, defaults to current year - 1)
- Base currency display (auto: BGN for ≤2025, EUR for ≥2026, editable)
- Import previous holdings: 4 radio options (JSON import, Excel import, manual entry, start fresh)
- File picker for JSON/Excel import
- "Continue" button → navigates to `/import`

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: Year Setup page"
```

---

### Task 22: Import page

**Files:**
- Create: `packages/ui/src/pages/Import.tsx`
- Create: `packages/ui/src/components/FileDropZone.tsx`

- [ ] **Step 1: Implement drag & drop file zone**

Accept `.csv` files. Detect file type by header line (IB vs Revolut). Show list of imported files with status. "Process" button runs parsers, then FIFO engine, then FX fetch.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: Import page with drag & drop file upload"
```

---

### Task 23: Workspace page with tabbed data tables

**Files:**
- Create: `packages/ui/src/pages/Workspace.tsx`
- Create: `packages/ui/src/components/DataTable.tsx`
- Create: `packages/ui/src/components/TabBar.tsx`
- Create: `packages/ui/src/components/ValidationBadge.tsx`

- [ ] **Step 1: Add TanStack Table**

Run: `pnpm --filter @bg-tax/ui add @tanstack/react-table`

- [ ] **Step 2: Implement reusable DataTable component**

Editable cells (double-click to edit), sortable columns, add/delete row actions. Uses TanStack Table with column definitions passed as props.

- [ ] **Step 3: Implement Workspace with 6 tabs**

Holdings, Sales, Dividends, Stock Yield, Revolut Interest, FX Rates — each tab renders a DataTable with appropriate column definitions.

- [ ] **Step 4: Add validation badges**

Each tab shows a badge with warning count. Clicking a warning scrolls to the affected row.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Workspace with tabbed editable data tables"
```

---

### Task 24: Declaration Guide page

**Files:**
- Create: `packages/ui/src/pages/Declaration.tsx`
- Create: `packages/ui/src/components/DeclarationCard.tsx`

- [ ] **Step 1: Implement declaration cards**

Reads the form config JSON, computes values using TaxCalculator, displays cards per NRA form section. Each card shows field reference (e.g., "Ред 1, Кол. 4") with the calculated value.

- [ ] **Step 2: Add Export Excel button handler**

Calls `generateExcel(state)`, saves via Tauri file dialog.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: Declaration Guide page with form field mapping"
```

---

## Chunk 10: Integration + Polish

### Task 25: Wire everything together

- [ ] **Step 1: End-to-end integration test in core**

Test that: parse IB CSV → FIFO engine → tax calculator → declaration mapper produces correct results for the minimal fixture.

- [ ] **Step 2: Verify Excel round-trip**

Generate Excel from fixture data, read it back, verify formulas are present and values are correct.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: end-to-end integration test"
```

---

### Task 26: Final polish

- [ ] **Step 1: Add keyboard shortcuts**

Ctrl+Z / Ctrl+Shift+Z for undo/redo. Ctrl+S for manual save. Ctrl+E for export.

- [ ] **Step 2: Add loading states and error toasts**

Show spinner during FX rate fetching. Toast notifications for: import success, export success, ECB API failure.

- [ ] **Step 3: Basic styling**

Clean, functional UI. No heavy design — just readable tables, clear navigation.

- [ ] **Step 4: Update barrel exports in packages/core/src/index.ts**

Ensure all public APIs are exported.

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "feat: keyboard shortcuts, toasts, and polish"
```
