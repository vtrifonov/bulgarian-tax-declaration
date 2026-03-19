# NRA Form Filler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate filling Приложение 8, Част III (foreign dividends) in the NRA portal using Playwright launched from the Tauri desktop app.

**Architecture:** A pure `buildNraFormRows()` function in `packages/core` transforms dividends into NRA form row objects. A standalone Playwright Node.js script (`scripts/nra-fill-form.mjs`) receives these rows via stdin and fills the NRA web form in a visible Chromium browser. A React hook (`useNraFiller`) manages the sidecar lifecycle, and a button on the Declaration page triggers it.

**Tech Stack:** TypeScript, Playwright, Tauri v2 plugin-shell, React, Zustand

**Spec:** `docs/superpowers/specs/2026-03-19-nra-form-filler-design.md`

---

## File Structure

```
packages/core/
├── src/nra/
│   └── form-data.ts              # buildNraFormRows() — pure function
├── src/index.ts                   # Add export for buildNraFormRows
└── tests/nra/
    └── form-data.test.ts          # Unit tests for buildNraFormRows

packages/ui/
├── src/hooks/
│   └── useNraFiller.ts            # Sidecar lifecycle hook
├── src/pages/
│   └── Declaration.tsx            # Add "Попълни в НАП" button (modify)
└── src-tauri/
    ├── capabilities/default.json  # Add shell permissions (modify)
    └── Cargo.toml                 # Add tauri-plugin-shell dep (modify)

scripts/
└── nra-fill-form.mjs             # Standalone Playwright sidecar script

tests/fixtures/
└── nra-form-mock.html             # Mock NRA form for Playwright tests
```

---

### Task 1: buildNraFormRows — Core Pure Function

**Files:**
- Create: `packages/core/src/nra/form-data.ts`
- Create: `packages/core/tests/nra/form-data.test.ts`
- Modify: `packages/core/src/index.ts`

This function reuses `calcDividendRowTax` from `packages/core/src/fx/convert.ts` (already exported). It transforms `Dividend[]` + `fxRates` + `baseCurrency` into `NraFormRow[]` — the same calculation as the existing `dividendsForDeclaration` memo in `Declaration.tsx:144-168` and `generateNraAppendix8Part3` in `packages/core/src/excel/nra-appendix8-part3.ts`, but returns JSON objects instead of Excel rows.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/nra/form-data.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildNraFormRows } from '../../src/nra/form-data.js';
import type { Dividend } from '../../src/types/index.js';

const mkDiv = (symbol: string, overrides?: Partial<Dividend>): Dividend => ({
    symbol,
    country: 'САЩ',
    date: '2025-06-15',
    currency: 'USD',
    grossAmount: 100,
    withholdingTax: 10,
    bgTaxDue: 0,
    whtCredit: 0,
    ...overrides,
});

const fxRates: Record<string, Record<string, number>> = {
    USD: { '2025-06-15': 1.80, '2025-03-10': 1.82 },
};

