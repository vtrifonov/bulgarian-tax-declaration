# NRA Form Filler — Design Spec

## Overview

Automates filling Приложение 8, Част III (foreign dividends) in the NRA online tax declaration portal. The app launches a visible Chromium browser via Playwright, the user logs in and navigates to the form, and the tool fills all dividend rows automatically.

## Scope

**In scope:** Приложение 8, Част III — dividend rows only (code 8141). This section can have dozens of rows, making manual entry tedious.

**Out of scope:** Other appendices (Приложение 5, Приложение 6, Приложение 8 Част I) — these have few fields and are manageable to fill manually.

## Architecture

### New Components

```
packages/
├── core/src/nra/
│   └── form-data.ts          # Pure function: Dividend[] + fxRates → NraFormRow[]
├── ui/src/
│   ├── hooks/useNraFiller.ts  # Sidecar lifecycle management
│   └── pages/Declaration.tsx   # New "Попълни в НАП" button (existing file)
scripts/
└── nra-fill-form.mjs          # Standalone Playwright sidecar script
```

### Data Flow

```
Declaration page
    │
    ▼
core/nra/form-data.ts          Transforms dividends → NraFormRow[]
    │                           (reuses calcDividendRowTax from existing code)
    │
    ▼
useNraFiller hook               Serializes NraFormRow[] to JSON, spawns sidecar
    │
    ▼
Tauri shell → node scripts/nra-fill-form.mjs
    │
    │  stdin: entire JSON array of NraFormRow (single JSON blob, read until EOF)
    │  stdout: JSON lines (progress/status events, one per line)
    │  (stdin closed after initial write; fill_now via separate IPC — see below)
    │
    ▼
Playwright (headed Chromium)    User logs in → script detects form → fills rows
```

## Core Data

### NraFormRow

```typescript
interface NraFormRow {
    /** Row number label: `${index}.1` where index is 1-based (e.g. "1.1", "2.1", "15.1") */
    rowLabel: string;
    /** Column 2: symbol/company name */
    name: string;
    /** Column 3: country in Bulgarian (e.g. "САЩ") — must match NRA dropdown text */
    country: string;
    /** Column 4: income type code — always 8141 for dividends */
    incomeCode: number;
    /** Column 5: method code — always 1 */
    methodCode: number;
    /** Column 6: gross income in base currency */
    grossAmount: number;
    /** Column 7: acquisition cost — always 0 for dividends */
    acquisitionCost: number;
    /** Column 8: positive difference (col6 - col7) — 0 for dividends */
    difference: number;
    /** Column 9: tax paid abroad in base currency */
    foreignTax: number;
    /** Column 10: allowed tax credit (5% of gross) */
    allowedCredit: number;
    /** Column 11: recognized tax credit — min(foreignTax, allowedCredit) */
    recognizedCredit: number;
    /** Column 12: tax due — max(0, allowedCredit - foreignTax) */
    taxDue: number;
}
```

