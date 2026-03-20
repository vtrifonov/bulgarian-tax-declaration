# E*TRADE Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an E*TRADE (Morgan Stanley) provider that parses quarterly PDF client statements to extract holdings, MMF interest, cash balances, and trades for Bulgarian tax declaration.

**Architecture:** The provider follows the existing BrokerProvider pattern but introduces binary file support via a union `FileHandler = TextFileHandler | BinaryFileHandler`. PDF text extraction uses `pdf-parse`, then regex-based section parsing extracts structured data. The UI Import page is extended to handle binary (PDF) files alongside existing CSV text files.

**Tech Stack:** TypeScript, pdf-parse, Vitest, React (Import.tsx)

**Spec:** `docs/superpowers/specs/2026-03-20-etrade-provider-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/core/src/providers/types.ts` | Add `TextFileHandler`, `BinaryFileHandler` union, `isTextHandler`/`isBinaryHandler` type guards |
| Modify | `packages/core/src/providers/ib.ts` | Add `kind: 'text'` to existing handler |
| Modify | `packages/core/src/providers/revolut.ts` | Add `kind: 'text'` to existing handlers |
| Create | `packages/core/src/parsers/etrade-pdf.ts` | PDF text extraction + section parsers |
| Create | `packages/core/src/parsers/__tests__/etrade-pdf.test.ts` | Parser unit tests |
| Create | `packages/core/src/providers/etrade.ts` | BrokerProvider definition |
| Modify | `packages/core/src/providers/registry.ts` | Register E*TRADE provider |
| Modify | `packages/core/src/index.ts` | Export new parser + updated types |
| Modify | `packages/core/package.json` | Add `pdf-parse` dependency |
| Modify | `packages/core/src/i18n/en.ts` | E*TRADE export instruction strings (EN) |
| Modify | `packages/core/src/i18n/bg.ts` | E*TRADE export instruction strings (BG) |
| Modify | `packages/ui/src/store/app-state.ts` | Add `'etrade'` to ImportedFile type union |
| Modify | `packages/ui/src/pages/Import.tsx` | Binary file detection, E*TRADE import flow, file badge |
| Modify | `AGENTS.md` | Document E*TRADE provider, pre-existing holdings pattern |
| Modify | `README.md` | Add E*TRADE to supported data sources |

---

### Task 1: Refactor FileHandler to Union Types

**Files:**
- Modify: `packages/core/src/providers/types.ts`
- Modify: `packages/core/src/providers/ib.ts`
- Modify: `packages/core/src/providers/revolut.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update `types.ts` — add union FileHandler type**

Replace the current `FileHandler` interface with a union of `TextFileHandler` and `BinaryFileHandler`:

```typescript
import type { BrokerProviderResult } from './types.js';

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

export function isTextHandler(h: FileHandler): h is TextFileHandler {
    return h.kind === 'text';
}

export function isBinaryHandler(h: FileHandler): h is BinaryFileHandler {
    return h.kind === 'binary';
}
```

Keep `BrokerProvider`, `BrokerProviderResult`, and `ExportInstruction` unchanged.

- [ ] **Step 2: Update `ib.ts` — add `kind: 'text'`**

In the IB provider's single file handler, add `kind: 'text' as const`:

```typescript
fileHandlers: [
    {
        id: 'ib-activity',
        kind: 'text' as const,
        detectFile(content: string): boolean { ... },
        parseFile(content: string): BrokerProviderResult { ... },
    },
],
```

- [ ] **Step 3: Update `revolut.ts` — add `kind: 'text'` to all 3 handlers**

Add `kind: 'text' as const` to each of the 3 Revolut file handlers (`revolut-savings`, `revolut-investments`, `revolut-account`).

- [ ] **Step 4: Update `index.ts` — export new type guards**

Add to the existing exports from `providers/types.js`:

```typescript
export type {
    BinaryFileHandler,
    BrokerProvider,
    BrokerProviderResult,
    ExportInstruction,
    FileHandler,
    TextFileHandler,
} from './providers/types.js';
export { isBinaryHandler, isTextHandler } from './providers/types.js';
```

- [ ] **Step 5: Run tests to verify nothing broke**

Run: `pnpm --filter @bg-tax/core test`
Expected: All existing tests pass (no behavior change, just type additions)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/providers/types.ts packages/core/src/providers/ib.ts packages/core/src/providers/revolut.ts packages/core/src/index.ts
git commit -m "refactor: make FileHandler a union of TextFileHandler and BinaryFileHandler"
```