describe('buildNraFormRows', () => {
    it('transforms dividends into NRA form rows', () => {
        const rows = buildNraFormRows([mkDiv('AAPL')], fxRates, 'BGN');

        expect(rows).toHaveLength(1);
        expect(rows[0].rowLabel).toBe('1.1');
        expect(rows[0].name).toBe('AAPL');
        expect(rows[0].country).toBe('САЩ');
        expect(rows[0].incomeCode).toBe(8141);
        expect(rows[0].methodCode).toBe(1);
        expect(rows[0].acquisitionCost).toBe(0);
        expect(rows[0].difference).toBe(0);
        // grossAmount=100, fxRate=1.80, grossBase=180
        expect(rows[0].grossAmount).toBeCloseTo(180, 1);
        // wht=10, whtBase=18
        expect(rows[0].foreignTax).toBeCloseTo(18, 1);
        // 5% of 180 = 9
        expect(rows[0].allowedCredit).toBeCloseTo(9, 1);
        // min(18, 9) = 9
        expect(rows[0].recognizedCredit).toBeCloseTo(9, 1);
        // max(0, 9 - 18) = 0
        expect(rows[0].taxDue).toBeCloseTo(0, 1);
    });

    it('filters out dividends with zero or negative grossAmount', () => {
        const divs = [mkDiv('AAPL'), mkDiv('BAD', { grossAmount: 0 }), mkDiv('UGLY', { grossAmount: -5 })];
        const rows = buildNraFormRows(divs, fxRates, 'BGN');

        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('AAPL');
    });

    it('filters out dividends with empty symbol', () => {
        const rows = buildNraFormRows([mkDiv('')], fxRates, 'BGN');

        expect(rows).toHaveLength(0);
    });

    it('sorts by symbol then date', () => {
        const divs = [
            mkDiv('MSFT', { date: '2025-06-15' }),
            mkDiv('AAPL', { date: '2025-06-15' }),
            mkDiv('AAPL', { date: '2025-03-10' }),
        ];
        const rows = buildNraFormRows(divs, fxRates, 'BGN');

        expect(rows.map(r => r.name)).toEqual(['AAPL', 'AAPL', 'MSFT']);
        expect(rows.map(r => r.rowLabel)).toEqual(['1.1', '2.1', '3.1']);
    });

    it('returns empty array for empty dividends', () => {
        expect(buildNraFormRows([], fxRates, 'BGN')).toEqual([]);
    });

    it('handles Irish ETF with 0% WHT (full tax due)', () => {
        const divs = [mkDiv('CSPX', { country: 'Ирландия', withholdingTax: 0 })];
        const rows = buildNraFormRows(divs, fxRates, 'BGN');

        // 5% of gross, no WHT credit
        expect(rows[0].taxDue).toBeCloseTo(rows[0].allowedCredit, 2);
        expect(rows[0].recognizedCredit).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bg-tax/core exec vitest run tests/nra/form-data.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/nra/form-data.ts`:

```typescript
import { calcDividendRowTax } from '../fx/convert.js';
import type { BaseCurrency, Dividend } from '../types/index.js';

export interface NraFormRow {
    rowLabel: string;
    name: string;
    country: string;
    incomeCode: number;
    methodCode: number;
    grossAmount: number;
    acquisitionCost: number;
    difference: number;
    foreignTax: number;
    allowedCredit: number;
    recognizedCredit: number;
    taxDue: number;
}

export function buildNraFormRows(
    dividends: Dividend[],
    fxRates: Record<string, Record<string, number>>,
    baseCurrency: BaseCurrency,
): NraFormRow[] {
    const sorted = dividends
        .filter(d => d.symbol && d.grossAmount > 0)
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));

    return sorted.map((d, i) => {
        const { grossBase, whtBase, tax5pct, bgTaxDue } = calcDividendRowTax(
            d.grossAmount,
            d.withholdingTax,
            d.currency,
            d.date,
            baseCurrency,
            fxRates,
        );

        return {
            rowLabel: `${i + 1}.1`,
            name: d.symbol,
            country: d.country,
            incomeCode: 8141,
            methodCode: 1,
            grossAmount: Math.round(grossBase * 100) / 100,
            acquisitionCost: 0,
            difference: 0,
            foreignTax: Math.round(whtBase * 100) / 100,
            allowedCredit: Math.round(tax5pct * 100) / 100,
            recognizedCredit: Math.round(Math.min(whtBase, tax5pct) * 100) / 100,
            taxDue: Math.round(bgTaxDue * 100) / 100,
        };
    });
}
```

- [ ] **Step 4: Export from core index**

Add to `packages/core/src/index.ts` after the existing `generateNraAppendix8Part3` export:

```typescript
export { buildNraFormRows } from './nra/form-data.js';
export type { NraFormRow } from './nra/form-data.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @bg-tax/core exec vitest run tests/nra/form-data.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Run full core test suite**

Run: `pnpm --filter @bg-tax/core test`
Expected: All tests pass, coverage >= 70%

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/nra/form-data.ts packages/core/tests/nra/form-data.test.ts packages/core/src/index.ts
git commit -m "feat: add buildNraFormRows for NRA form filler"
```

---

### Task 2: Playwright Sidecar Script

**Files:**
- Create: `scripts/nra-fill-form.mjs`
- Create: `tests/fixtures/nra-form-mock.html`
- Modify: `package.json` (add playwright devDependency)

This is a standalone Node.js ESM script that:
1. Reads NraFormRow[] JSON from stdin
2. Launches headed Chromium via Playwright
3. Polls for the NRA form (Приложение 8, Част III)
4. Shows confirmation overlay
5. Fills rows one by one
6. Reports progress via stdout JSON lines

- [ ] **Step 1: Add playwright dependency**

Run: `pnpm add -Dw playwright`

Note: This adds Playwright to the root workspace devDependencies. The Chromium browser binary is installed separately via `npx playwright install chromium`.

- [ ] **Step 2: Create the NRA form mock HTML fixture**

Create `tests/fixtures/nra-form-mock.html` — a minimal HTML page mimicking the NRA Приложение 8 Част III form structure. This is used for automated testing of the filling algorithm.

```html
<!DOCTYPE html>
<html lang="bg">
<head><meta charset="utf-8"><title>NRA Form Mock</title></head>
<body>
<h2>Част III – Определяне на дължимия окончателен данък по чл. 38 от ЗДДФЛ за доходи от източници в чужбина на местни физически лица</h2>
<table id="dividendTable">
  <thead>
    <tr>
      <th>№</th><th>Наименование</th><th>Държава</th><th>Код Вид доход</th>
      <th>Код за прилагане на метод</th><th>Брутен размер</th><th>Цена на придобиване</th>
      <th>Положителна разлика</th><th>Платен данък в чужбина</th>
      <th>Допустим размер на данъчния кредит</th><th>Размер на признатия данъчен кредит</th>
      <th>Дължим данък</th>
    </tr>
    <tr><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th>10</th><th>11</th><th>12</th></tr>
  </thead>
  <tbody id="rows"></tbody>
</table>
<button id="addRow">Добави нов ред &gt;&gt;</button>

<script>
let rowCount = 0;
document.getElementById('addRow').addEventListener('click', () => {
    rowCount++;
    const tbody = document.getElementById('rows');
    const tr = document.createElement('tr');
    tr.id = `row-${rowCount}`;
    tr.innerHTML = `
        <td>${rowCount}.1</td>
        <td><input type="text" name="name_${rowCount}" /></td>
        <td><select name="country_${rowCount}">
            <option value=""></option>
            <option value="САЩ">САЩ</option>
            <option value="Германия">Германия</option>
            <option value="Ирландия">Ирландия</option>
            <option value="Великобритания">Великобритания</option>
            <option value="Хонконг">Хонконг</option>
        </select></td>
        <td><select name="code_${rowCount}">
            <option value="">--</option>
            <option value="8141">8141</option>
            <option value="8142">8142</option>
            <option value="815">815</option>
        </select></td>
        <td><select name="method_${rowCount}">
            <option value="">--</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
        </select></td>
        <td><input type="text" name="gross_${rowCount}" value="0.00" /></td>
        <td><input type="text" name="cost_${rowCount}" value="0.00" /></td>
        <td><input type="text" name="diff_${rowCount}" value="0.00" /></td>
        <td><input type="text" name="foreignTax_${rowCount}" value="0.00" /></td>
        <td><input type="text" name="allowed_${rowCount}" value="0.00" /></td>
        <td><input type="text" name="recognized_${rowCount}" value="0.00" /></td>
        <td><input type="text" name="taxDue_${rowCount}" value="0.00" /></td>
    `;
    tbody.appendChild(tr);
});
</script>
</body>
</html>
```

- [ ] **Step 3: Create the sidecar script**

Create `scripts/nra-fill-form.mjs`. This is a large file — key sections:

**Input reading + normalization helpers:**
```javascript
import { chromium } from 'playwright';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Read input from file passed as first argument (avoids stdin EOF issues with Tauri shell)
// Usage: node scripts/nra-fill-form.mjs /path/to/input.json [--dry-run]
const inputFile = process.argv[2];
if (!inputFile || inputFile.startsWith('--')) {
    console.error('Usage: node nra-fill-form.mjs <input.json> [--dry-run]');
    process.exit(1);
}
const input = readFileSync(inputFile, 'utf-8');
const { rows, countryMappings = {}, signalFile } = JSON.parse(input);
// rows: NraFormRow[], countryMappings: Record<string, string>, signalFile: string
// Clean up input file immediately
try { unlinkSync(inputFile); } catch {}

const dryRun = process.argv.includes('--dry-run');

/** Normalize text for matching: trim + lowercase */
function normalize(s) { return s.trim().toLowerCase(); }

/** Match a country name against <select> options with normalization */
async function matchCountry(selectEl, page, targetText) {
    const normalized = normalize(targetText);
    return page.evaluate(({ sel, target }) => {
        for (const opt of document.querySelector(sel)?.options || []) {
            if (opt.text.trim().toLowerCase() === target) return opt.value;
        }
        return null;
    }, { sel: selectEl, target: normalized });
}
```

**Browser launch + form detection polling:**
```javascript
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('about:blank');
emit({ type: 'status', message: 'browser_launched' });
emit({ type: 'status', message: 'waiting_for_form' });

// Poll for form detection OR signal file (manual trigger from app)
// Signal file is checked both here AND during the confirmation overlay wait,
// allowing "fill now" to bypass both detection and confirmation.
const FORM_HEADER = 'Определяне на дължимия окончателен данък по чл. 38 от ЗДДФЛ';

function checkSignalFile() {
    if (signalFile && existsSync(signalFile)) {
        try { unlinkSync(signalFile); } catch {}
        return true;
    }
    return false;
}

let formFound = false;
for (let attempt = 0; attempt < 300 && !formFound; attempt++) {
    if (checkSignalFile()) { formFound = true; break; }
    formFound = await page.evaluate((header) => {
        return document.body?.innerText?.includes(header) ?? false;
    }, FORM_HEADER).catch(() => false);
    if (!formFound) await page.waitForTimeout(2000);
}

// Cleanup signal file on exit
process.on('exit', () => {
    if (signalFile) try { unlinkSync(signalFile); } catch {}
});
```

**Confirmation overlay:**
```javascript
if (formFound) {
    emit({ type: 'status', message: 'form_detected' });
    await page.evaluate((count, preview) => {
        const overlay = document.createElement('div');
        overlay.id = '__nra_filler_overlay';
        overlay.innerHTML = `
            <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center">
                <div style="background:#fff;padding:24px;border-radius:8px;max-width:500px;font-family:sans-serif">
                    <h3 style="margin-top:0">Данъчна декларация — Дивиденти</h3>
                    <p>Готови за попълване: <strong>${count} реда</strong></p>
                    <p style="color:#666;font-size:14px">${preview}</p>
                    <div style="display:flex;gap:8px;margin-top:16px">
                        <button onclick="window.__nraFillerAction='fill'" style="padding:8px 20px;background:#28a745;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px">▶ Попълни</button>
                        <button onclick="window.__nraFillerAction='cancel'" style="padding:8px 20px;background:#6c757d;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px">✕ Отказ</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.__nraFillerAction = 'cancel';
        });
    }, rows.length, rows.slice(0, 3).map(r => `${r.name} (${r.country})`).join(', ') + '...');
    // Poll for user action (overlay button OR signal file from app)
    let action = null;
    while (!action) {
        if (checkSignalFile()) { action = 'fill'; break; }
        action = await page.evaluate(() => window.__nraFillerAction).catch(() => null);
        if (!action) await page.waitForTimeout(500);
    }
    // Remove overlay
    await page.evaluate(() => document.getElementById('__nra_filler_overlay')?.remove());
}
```

**Row filling with country fallback:**
```javascript
async function fillRows(page, rows, countryMappings) {
    // Detect decimal separator from existing form values (NRA form shows "0.00" placeholders)
    // Bulgarian Windows locale may use comma, but NRA form itself uses period.
    // Detect at runtime from the form's existing numeric inputs.
    const decSep = await page.evaluate(() => {
        const input = document.querySelector('input[value*="0.00"], input[value*="0,00"]');
        if (input?.value?.includes(',')) return ',';
        return '.';
    }).catch(() => '.');
    const formatNum = (n) => n.toFixed(2).replace('.', decSep);

    const total = rows.length;
    for (let i = 0; i < total; i++) {
        const row = rows[i];
        // Click "Добави нов ред >>"
        await page.click('button:has-text("Добави нов ред"), input[value*="Добави нов ред"]');
        await page.waitForTimeout(300);
        // Get the last row in the table
        const lastRow = page.locator('table tr').last();
        // Col 2: name
        await lastRow.locator('input[type="text"]').first().fill(row.name);
        // Col 3: country dropdown
        const countrySelect = lastRow.locator('select').nth(0);
        const mappedCountry = countryMappings[row.country] || row.country;
        // Try normalized match: trim + case-insensitive
        const matched = await countrySelect.evaluate((el, target) => {
            const norm = target.trim().toLowerCase();
            for (const opt of el.options) {
                if (opt.text.trim().toLowerCase() === norm) { el.value = opt.value; el.dispatchEvent(new Event('change')); return true; }
            }
            return false;
        }, mappedCountry);
        if (!matched) {
            // Country not found — interactive fallback
            emit({ type: 'country_prompt', symbol: row.name, country: row.country, row: i + 1 });
            // Highlight the dropdown
            await countrySelect.evaluate(el => el.style.outline = '3px solid red');
            // Inject prompt
            await page.evaluate((country, rowNum) => {
                const prompt = document.createElement('div');
                prompt.id = '__nra_country_prompt';
                prompt.innerHTML = `<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#fff3cd;border:2px solid #ffc107;padding:16px 24px;border-radius:8px;z-index:99999;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3)">
                    <strong>Държавата '${country}' не е намерена.</strong><br>
                    Моля, изберете я ръчно от падащото меню за ред ${rowNum}.
                </div>`;
                document.body.appendChild(prompt);
            }, row.country, i + 1);
            // Wait for user selection (poll dropdown value, 5-minute timeout)
            let selected = '';
            const countryTimeout = Date.now() + 5 * 60 * 1000;
            while (!selected && Date.now() < countryTimeout) {
                selected = await countrySelect.evaluate(el => el.options[el.selectedIndex]?.text || '').catch(() => '');
                if (!selected) await page.waitForTimeout(500);
            }
            if (!selected) {
                emit({ type: 'warning', message: `Country selection timed out for ${row.name}` });
                continue; // skip this row
            }
            // Learn mapping
            countryMappings[row.country] = selected;
            emit({ type: 'country_mapped', ourName: row.country, nraValue: selected });
            // Remove prompt
            await page.evaluate(() => document.getElementById('__nra_country_prompt')?.remove());
            await countrySelect.evaluate(el => el.style.outline = '');
        }
        // Col 4: income code
        await lastRow.locator('select').nth(1).selectOption({ value: String(row.incomeCode) });
        // Col 5: method code
        await lastRow.locator('select').nth(2).selectOption({ value: String(row.methodCode) });
        // Cols 6-12: numeric inputs (use detected decimal separator)
        const numInputs = lastRow.locator('input[type="text"]');
        const numValues = [
            row.grossAmount, row.acquisitionCost, row.difference,
            row.foreignTax, row.allowedCredit, row.recognizedCredit, row.taxDue,
        ];
        // Skip first input (name), fill the rest
        for (let j = 0; j < numValues.length; j++) {
            await numInputs.nth(j + 1).fill(formatNum(numValues[j]));
        }
        emit({ type: 'progress', current: i + 1, total, symbol: row.name });
        await page.waitForTimeout(200);
    }
}
```

**Completion + cleanup:**
```javascript
// Show done overlay
await page.evaluate((count) => {
    const done = document.createElement('div');
    done.innerHTML = `<div style="position:fixed;top:20px;right:20px;background:#d4edda;border:2px solid #28a745;padding:16px 24px;border-radius:8px;z-index:99999;font-family:sans-serif">
        ✓ Попълнени ${count} реда. Можете да прегледате и изпратите формата.
    </div>`;
    document.body.appendChild(done);
    setTimeout(() => done.remove(), 10000);
}, rows.length);

emit({ type: 'complete', filled: rows.length, skipped: 0, mappings: countryMappings });

// Wait for browser close
await new Promise(resolve => {
    page.on('close', resolve);
    browser.on('disconnected', resolve);
});
process.exit(0);

function emit(data) {
    process.stdout.write(JSON.stringify(data) + '\n');
}
```

- [ ] **Step 4: Add `--dry-run` support**

At the top of the script, after parsing input:
```javascript
const dryRun = process.argv.includes('--dry-run');
```

In dry-run mode, log all intended actions instead of performing them. Skip browser launch entirely — just iterate rows and emit progress events.

- [ ] **Step 5: Test with mock HTML**

Create a test input file and run manually:
```bash
echo '{"rows":[{"rowLabel":"1.1","name":"AAPL","country":"САЩ","incomeCode":8141,"methodCode":1,"grossAmount":180.00,"acquisitionCost":0,"difference":0,"foreignTax":18.00,"allowedCredit":9.00,"recognizedCredit":9.00,"taxDue":0.00}],"countryMappings":{}}' > /tmp/nra-test-input.json && node scripts/nra-fill-form.mjs /tmp/nra-test-input.json
```

Expected: Chromium opens, shows blank page, navigate to `file:///.../tests/fixtures/nra-form-mock.html`, form detected, confirmation overlay appears.

- [ ] **Step 6: Test dry-run mode**

Run:
```bash
echo '{"rows":[{"rowLabel":"1.1","name":"AAPL","country":"САЩ","incomeCode":8141,"methodCode":1,"grossAmount":180.00,"acquisitionCost":0,"difference":0,"foreignTax":18.00,"allowedCredit":9.00,"recognizedCredit":9.00,"taxDue":0.00}]}' > /tmp/nra-test-dry.json && node scripts/nra-fill-form.mjs /tmp/nra-test-dry.json --dry-run
```

Expected: No browser, stdout shows progress events for each row.

- [ ] **Step 7: Commit**

```bash
git add scripts/nra-fill-form.mjs tests/fixtures/nra-form-mock.html package.json pnpm-lock.yaml
git commit -m "feat: add Playwright sidecar script for NRA form filling"
```

---

### Task 3: Tauri Shell Permissions

**Files:**
- Modify: `packages/ui/src-tauri/capabilities/default.json`
- Modify: `packages/ui/src-tauri/Cargo.toml`
- Modify: `packages/ui/src-tauri/tauri.conf.json`

Enable the Tauri shell plugin so the UI can spawn the Node.js sidecar process.

- [ ] **Step 1: Add shell plugin to Cargo.toml**

In `packages/ui/src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-shell = "2.0"
```

- [ ] **Step 2: Register plugin in lib.rs**

Add `.plugin(tauri_plugin_shell::init())` to the Tauri builder in `packages/ui/src-tauri/src/lib.rs`. Current code registers dialog, fs, http — add shell after http:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Add shell permissions to capabilities**

Update `packages/ui/src-tauri/capabilities/default.json` to add shell permissions. The exact format depends on Tauri v2 plugin-shell — consult [Tauri v2 plugin-shell docs](https://v2.tauri.app/plugin/shell/). The intent is:

```json
{
  "identifier": "main-capability",
  "description": "Capability for main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "fs:default",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://api.openfigi.com/*" }
      ]
    },
    "shell:allow-execute",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "shell:allow-open"
  ]
}
```

Note: Verify the exact permission identifiers against Tauri v2 docs. May need scoping like `shell:allow-execute[{ cmd: 'node' }]` or a `shell` section in `tauri.conf.json` plugins.

- [ ] **Step 4: Add shell plugin and bundle script as resource**

In `packages/ui/src-tauri/tauri.conf.json`, add shell plugin config and bundle the sidecar script as a resource so it's available in packaged builds:

```json
"plugins": {
    "shell": {
        "open": true
    }
},
"bundle": {
    ...existing config...,
    "resources": [
        "../../scripts/nra-fill-form.mjs"
    ]
}
```

This ensures `resolveResource('scripts/nra-fill-form.mjs')` works in both dev and production.

- [ ] **Step 5: Verify Tauri compiles**

Run: `cd packages/ui && pnpm exec tauri build --debug 2>&1 | head -50`
Or just: `cd packages/ui/src-tauri && cargo check`

Expected: Compilation succeeds with the new plugin.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src-tauri/
git commit -m "feat: add Tauri shell plugin for NRA form filler"
```

---

### Task 4: useNraFiller Hook

**Files:**
- Create: `packages/ui/src/hooks/useNraFiller.ts`

This hook manages:
1. Node.js availability check
2. Spawning the sidecar via `@tauri-apps/plugin-shell`
3. Piping NRA form row data to stdin
4. Reading stdout progress events
5. Signal file for manual "fill now" trigger
6. Country mapping persistence in localStorage

- [ ] **Step 1: Install Tauri shell JS binding**

Run: `pnpm --filter @bg-tax/ui add @tauri-apps/plugin-shell`

- [ ] **Step 2: Create the hook**

Create `packages/ui/src/hooks/useNraFiller.ts`:

```typescript
import { useState, useCallback, useRef } from 'react';
import { buildNraFormRows } from '@bg-tax/core';
import type { NraFormRow, Dividend, BaseCurrency } from '@bg-tax/core';

// Tauri imports are dynamic to avoid breaking web builds
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface NraFillerProgress {
    current: number;
    total: number;
    symbol?: string;
}

interface UseNraFillerReturn {
    startFilling: () => Promise<void>;
    fillNow: () => void;
    status: 'idle' | 'launching' | 'waiting' | 'filling' | 'done' | 'error';
    progress: NraFillerProgress | null;
    awaitingCountrySelect: boolean;
    error: string | null;
    warnings: string[];
}

const COUNTRY_MAPPINGS_KEY = 'nra_country_mappings';

function loadCountryMappings(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(COUNTRY_MAPPINGS_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveCountryMappings(mappings: Record<string, string>): void {
    localStorage.setItem(COUNTRY_MAPPINGS_KEY, JSON.stringify(mappings));
}

async function checkNodeJs(Command: any): Promise<boolean> {
    try {
        const result = await Command.create('node', ['--version']).execute();
        if (result.code !== 0) return false;
        const major = parseInt(result.stdout.trim().replace('v', '').split('.')[0], 10);
        return major >= 20;
    } catch {
        return false;
    }
}

export function useNraFiller(
    dividends: Dividend[],
    fxRates: Record<string, Record<string, number>>,
    baseCurrency: BaseCurrency,
): UseNraFillerReturn {
    const [status, setStatus] = useState<UseNraFillerReturn['status']>('idle');
    const [progress, setProgress] = useState<NraFillerProgress | null>(null);
    const [awaitingCountrySelect, setAwaitingCountrySelect] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const signalFileRef = useRef<string | null>(null);

    const startFilling = useCallback(async () => {
        if (!isTauri) return;

        setStatus('launching');
        setError(null);
        setWarnings([]);
        setProgress(null);

        try {
            const { Command } = await import('@tauri-apps/plugin-shell');

            // Check Node.js availability
            const nodeAvailable = await checkNodeJs(Command);
            if (!nodeAvailable) {
                setStatus('error');
                setError('Node.js (>= 20) не е намерен. Инсталирайте от https://nodejs.org');
                // Try to open nodejs.org in default browser
                try {
                    const { open } = await import('@tauri-apps/plugin-shell');
                    await open('https://nodejs.org');
                } catch { /* ignore */ }
                return;
            }

            // Check Playwright Chromium is installed
            const chromiumCheck = Command.create('node', ['-e', "require('playwright').chromium.executablePath()"]);
            const chromiumResult = await chromiumCheck.execute();
            if (chromiumResult.code !== 0) {
                setStatus('launching');
                // Install Chromium (one-time)
                const install = Command.create('npx', ['playwright', 'install', 'chromium']);
                const installResult = await install.execute();
                if (installResult.code !== 0) {
                    setStatus('error');
                    setError('Не може да се инсталира Chromium: ' + installResult.stderr);
                    return;
                }
            }

            // Build form rows
            const rows = buildNraFormRows(dividends, fxRates, baseCurrency);
            if (rows.length === 0) {
                setStatus('error');
                setError('Няма дивиденти за попълване');
                return;
            }

            // Write input data to temp file (avoids stdin EOF issues)
            const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
            const { tempDir, resolveResource } = await import('@tauri-apps/api/path');
            const tmpBase = await tempDir();
            const inputFile = `${tmpBase}/nra-input-${Date.now()}.json`;
            const signalFile = `${tmpBase}/nra-fill-now-${Date.now()}`;
            signalFileRef.current = signalFile;

            const countryMappings = loadCountryMappings();
            await writeTextFile(inputFile, JSON.stringify({ rows, countryMappings, signalFile }));

            // Resolve script path (works in both dev and packaged app)
            const scriptPath = await resolveResource('scripts/nra-fill-form.mjs');

            // Spawn sidecar
            const cmd = Command.create('node', [scriptPath, inputFile]);

            cmd.stdout.on('data', (line: string) => {
                try {
                    const event = JSON.parse(line.trim());
                    switch (event.type) {
                        case 'status':
                            if (event.message === 'browser_launched' || event.message === 'waiting_for_form') {
                                setStatus('waiting');
                            } else if (event.message === 'form_detected' || event.message === 'user_confirmed') {
                                setStatus('filling');
                            }
                            break;
                        case 'progress':
                            setStatus('filling');
                            setProgress({ current: event.current, total: event.total, symbol: event.symbol });
                            setAwaitingCountrySelect(false);
                            break;
                        case 'country_prompt':
                            setAwaitingCountrySelect(true);
                            break;
                        case 'country_mapped': {
                            const mappings = loadCountryMappings();
                            mappings[event.ourName] = event.nraValue;
                            saveCountryMappings(mappings);
                            setAwaitingCountrySelect(false);
                            break;
                        }
                        case 'complete':
                            setStatus('done');
                            if (event.mappings) saveCountryMappings({ ...loadCountryMappings(), ...event.mappings });
                            setTimeout(() => setStatus('idle'), 5000);
                            break;
                        case 'warning':
                            setWarnings(w => [...w, event.message]);
                            break;
                    }
                } catch { /* ignore non-JSON lines */ }
            });

            cmd.on('close', (data: { code: number }) => {
                if (data.code !== 0 && status !== 'done') {
                    setStatus('error');
                    setError(`Процесът приключи с код ${data.code}`);
                }
            });

            await cmd.spawn();

        } catch (err) {
            setStatus('error');
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [dividends, fxRates, baseCurrency, status]);

    const fillNow = useCallback(async () => {
        if (!isTauri || !signalFileRef.current) return;
        try {
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            await writeTextFile(signalFileRef.current, 'fill_now');
        } catch { /* ignore */ }
    }, []);

    return { startFilling, fillNow, status, progress, awaitingCountrySelect, error, warnings };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/useNraFiller.ts
git commit -m "feat: add useNraFiller hook for sidecar lifecycle"
```

---

### Task 5: Declaration Page Button

**Files:**
- Modify: `packages/ui/src/pages/Declaration.tsx`

Add the "Попълни в НАП" button in the Приложение 8, Част III section. This replaces the comment at line 641: `{/* NRA upload button hidden — no upload field on NRA portal yet */}`.

- [ ] **Step 1: Add the import and hook usage**

At the top of `Declaration.tsx`, add:
```typescript
import { useNraFiller } from '../hooks/useNraFiller.js';
```

Inside the `Declaration` component, add the hook call (near the existing state declarations):
```typescript
const nraFiller = useNraFiller(dividends, fxRates, baseCurrency);
```

Note: `dividends`, `fxRates`, and `baseCurrency` are already available from the Zustand store destructuring at the top of the component.

- [ ] **Step 2: Replace the comment with the button UI**

Replace line 641 (`{/* NRA upload button hidden — no upload field on NRA portal yet */}`) with:

```tsx
{isTauri && (
    <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
            onClick={nraFiller.startFilling}
            disabled={nraFiller.status !== 'idle' && nraFiller.status !== 'error'}
            style={{
                padding: '0.5rem 1rem',
                backgroundColor: nraFiller.status === 'done' ? '#28a745'
                    : nraFiller.status === 'error' ? '#dc3545'
                    : 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: nraFiller.status === 'idle' || nraFiller.status === 'error' ? 'pointer' : 'wait',
                fontSize: '0.9rem',
                opacity: (nraFiller.status !== 'idle' && nraFiller.status !== 'error' && nraFiller.status !== 'done') ? 0.7 : 1,
            }}
        >
            {nraFiller.status === 'idle' && 'Попълни в НАП'}
            {nraFiller.status === 'launching' && 'Стартиране...'}
            {nraFiller.status === 'waiting' && 'Очакване на формата...'}
            {nraFiller.status === 'filling' && nraFiller.progress
                ? `Попълване... (${nraFiller.progress.current}/${nraFiller.progress.total})`
                : nraFiller.status === 'filling' ? 'Попълване...' : ''}
            {nraFiller.status === 'done' && `Попълнено (${nraFiller.progress?.total ?? 0} реда)`}
            {nraFiller.status === 'error' && 'Попълни в НАП'}
        </button>
        {nraFiller.status === 'waiting' && (
            <button
                onClick={nraFiller.fillNow}
                style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: 'transparent',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                }}
            >
                Попълни сега
            </button>
        )}
        {nraFiller.awaitingCountrySelect && (
            <span style={{ fontSize: '0.85rem', color: '#ffc107' }}>
                Изберете държава в браузъра
            </span>
        )}
        {nraFiller.error && (
            <span style={{ color: '#dc3545', fontSize: '0.85rem' }}>
                {nraFiller.error}
            </span>
        )}
    </div>
)}
```

Add `isTauri` detection at the top of the component (reuse existing pattern from the codebase):
```typescript
const isTauri = '__TAURI_INTERNALS__' in window;
```

- [ ] **Step 3: Run UI tests**

Run: `pnpm --filter @bg-tax/ui test`
Expected: All existing tests pass (no new UI tests needed for the button — it's Tauri-only and requires mocking the shell API).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/pages/Declaration.tsx
git commit -m "feat: add 'Попълни в НАП' button for NRA form filling"
```

---

### Task 6: i18n Keys

**Files:**
- Modify: `packages/core/src/i18n/bg.ts`
- Modify: `packages/core/src/i18n/en.ts`

Add the i18n keys for the NRA filler UI strings. While the spec says UI-only i18n, the project uses core's i18n for all strings (checked: Declaration.tsx uses `t()` from core).

- [ ] **Step 1: Add Bulgarian keys**

Add to `packages/core/src/i18n/bg.ts`:
```typescript
// NRA form filler
'nra.fill.button': 'Попълни в НАП',
'nra.fill.launching': 'Стартиране на браузъра...',
'nra.fill.waiting': 'Очакване на формата...',
'nra.fill.fillNow': 'Попълни сега',
'nra.fill.progress': 'Попълване... ({current}/{total})',
'nra.fill.countryPrompt': 'Изберете държава в браузъра',
'nra.fill.done': 'Попълнено ({count} реда)',
'nra.fill.error': 'Грешка',
'nra.fill.nodeRequired': 'Node.js (>= 20) не е намерен. Инсталирайте от https://nodejs.org',
'nra.fill.noDividends': 'Няма дивиденти за попълване',
'nra.fill.installingChromium': 'Инсталиране на Chromium...',
```

- [ ] **Step 2: Add English keys**

Add to `packages/core/src/i18n/en.ts`:
```typescript
// NRA form filler
'nra.fill.button': 'Fill NRA Form',
'nra.fill.launching': 'Launching browser...',
'nra.fill.waiting': 'Waiting for form...',
'nra.fill.fillNow': 'Fill Now',
'nra.fill.progress': 'Filling... ({current}/{total})',
'nra.fill.countryPrompt': 'Select country in browser',
'nra.fill.done': 'Filled ({count} rows)',
'nra.fill.error': 'Error',
'nra.fill.nodeRequired': 'Node.js (>= 20) not found. Install from https://nodejs.org',
'nra.fill.noDividends': 'No dividends to fill',
'nra.fill.installingChromium': 'Installing Chromium...',
```

- [ ] **Step 3: Update Declaration.tsx to use i18n keys**

Replace hardcoded Bulgarian strings in the button from Task 5 with `t('nra.fill.button')`, `t('nra.fill.launching')`, etc.

- [ ] **Step 4: Run i18n test**

Run: `pnpm --filter @bg-tax/core exec vitest run tests/i18n.test.ts`
Expected: PASS (this test checks both language files have the same keys)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/i18n/bg.ts packages/core/src/i18n/en.ts packages/ui/src/pages/Declaration.tsx
git commit -m "feat: add i18n keys for NRA form filler"
```

---

### Task 7: cspell + Lint + Format

**Files:**
- Modify: `cspell-dict.txt` (if needed)
- All modified files

- [ ] **Step 1: Run spellcheck**

Run: `pnpm spell`

If new Bulgarian or technical words are flagged (e.g., "sidecar", "stdin", "playwright"), add them to `cspell-dict.txt` in lowercase alphabetical order.

- [ ] **Step 2: Run format**

Run: `pnpm format`

- [ ] **Step 3: Run lint**

Run: `pnpm lint:fix && pnpm lint`
Expected: Zero errors

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @bg-tax/core test && pnpm --filter @bg-tax/ui test`
Expected: All pass

- [ ] **Step 5: Format check**

Run: `pnpm format:check`
Expected: No unformatted files

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint, format, and spelling for NRA form filler"
```

---

### Task 8: Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` (if shell/sidecar patterns need documenting)

- [ ] **Step 1: Update README**

Add a section about the NRA form filler feature:
- What it does
- Node.js requirement (optional, only for this feature)
- How to use: click "Попълни в НАП" on the Declaration page

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add NRA form filler feature to README"
```