Row labels use `${index}.1` format (1-based, matching the NRA form's numbering). With many dividends, labels like "15.1", "42.1" are valid — the NRA form has no hard row limit.

### buildNraFormRows (packages/core/src/nra/form-data.ts)

```typescript
function buildNraFormRows(
    dividends: Dividend[],
    fxRates: Record<string, Record<string, number>>,
    baseCurrency: 'BGN' | 'EUR',
): NraFormRow[]
```

Pure function that transforms `Dividend[]` + `fxRates` into `NraFormRow[]`. Reuses `calcDividendRowTax` from `packages/core/src/tax/dividend-row-tax.ts` (same logic as `generateNraAppendix8Part3`). Filters out dividends with `grossAmount <= 0`, sorts by symbol then date.

This function has no UI or Playwright dependencies — it lives in `packages/core` and is independently testable.

## Playwright Sidecar Script

### scripts/nra-fill-form.mjs

Standalone Node.js (>=20) ESM script. No imports from `packages/core` — receives pre-computed `NraFormRow[]` via stdin.

**Dependencies:** `playwright` (installed as a project devDependency in the root `package.json`; Chromium browser binary installed via `npx playwright install chromium` on first use).

### Lifecycle

1. Read JSON from stdin (hook writes the entire NraFormRow[] JSON array then closes stdin; sidecar reads until EOF)
2. Launch Chromium in headed (visible) mode using `playwright.chromium.launch({ headless: false })`
3. Open a new page — navigate to `about:blank` (user navigates from there)
4. Enter polling loop: check DOM every 2s for the Част III form header
5. On form detection → inject confirmation overlay in the browser
6. On user confirm (or `fill_now` command from stdin) → fill rows sequentially
7. On completion → show "done" overlay in the browser
8. Keep browser open — script remains alive, listening for browser close event
9. When user closes browser window → script detects `page.on('close')`, exits with code 0

The browser window belongs to the user after completion. They review the filled form, make corrections if needed, and submit. Closing the browser window ends the sidecar process.

### Form Detection

The script identifies the Част III form by searching for a table header containing the text "Определяне на дължимия окончателен данък по чл. 38 от ЗДДФЛ". This is the unique heading of the dividend section visible in the form.

Detection polling: every 2 seconds, up to 300 attempts (10 minutes). If the form isn't found after 10 minutes, the script logs a timeout warning but keeps the browser open — the user can trigger filling manually via the app's "Попълни сега" button.

### Filling Algorithm

For each `NraFormRow`:

1. Click the "Добави нов ред >>" button
2. Wait for the new row to appear in the DOM (wait for the row number cell)
3. Locate the new row's input fields by position:
   - Column 2 (name): text input → `fill()` with `row.name`
   - Column 3 (country): `<select>` dropdown → `selectOption()` matching `row.country` by visible text (trimmed, case-insensitive comparison)
   - Column 4 (income code): `<select>` → `selectOption()` with value `8141`
   - Column 5 (method code): `<select>` → `selectOption()` with value `1`
   - Columns 6-12: numeric `<input>` fields → `fill()` with `row.grossAmount.toFixed(2)`, etc.
4. Small delay between rows (200ms) to let the form's JavaScript recalculate totals

**Decimal separator:** The NRA form uses period (`.`) as the decimal separator in its input fields (confirmed from the screenshot showing `0.00` placeholders). Amounts are formatted with `toFixed(2)` — no thousands separator. The NRA form's JavaScript auto-formats on blur.

### Country Matching with Interactive Fallback

The dropdown options use Bulgarian country names (e.g., "САЩ", "Германия", "Ирландия"). Our dividend data already stores countries in the same format.

**Matching strategy:**
1. Normalize both sides: trim whitespace, case-insensitive comparison
2. Exact match → select the option
3. No match → **interactive fallback**:

**Interactive fallback when a country is not found:**

1. Script pauses filling and injects an overlay in the browser:
   > "Държавата 'Хонконг' не е намерена в списъка. Моля, изберете я ръчно от падащото меню за ред X."
   > ("Country 'Хонконг' not found in the list. Please select it manually from the dropdown for row X.")
2. Script highlights the country dropdown for the current row
3. User selects the correct country from the dropdown manually
4. Script detects the selection changed (polls `<select>.value` every 500ms)
5. Script records the mapping: `"Хонконг" → selected dropdown value`
6. **For all subsequent rows with the same country**, the script uses the learned mapping automatically — no repeated prompts
7. Script resumes filling

This learned mapping is also reported back to stdout:
```jsonl
{"type":"country_mapped","ourName":"Хонконг","nraValue":"Хонконг, Китай","nraIndex":85}
```

The app persists these mappings in localStorage under `nra_country_mappings` (keyed by our country name). On future fills, pre-populated mappings bypass the interactive fallback. If the NRA form changes its dropdown options, the user may need to re-learn a mapping by deleting it from localStorage (or via a "Reset mappings" option in the UI).

### Confirmation Overlay

Injected into the page via `page.evaluate()`. Shows:
- Row count ("Готови за попълване: 23 реда")
- Sample data preview (first 2-3 symbols with amounts)
- "Попълни" (fill) and "Отказ" (cancel) buttons
- Styled as a fixed-position overlay with high z-index

**Communication protocol:** The overlay sets `window.__nraFillerAction = 'fill'` or `'cancel'` on button click. The script polls `page.evaluate(() => window.__nraFillerAction)` every 500ms. On `'fill'` → proceed. On `'cancel'` → log cancellation, keep browser open, exit script.

### Progress Reporting

The script writes JSON lines to stdout (one JSON object per line, newline-delimited):

```jsonl
{"type":"status","message":"browser_launched"}
{"type":"status","message":"waiting_for_form"}
{"type":"status","message":"form_detected"}
{"type":"status","message":"user_confirmed"}
{"type":"progress","current":1,"total":23,"symbol":"AAPL"}
{"type":"progress","current":2,"total":23,"symbol":"CSPX"}
{"type":"country_prompt","symbol":"XYZ","country":"Хонконг","row":5}
{"type":"country_mapped","ourName":"Хонконг","nraValue":"Хонконг, Китай"}
{"type":"progress","current":5,"total":23,"symbol":"XYZ"}
...
{"type":"complete","filled":23,"skipped":0,"mappings":{"Хонконг":"Хонконг, Китай"}}
```

**Hook status mapping:** Sidecar stdout messages map to hook states:
- `browser_launched` → `'launching'`
- `waiting_for_form` → `'waiting'`
- `form_detected` + `user_confirmed` → `'filling'`
- `progress` → `'filling'` (updates progress counter)
- `country_prompt` → `'filling'` (app shows "Waiting for country selection..." note)
- `complete` → `'done'`
- Process exit with error → `'error'`

### Error Handling

- **Form not found after 10 minutes:** Log timeout warning, keep browser open. User can trigger via "Попълни сега" in app.
- **Country not found in dropdown:** Pause and ask user to select manually (see interactive fallback above). Learn mapping for remaining rows.
- **Page navigation during fill:** Detect URL change via `page.on('framenavigated')`, abort filling, report partial progress (`{"type":"aborted","filled":5,"total":23,"reason":"page_navigated"}`).
- **Browser closed by user:** Detect via `page.on('close')` / `browser.on('disconnected')`, exit script with code 0.
- **Sidecar crash mid-fill:** App detects process exit. User can click "Попълни в НАП" again — the partially-filled form is still in the browser (assuming it wasn't closed). New sidecar will detect existing rows and offer to continue from where it left off (or start fresh).

## UI Integration

### Declaration.tsx Changes

Add a "Попълни в НАП" button in the Приложение 8, Част III section, next to the existing "Експорт НАП Прил. 8 Част III" button.

Button states:
- **Default:** "Попълни в НАП" — enabled when dividends exist
- **Launching:** "Стартиране..." — spinner
- **Waiting:** "Очакване на формата..." — with "Попълни сега" secondary button (manual trigger)
- **Filling:** "Попълване... (5/23)" — progress from sidecar
- **Country prompt:** "Попълване... (5/23) — изберете държава в браузъра" — note about manual country selection
- **Done:** "Попълнено (23 реда)" — green, auto-resets after 5s
- **Error:** "Грешка: ..." — red, with error message

This button is **only rendered in Tauri** (desktop). Detection: `typeof window.__TAURI_INTERNALS__ !== 'undefined'`. On web/GitHub Pages build it is hidden.

### useNraFiller Hook

```typescript
interface UseNraFillerReturn {
    /** Launch the Playwright sidecar */
    startFilling: () => Promise<void>;
    /** Manual trigger — tell sidecar to fill the current page now */
    fillNow: () => void;
    /** Current state */
    status: 'idle' | 'launching' | 'waiting' | 'filling' | 'done' | 'error';
    /** Progress during filling */
    progress: { current: number; total: number; symbol?: string } | null;
    /** True when script is waiting for user to select a country */
    awaitingCountrySelect: boolean;
    /** Error message if status === 'error' */
    error: string | null;
    /** Warnings from completed fill */
    warnings: string[];
    /** Country mappings learned during this fill */
    countryMappings: Record<string, string>;
}
```

The hook:
1. Checks Node.js availability (see below)
2. Calls `buildNraFormRows()` to prepare data
3. Loads any persisted country mappings from local storage and injects them into the row data
4. Spawns the sidecar via Tauri's shell API: `Command.create('node', ['scripts/nra-fill-form.mjs'])`
5. Writes JSON data to sidecar's stdin
6. Reads stdout line-by-line, parses JSON events, updates state
7. On `country_mapped` events → persists to local storage for future fills
8. On "fill now" manual trigger → creates a signal file (`/tmp/nra-fill-now-{pid}`) that the sidecar watches. This avoids stdin complications since stdin is closed after initial data.

### Tauri Shell Permissions

Update `src-tauri/capabilities/default.json` to allow spawning the `node` process and writing to its stdin:

```json
{
    "permissions": [
        "shell:allow-execute",
        "shell:allow-stdin-write"
    ]
}
```

The exact Tauri v2 permission format may require scoping to the `node` command specifically — verify against [Tauri v2 plugin-shell docs](https://v2.tauri.app/plugin/shell/) during implementation. May need a pattern like `shell:allow-execute[{ cmd: 'node' }]`.

## Node.js Dependency

The sidecar requires Node.js (>= 20) on the user's machine.

**Detection and guided installation flow on "Попълни в НАП" click:**

1. Run `which node` (macOS/Linux) or `where node` (Windows) via Tauri shell
2. If found → check version via `node --version`, verify >= 20
3. If not found or too old → show a dialog with platform-specific install suggestions:

   **macOS:**
   > "За тази функция е необходим Node.js (>= 20). Желаете ли да го инсталирате?"
   >
   > [Инсталирай с Homebrew] — runs `brew install node` via Tauri shell (if `brew` is available)
   > [Отвори nodejs.org] — opens https://nodejs.org in the default browser
   > [Отказ]

   **Windows:**
   > "За тази функция е необходим Node.js (>= 20). Желаете ли да го инсталирате?"
   >
   > [Инсталирай с winget] — runs `winget install OpenJS.NodeJS.LTS` via Tauri shell (if `winget` is available)
   > [Отвори nodejs.org] — opens https://nodejs.org in the default browser
   > [Отказ]

   **Linux:**
   > Same pattern — detect `apt`/`dnf`/`pacman` and offer the appropriate install command, plus the nodejs.org fallback.

   If the user chooses to install, show a progress indicator while the command runs. After install completes, re-check `node --version` and continue if successful.

4. If Node.js is available → check for Playwright's Chromium:
   - Run `node -e "require('playwright').chromium.executablePath()"` to check
   - If not installed → show progress: "Инсталиране на Chromium браузър... (еднократно)"
   - Run `npx playwright install chromium` with stdout piped to a progress indicator

The Node.js + Playwright check runs once per app session and is cached in memory.

## Testing

### Core (form-data.ts)
- Unit tests for `buildNraFormRows`: verify row count, row labels ("1.1", "2.1", ..., "15.1"), calculations match `generateNraAppendix8Part3` output
- Edge cases: empty dividends array, missing FX rates, dividends with grossAmount <= 0 filtered out
- Reuse existing dividend test fixtures

### Sidecar Script
- **Manual testing** against the real NRA portal (requires valid ПИК credentials)
- **Dry-run mode**: `node scripts/nra-fill-form.mjs --dry-run < form-data.json` logs all intended DOM interactions without actually filling. Development/debugging tool, not exposed in the UI. Useful for testing selector changes when NRA form HTML updates.
- **Mock HTML fixture** (`tests/fixtures/nra-form-mock.html`): a static HTML page mimicking the NRA form structure (dropdowns, inputs, "Добави нов ред" button). Used for automated Playwright tests that verify the filling algorithm works. Maintained manually when NRA form changes are observed.

### UI (useNraFiller hook)
- Mock Tauri shell commands
- Test state transitions: idle → launching → waiting → filling → done
- Test error states: node not found, sidecar crash, country prompt flow
- Test country mapping persistence (localStorage mock)

## Localization

All user-facing strings in the UI use i18n keys (added to `packages/ui` i18n, not core — this is a desktop-only feature):

- `nra.fill.button` → "Попълни в НАП" / "Fill NRA Form"
- `nra.fill.launching` → "Стартиране на браузъра..." / "Launching browser..."
- `nra.fill.waiting` → "Очакване на формата..." / "Waiting for form..."
- `nra.fill.fillNow` → "Попълни сега" / "Fill Now"
- `nra.fill.progress` → "Попълване... ({current}/{total})" / "Filling... ({current}/{total})"
- `nra.fill.countryPrompt` → "Изберете държава в браузъра" / "Select country in browser"
- `nra.fill.done` → "Попълнено ({count} реда)" / "Filled ({count} rows)"
- `nra.fill.node_required` → "Необходим е Node.js (>= 18)..." / "Node.js (>= 18) is required..."
- `nra.fill.installing_chromium` → "Инсталиране на Chromium..." / "Installing Chromium..."

The browser overlay (confirmation, progress, country prompt, done) is always in Bulgarian since the NRA portal is in Bulgarian.