---

### Task 2: Add `pdf-parse` Dependency

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install pdf-parse**

Run: `pnpm --filter @bg-tax/core add pdf-parse`

- [ ] **Step 2: Add type declaration (pdf-parse has no @types)**

Create a minimal type declaration at `packages/core/src/types/pdf-parse.d.ts`:

```typescript
declare module 'pdf-parse' {
    interface PDFData {
        numpages: number;
        numrender: number;
        info: Record<string, unknown>;
        metadata: unknown;
        text: string;
        version: string;
    }

    function pdfParse(dataBuffer: Buffer | ArrayBuffer): Promise<PDFData>;

    export = pdfParse;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/types/pdf-parse.d.ts
git commit -m "chore: add pdf-parse dependency for E*TRADE PDF parsing"
```

---

### Task 3: Implement E*TRADE PDF Parser — Section Detection & Period Extraction

**Files:**
- Create: `packages/core/src/parsers/etrade-pdf.ts`
- Create: `packages/core/src/parsers/__tests__/etrade-pdf.test.ts`

- [ ] **Step 1: Write failing tests for `extractPeriod`**

Create `packages/core/src/parsers/__tests__/etrade-pdf.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { extractPeriod } from '../etrade-pdf.js';

describe('extractPeriod', () => {
    it('extracts quarterly period dates', () => {
        const text = 'CLIENT STATEMENT For the Period January 1- March 31, 2025 E*TRADE';
        const result = extractPeriod(text);
        expect(result).toEqual({ startDate: '2025-01-01', endDate: '2025-03-31', year: 2025 });
    });

    it('extracts annual period dates', () => {
        const text = 'CLIENT STATEMENT For the Period January 1- December 31, 2025';
        const result = extractPeriod(text);
        expect(result).toEqual({ startDate: '2025-01-01', endDate: '2025-12-31', year: 2025 });
    });

    it('returns null for non-E*TRADE text', () => {
        const text = 'Some random document text';
        const result = extractPeriod(text);
        expect(result).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bg-tax/core test -- --reporter=verbose etrade-pdf`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `extractPeriod` in `etrade-pdf.ts`**

Create `packages/core/src/parsers/etrade-pdf.ts`:

```typescript
export interface EtradePeriod {
    startDate: string;  // YYYY-MM-DD
    endDate: string;    // YYYY-MM-DD
    year: number;
}

const MONTH_MAP: Record<string, string> = {
    January: '01', February: '02', March: '03', April: '04',
    May: '05', June: '06', July: '07', August: '08',
    September: '09', October: '10', November: '11', December: '12',
};

export function extractPeriod(text: string): EtradePeriod | null {
    // Pattern: "For the Period January 1- March 31, 2025"
    const match = text.match(
        /For the Period\s+(\w+)\s+(\d{1,2})-\s*(\w+)\s+(\d{1,2}),\s*(\d{4})/,
    );
    if (!match) return null;

    const [, startMonth, startDay, endMonth, endDay, yearStr] = match;
    const year = parseInt(yearStr, 10);
    const sm = MONTH_MAP[startMonth];
    const em = MONTH_MAP[endMonth];
    if (!sm || !em) return null;

    return {
        startDate: `${year}-${sm}-${startDay.padStart(2, '0')}`,
        endDate: `${year}-${em}-${endDay.padStart(2, '0')}`,
        year,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bg-tax/core test -- --reporter=verbose etrade-pdf`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/etrade-pdf.ts packages/core/src/parsers/__tests__/etrade-pdf.test.ts
git commit -m "feat(etrade): add PDF period extraction parser"
```

---

### Task 4: Implement Holdings Parser

**Files:**
- Modify: `packages/core/src/parsers/etrade-pdf.ts`
- Modify: `packages/core/src/parsers/__tests__/etrade-pdf.test.ts`

- [ ] **Step 1: Write failing test for `parseHoldings`**

Add to the test file:

```typescript
import { parseHoldings } from '../etrade-pdf.js';

describe('parseHoldings', () => {
    it('parses common stock holdings', () => {
        const text = `STOCKS
COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value Unrealized
Gain/(Loss) Est Ann Income Current
Yield %
PROGRESS SOFTWARE (PRGS) 829.000 $51.510 $19,838.49 $42,701.79 $22,863.30 $580.30 1.36
829.000 shs from Stock Plan; Asset Class: Equities`;
        const result = parseHoldings(text);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            symbol: 'PRGS',
            currency: 'USD',
            quantity: 829,
            costPrice: expect.closeTo(23.93, 1),
        });
    });

    it('returns empty array when no holdings section', () => {
        const text = 'Some other section text';
        expect(parseHoldings(text)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bg-tax/core test -- --reporter=verbose etrade-pdf`
Expected: FAIL

- [ ] **Step 3: Implement `parseHoldings`**

Add to `etrade-pdf.ts`:

```typescript
import type { IBOpenPosition } from '../types/index.js';

export function parseHoldings(text: string): IBOpenPosition[] {
    const holdings: IBOpenPosition[] = [];

    // Find COMMON STOCKS section
    const stocksIdx = text.indexOf('COMMON STOCKS');
    if (stocksIdx === -1) return holdings;

    // Extract the section text (until next major section or end)
    const sectionText = text.slice(stocksIdx);

    // Match stock lines: "NAME (TICKER) quantity price totalCost marketValue ..."
    // The ticker is in parentheses, followed by numeric values
    const stockRegex = /([A-Z][A-Z\s]+?)\s*\(([A-Z]+)\)\s+([\d,.]+)\s+\$([\d,.]+)\s+\$([\d,.]+)\s+\$([\d,.]+)/g;
    let match;

    while ((match = stockRegex.exec(sectionText)) !== null) {
        const quantity = parseFloat(match[3].replace(/,/g, ''));
        const totalCost = parseFloat(match[5].replace(/,/g, ''));

        holdings.push({
            symbol: match[2],
            currency: 'USD',
            quantity,
            costPrice: totalCost / quantity,
        });
    }

    return holdings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bg-tax/core test -- --reporter=verbose etrade-pdf`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/etrade-pdf.ts packages/core/src/parsers/__tests__/etrade-pdf.test.ts
git commit -m "feat(etrade): add holdings parser for COMMON STOCKS section"
```

---

### Task 5: Implement Interest (MMF Dividend) Parser

**Files:**
- Modify: `packages/core/src/parsers/etrade-pdf.ts`
- Modify: `packages/core/src/parsers/__tests__/etrade-pdf.test.ts`

- [ ] **Step 1: Write failing test for `parseInterest`**

```typescript
import { parseInterest } from '../etrade-pdf.js';

describe('parseInterest', () => {
    it('parses MMF dividend entries as interest', () => {
        const text = `CASH FLOW ACTIVITY BY DATE
Activity Settlement
Date Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend TREASURY LIQUIDITY FUND Transaction Reportable for the Prior Year. $16.45
2/3 Dividend TREASURY LIQUIDITY FUND
DIV PAYMENT 15.85
3/3 Dividend TREASURY LIQUIDITY FUND
DIV PAYMENT 14.26`;
        const result = parseInterest(text, 2025);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({
            date: '2025-01-02',
            amount: 16.45,
            currency: 'USD',
            description: 'TREASURY LIQUIDITY FUND',
        });
        expect(result[1].date).toBe('2025-02-03');
        expect(result[1].amount).toBe(15.85);
        expect(result[2].date).toBe('2025-03-03');
        expect(result[2].amount).toBe(14.26);
    });

    it('returns empty array when no activity section', () => {
        expect(parseInterest('No activity here', 2025)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bg-tax/core test -- --reporter=verbose etrade-pdf`
Expected: FAIL

- [ ] **Step 3: Implement `parseInterest`**

Add to `etrade-pdf.ts`:

```typescript
import type { InterestEntry } from '../types/index.js';

/** Entries where description matches these patterns are treated as interest (MMF distributions) */
const MMF_PATTERNS = ['LIQUIDITY FUND', 'MONEY MARKET', 'MMF'];

function isMMFDistribution(description: string): boolean {
    const upper = description.toUpperCase();
    return MMF_PATTERNS.some(p => upper.includes(p));
}

export function parseInterest(text: string, year: number): Omit<InterestEntry, 'source'>[] {
    const entries: Omit<InterestEntry, 'source'>[] = [];

    const activityIdx = text.indexOf('CASH FLOW ACTIVITY BY DATE');
    if (activityIdx === -1) return entries;

    const sectionText = text.slice(activityIdx);

    // Match dividend activity lines: "M/D  Dividend  DESCRIPTION  amount"
    // Amount may have $ prefix and commas, or be plain number
    const lineRegex = /(\d{1,2})\/(\d{1,2})\s+Dividend\s+(.+?)\s+\$?([\d,.]+)\s*$/gm;
    let match;

    while ((match = lineRegex.exec(sectionText)) !== null) {
        const [, month, day, description, amountStr] = match;
        const cleanDesc = description
            .replace(/Transaction Reportable.*$/i, '')
            .replace(/DIV PAYMENT/i, '')
            .trim();

        if (!isMMFDistribution(cleanDesc)) continue;

        const mm = month.padStart(2, '0');
        const dd = day.padStart(2, '0');

        entries.push({
            date: `${year}-${mm}-${dd}`,
            amount: parseFloat(amountStr.replace(/,/g, '')),
            currency: 'USD',
            description: cleanDesc,
        });
    }

    return entries;
}
```

Note: The actual regex may need adjustment after testing against real pdf-parse output. The implementation should be refined during development to match the actual text extraction format.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bg-tax/core test -- --reporter=verbose etrade-pdf`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/etrade-pdf.ts packages/core/src/parsers/__tests__/etrade-pdf.test.ts
git commit -m "feat(etrade): add MMF interest parser from CASH FLOW ACTIVITY section"
```

---

### Task 6: Implement Cash Balance Parser

**Files:**
- Modify: `packages/core/src/parsers/etrade-pdf.ts`
- Modify: `packages/core/src/parsers/__tests__/etrade-pdf.test.ts`

- [ ] **Step 1: Write failing test for `parseCashBalance`**

```typescript
import { parseCashBalance } from '../etrade-pdf.js';

describe('parseCashBalance', () => {
    it('parses balance sheet cash values', () => {
        const text = `BALANCE SHEET (^ includes accrued interest)
Last Period This Period
(as of 12/31/24) (as of 3/31/25)
Cash, BDP, MMFs $4,645.52 $4,692.08
Stocks 54,009.35 42,701.79
Total Assets $58,654.87 $47,393.87`;
        const result = parseCashBalance(text);
        expect(result).toEqual({
            amountStartOfYear: 4645.52,
            amountEndOfYear: 4692.08,
        });
    });

    it('returns null when no balance sheet section', () => {
        expect(parseCashBalance('No balance here')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `parseCashBalance`**

```typescript
export interface CashBalance {
    amountStartOfYear: number;
    amountEndOfYear: number;
}

export function parseCashBalance(text: string): CashBalance | null {
    const idx = text.indexOf('BALANCE SHEET');
    if (idx === -1) return null;

    const sectionText = text.slice(idx);

    // Match "Cash, BDP, MMFs  $X,XXX.XX  $X,XXX.XX"
    const cashMatch = sectionText.match(
        /Cash,\s*BDP,\s*MMFs\s+\$?([\d,.]+)\s+\$?([\d,.]+)/,
    );
    if (!cashMatch) return null;

    return {
        amountStartOfYear: parseFloat(cashMatch[1].replace(/,/g, '')),
        amountEndOfYear: parseFloat(cashMatch[2].replace(/,/g, '')),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/etrade-pdf.ts packages/core/src/parsers/__tests__/etrade-pdf.test.ts
git commit -m "feat(etrade): add cash balance parser from BALANCE SHEET section"
```

---

### Task 7: Implement Main `parseEtradePdf` Orchestrator

**Files:**
- Modify: `packages/core/src/parsers/etrade-pdf.ts`
- Modify: `packages/core/src/parsers/__tests__/etrade-pdf.test.ts`

- [ ] **Step 1: Write failing test for `parseEtradePdf`**

```typescript
import { parseEtradePdf } from '../etrade-pdf.js';

describe('parseEtradePdf', () => {
    it('orchestrates all section parsers from full PDF text', () => {
        // Use a combined text fixture that includes all sections
        const fullText = `CLIENT STATEMENT For the Period January 1- March 31, 2025
E*TRADE from Morgan Stanley
...
BALANCE SHEET (^ includes accrued interest)
Last Period This Period
(as of 12/31/24) (as of 3/31/25)
Cash, BDP, MMFs $4,645.52 $4,692.08
Stocks 54,009.35 42,701.79
...
COMMON STOCKS
Security Description Quantity Share Price Total Cost Market Value Unrealized Gain/(Loss) Est Ann Income Current Yield %
PROGRESS SOFTWARE (PRGS) 829.000 $51.510 $19,838.49 $42,701.79 $22,863.30 $580.30 1.36
...
CASH FLOW ACTIVITY BY DATE
Activity Settlement
Date Date Activity Type Description Comments Quantity Price Credits/(Debits)
1/2 Dividend TREASURY LIQUIDITY FUND Transaction Reportable for the Prior Year. $16.45
2/3 Dividend TREASURY LIQUIDITY FUND DIV PAYMENT 15.85`;

        const result = parseEtradePdf(fullText);

        expect(result.openPositions).toHaveLength(1);
        expect(result.openPositions![0].symbol).toBe('PRGS');

        expect(result.interest).toHaveLength(2);
        expect(result.interest![0].amount).toBe(16.45);

        expect(result.foreignAccounts).toHaveLength(1);
        expect(result.foreignAccounts![0].amountStartOfYear).toBe(4645.52);
        expect(result.foreignAccounts![0].amountEndOfYear).toBe(4692.08);
        expect(result.foreignAccounts![0].broker).toBe('E*TRADE');
        expect(result.foreignAccounts![0].country).toBe('US');
        expect(result.foreignAccounts![0].type).toBe('03');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `parseEtradePdf`**

```typescript
import type { BrokerProviderResult } from '../providers/types.js';

export function parseEtradePdf(text: string): BrokerProviderResult {
    const warnings: string[] = [];

    const period = extractPeriod(text);
    if (!period) {
        warnings.push('Could not detect statement period');
    }

    const year = period?.year ?? new Date().getFullYear();
    const holdings = parseHoldings(text);
    const interestEntries = parseInterest(text, year);
    const cashBalance = parseCashBalance(text);

    // Build interest as InterestEntry[] (source field is NOT set here — the UI handler adds it)
    const interest: InterestEntry[] = interestEntries.map(e => ({
        currency: e.currency,
        date: e.date,
        amount: e.amount,
        description: e.description,
    }));

    // Build foreign account balance
    const foreignAccounts = cashBalance
        ? [{
            broker: 'E*TRADE',
            type: '03' as const,
            maturity: 'L' as const,
            country: 'US',
            currency: 'USD',
            amountStartOfYear: cashBalance.amountStartOfYear,
            amountEndOfYear: cashBalance.amountEndOfYear,
        }]
        : [];

    return {
        openPositions: holdings,
        interest,
        foreignAccounts,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/etrade-pdf.ts packages/core/src/parsers/__tests__/etrade-pdf.test.ts
git commit -m "feat(etrade): add main parseEtradePdf orchestrator"
```

---

### Task 8: Create E*TRADE Provider & Register It

**Files:**
- Create: `packages/core/src/providers/etrade.ts`
- Modify: `packages/core/src/providers/registry.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `etrade.ts` provider**

```typescript
import pdfParse from 'pdf-parse';
import type { BrokerProvider } from './types.js';
import { parseEtradePdf } from '../parsers/etrade-pdf.js';

export const etradeProvider: BrokerProvider = {
    name: 'E*TRADE',
    fileHandlers: [
        {
            id: 'etrade-statement',
            kind: 'binary' as const,
            detectBinary(_buffer: ArrayBuffer, filename: string): boolean {
                return filename.toLowerCase().endsWith('.pdf')
                    && filename.toLowerCase().includes('clientstatement');
            },
            async parseBinary(buffer: ArrayBuffer) {
                const data = await pdfParse(Buffer.from(buffer));
                return parseEtradePdf(data.text);
            },
        },
    ],
    exportInstructions: [
        {
            label: 'provider.etrade.instructions.statement.label',
            steps: [
                'provider.etrade.instructions.statement.step1',
                'provider.etrade.instructions.statement.step2',
                'provider.etrade.instructions.statement.step3',
                'provider.etrade.instructions.statement.step4',
            ],
        },
    ],
};
```

- [ ] **Step 2: Register in `registry.ts`**

```typescript
import { etradeProvider } from './etrade.js';
import { ibProvider } from './ib.js';
import { revolutProvider } from './revolut.js';
import type { BrokerProvider } from './types.js';

export const providers: BrokerProvider[] = [ibProvider, revolutProvider, etradeProvider];
```

- [ ] **Step 3: Export parser from `index.ts`**

Add to `packages/core/src/index.ts`:

```typescript
export { parseEtradePdf } from './parsers/etrade-pdf.js';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bg-tax/core test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/etrade.ts packages/core/src/providers/registry.ts packages/core/src/index.ts
git commit -m "feat(etrade): create E*TRADE provider and register it"
```

---

### Task 9: Add i18n Strings

**Files:**
- Modify: `packages/core/src/i18n/en.ts`
- Modify: `packages/core/src/i18n/bg.ts`

- [ ] **Step 1: Add English strings**

Add after the Revolut instructions block in `en.ts`:

```typescript
'provider.etrade.instructions.statement.label': 'E*TRADE (Morgan Stanley)',
'provider.etrade.instructions.statement.step1': 'Log in to your E*TRADE account at www.etrade.com',
'provider.etrade.instructions.statement.step2': 'Go to Accounts → Documents → Statements',
'provider.etrade.instructions.statement.step3': 'Select the tax year and download quarterly or annual Client Statements (PDF)',
'provider.etrade.instructions.statement.step4': 'Import all quarterly PDF files (or the annual statement) here',
```

- [ ] **Step 2: Add Bulgarian strings**

Add after the Revolut instructions block in `bg.ts`:

```typescript
'provider.etrade.instructions.statement.label': 'E*TRADE (Morgan Stanley)',
'provider.etrade.instructions.statement.step1': 'Влезте в E*TRADE акаунта си на www.etrade.com',
'provider.etrade.instructions.statement.step2': 'Отидете на Accounts → Documents → Statements',
'provider.etrade.instructions.statement.step3': 'Изберете данъчната година и изтеглете тримесечни или годишни Client Statements (PDF)',
'provider.etrade.instructions.statement.step4': 'Импортирайте всички тримесечни PDF файлове (или годишния отчет) тук',
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/i18n/en.ts packages/core/src/i18n/bg.ts
git commit -m "feat(etrade): add i18n strings for E*TRADE export instructions"
```

---

### Task 10: Update UI — ImportedFile Type & File Input

**Files:**
- Modify: `packages/ui/src/store/app-state.ts`
- Modify: `packages/ui/src/pages/Import.tsx`

- [ ] **Step 1: Add `'etrade'` to ImportedFile type**

In `packages/ui/src/store/app-state.ts`, update the `type` field:

```typescript
export interface ImportedFile {
    name: string;
    type: 'ib' | 'revolut' | 'revolut-investments' | 'revolut-account' | 'etrade';
    status: 'success' | 'error';
    message?: string;
}
```

- [ ] **Step 2: Update file input to accept PDFs**

In `Import.tsx`, find the `<input>` element with `accept='.csv'` and change to:

```tsx
accept='.csv,.pdf'
```

- [ ] **Step 3: Update file type badge rendering**

In `Import.tsx`, find the file badge color/label ternary (around line 868) and update to include E*TRADE:

```tsx
backgroundColor: f.type === 'ib' ? 'var(--accent)'
    : f.type === 'revolut-investments' ? '#6f42c1'
    : f.type === 'etrade' ? '#ff6b35'
    : '#28a745',
```

And the label:

```tsx
{f.type === 'ib' ? 'IB'
    : f.type === 'revolut-investments' ? 'Revolut Inv.'
    : f.type === 'etrade' ? 'E*TRADE'
    : 'Revolut'}
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/store/app-state.ts packages/ui/src/pages/Import.tsx
git commit -m "feat(etrade): add E*TRADE file type to UI store and file input"
```

---

### Task 11: Update UI — Binary File Detection & E*TRADE Import Flow

**Files:**
- Modify: `packages/ui/src/pages/Import.tsx`

This is the largest UI change. The `processFile` callback needs to handle binary (PDF) files.

- [ ] **Step 1: Add binary file detection at the top of `processFile`**

At the start of `processFile`, before the existing `const content = await file.text()` line, add a binary file check:

```typescript
const processFile = useCallback(async (file: File) => {
    // Binary file path (PDF)
    if (file.name.toLowerCase().endsWith('.pdf')) {
        try {
            const buffer = await file.arrayBuffer();
            // Try E*TRADE detection
            const { providers } = await import('@bg-tax/core');
            const { isBinaryHandler } = await import('@bg-tax/core');

            for (const provider of providers) {
                for (const handler of provider.fileHandlers) {
                    if (isBinaryHandler(handler) && handler.detectBinary(buffer, file.name)) {
                        const result = await handler.parseBinary(buffer);
                        // Process E*TRADE result (see step 2)
                        await processEtradeResult(result, file, provider.name);
                        return;
                    }
                }
            }

            // No binary handler matched this PDF
            addImportedFile({
                name: file.name,
                type: 'etrade',
                status: 'error',
                message: 'Unrecognized PDF format. Only E*TRADE Client Statements (PDF) are currently supported.',
            });
            return;
        } catch (err) {
            addImportedFile({
                name: file.name,
                type: 'etrade',
                status: 'error',
                message: `PDF parse error: ${err instanceof Error ? err.message : String(err)}`,
            });
            return;
        }
    }

    // Existing text file path (CSV) — unchanged...
    const content = await file.text();
    // ... rest of existing code
```

- [ ] **Step 2: Add `processEtradeResult` helper function**

Add a helper function within the Import component (or as a local function) to handle E*TRADE-specific import logic:

```typescript
async function processEtradeResult(
    result: BrokerProviderResult,
    file: File,
    _brokerName: string,
) {
    const source = { type: 'E*TRADE', file: file.name };
    const { taxYear } = useAppStore.getState();

    // Interest (MMF distributions) — create new entries with source (don't mutate parser output)
    if (result.interest && result.interest.length > 0) {
        const entriesWithSource = result.interest.map(e => ({ ...e, source }));
        const etradeInterest = {
            broker: 'E*TRADE',
            currency: 'USD',
            entries: entriesWithSource,
        };
        // Replace existing E*TRADE interest, keep other brokers
        const existing = useAppStore.getState().brokerInterest.filter(bi => bi.broker !== 'E*TRADE');
        importBrokerInterest([...existing, etradeInterest]);
    }

    // Holdings (open positions)
    if (result.openPositions && result.openPositions.length > 0) {
        const hasPriorHoldings = useAppStore.getState().holdings.some(h => h.source?.type !== 'E*TRADE');
        const countryMap = await resolveCountries(
            result.openPositions.map(p => ({ symbol: p.symbol, currency: p.currency })),
            getCorsFetch(),
        );

        const newHoldings = splitOpenPositions(result.openPositions, [], {
            broker: 'E*TRADE',
            countryMap,
            source,
            taxYear,
            skipPreExisting: hasPriorHoldings,
        });

        // Replace E*TRADE holdings, keep others
        const existingNonEtrade = useAppStore.getState().holdings.filter(h => h.source?.type !== 'E*TRADE');
        importHoldings([...existingNonEtrade, ...newHoldings]);
    }

    // Foreign account balance (cash)
    if (result.foreignAccounts && result.foreignAccounts.length > 0) {
        const currentAccounts = useAppStore.getState().foreignAccounts ?? [];
        const filtered = currentAccounts.filter(a => a.broker !== 'E*TRADE');
        setForeignAccounts([...filtered, ...result.foreignAccounts]);
    }

    // Success message
    const parts = [];
    if (result.openPositions?.length) parts.push(`${result.openPositions.length} holdings`);
    if (result.interest?.length) parts.push(`${result.interest.length} interest entries`);
    if (result.foreignAccounts?.length) parts.push('cash balance');
    if (result.warnings?.length) parts.push(`${result.warnings.length} warnings`);

    addImportedFile({
        name: file.name,
        type: 'etrade',
        status: 'success',
        message: parts.join(', ') || 'No data found in statement',
    });
}
```

- [ ] **Step 3: Add necessary imports at top of Import.tsx**

Verify these are imported (add any missing ones):

```typescript
import {
    isBinaryHandler,
    providers,
    resolveCountries,
    splitOpenPositions,
    type BrokerProviderResult,
} from '@bg-tax/core';
```

`resolveCountries`, `splitOpenPositions`, and `providers` should already be imported for IB/Revolut usage — verify and add `isBinaryHandler` and `BrokerProviderResult` if missing. `getCorsFetch` is defined locally in Import.tsx (around line 34). `useAppStore` is already imported from `../store/app-state`.

- [ ] **Step 4: Verify the app runs**

Run: `pnpm --filter @bg-tax/ui dev:vite`
Test: Drop one of the E*TRADE PDF files into the import area. Verify it detects and parses.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/Import.tsx
git commit -m "feat(etrade): add binary PDF import flow in Import.tsx"
```

---

### Task 12: Validate Against Real PDFs

This task uses the actual E*TRADE PDF files to verify the parser works correctly.

**Files:**
- Possibly modify: `packages/core/src/parsers/etrade-pdf.ts` (regex tuning)

- [ ] **Step 1: Capture actual pdf-parse text output**

Write a quick script or use the running app to parse one real PDF and log the text output. Examine the output carefully to verify regex patterns match the actual text structure.

Run: `node -e "const p = require('pdf-parse'); const fs = require('fs'); p(fs.readFileSync('/Users/trifonov/Downloads/ClientStatements_2153_033125.pdf')).then(d => console.log(d.text))"`

(Adjust for ESM if needed.)

- [ ] **Step 2: Compare parser output against expected values**

For Q1 (Jan-Mar 2025), verify:
- Period: 2025-01-01 to 2025-03-31
- Holdings: PRGS, 829 shares, cost ~$19,838.49
- Interest: 3 entries ($16.45, $15.85, $14.26)
- Cash: start $4,645.52, end $4,692.08

- [ ] **Step 3: Fix any regex issues**

Adjust regex patterns in `etrade-pdf.ts` to match actual pdf-parse text output.

- [ ] **Step 4: Test with all 4 quarterly PDFs**

Run the app, import all 4 PDFs. Verify:
- 12 total interest entries across the year
- Holdings show latest quarter's values
- Cash balance from Q4: start $4,785.19, end $4,829.45

- [ ] **Step 5: Commit any fixes**

```bash
git add packages/core/src/parsers/etrade-pdf.ts packages/core/src/parsers/__tests__/etrade-pdf.test.ts
git commit -m "fix(etrade): tune regex patterns against real PDF output"
```

---

### Task 13: Update AGENTS.md and README.md

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: Update AGENTS.md**

Add to the architecture section (near line 26, after provider types guidance):

```markdown
- **Pre-existing holdings pattern**: When a provider imports holdings, if prior-year holdings already exist in the app state, only add new current-year acquisitions (skip pre-existing). This applies to all providers (IB, Revolut, E*TRADE). The `skipPreExisting` flag in `splitOpenPositions` controls this.
```

Update the test fixtures section to include PDF:

```markdown
- PDF test data: mock pdf-parse text output as string constants in test files (no binary fixtures)
```

Add E*TRADE to any provider lists or examples.

- [ ] **Step 2: Update README.md**

Update the description line (line 11) to include E*TRADE:

```markdown
Parses Interactive Brokers (trades, dividends, WHT, stock yield, interest), Revolut savings (interest per currency), Revolut investments (trades), and E*TRADE/Morgan Stanley (holdings, interest, cash balances from PDF statements). Calculates Bulgarian taxes using FIFO lot matching and exports a formatted Excel declaration.
```

Add E*TRADE to the project structure if there's a provider list.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: add E*TRADE provider to AGENTS.md and README.md"
```

---

### Task 14: Final Verification & Coverage Check

- [ ] **Step 1: Run full test suite**

Run: `pnpm --filter @bg-tax/core test`
Expected: All tests pass

- [ ] **Step 2: Check coverage**

Run: `pnpm --filter @bg-tax/core test:coverage`
Expected: E*TRADE parser module has ≥70% line coverage

- [ ] **Step 3: Fix any coverage gaps**

Add tests for uncovered branches if needed (empty input, malformed text, etc.)

- [ ] **Step 4: Run the full app**

Run: `pnpm --filter @bg-tax/ui dev:vite`
Test end-to-end: Import all 4 E*TRADE PDFs, verify data appears correctly in the app.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test(etrade): ensure ≥70% coverage for E*TRADE parser"
```
