# CLAUDE.md — Instructions for AI Agents

## Project Overview

Bulgarian tax declaration desktop app. Monorepo: `packages/core` (pure TS library) + `packages/ui` (Tauri v2 + React).

## Commands

```bash
pnpm install                           # Install deps
pnpm --filter @bg-tax/core test        # Run core tests (vitest)
pnpm --filter @bg-tax/ui dev:vite      # Start frontend dev server
pnpm --filter @bg-tax/ui build         # Production build (frontend)
```

## Architecture

- `packages/core/` — Zero UI dependencies. All business logic lives here.
  - `parsers/` — IB CSV, Revolut CSV, WHT matcher, Excel import
  - `fx/` — ECB API, caching, gap-fill, base currency conversion
  - `fifo/` — FIFO lot matching with datetime sorting
  - `tax/` — Bulgarian tax rules (10% gains, 5% dividends, 10% interest)
  - `validation/` — Non-blocking warnings
  - `declaration/` — NRA form field mapping via JSON configs
  - `excel/` — Full xlsx generation with formulas
  - `i18n/` — BG/EN string tables
- `packages/ui/` — Tauri v2 desktop shell + React frontend
  - `store/` — Zustand with undo/redo
  - `pages/` — YearSetup, Import, Workspace, Declaration
  - `src-tauri/` — Minimal Rust shell

## Key Conventions

- **TDD**: Write failing test first, then implement
- **All tax amounts are positive** — callers Math.abs() WHT values from IB CSV (which are negative)
- **Base currency**: BGN for ≤2025, EUR for ≥2026. EUR/BGN fixed at 1.95583
- **ECB rates are EUR-native**: 1 EUR = X currency. Convert: 1 USD = 1.95583 / ecbRate BGN
- **Excel formulas**: ArrayFormula ONLY for SWITCH (exceljs _xlfn prefix). Plain formula for VLOOKUP.
- **IB CSV has TWO Withholding Tax sections** — parser must not stop at first Total line
- **Dividends combine by symbol+date+currency** before WHT matching
- **FIFO sorts trades by datetime** (not just date) before processing
- **Validation does NOT check negative holdings** — FIFO engine owns that warning
- **Excel export is always in Bulgarian** — UI can be EN or BG

## Test Approach

- Core library: vitest with fixtures in `tests/fixtures/`
- All parsers have real-format CSV fixtures
- Excel tests generate xlsx and read back to verify structure

## Important Files

- `docs/superpowers/specs/2026-03-15-bulgarian-tax-declaration-design.md` — Full design spec
- `docs/superpowers/plans/2026-03-15-bulgarian-tax-declaration.md` — Implementation plan
- `packages/core/src/types/index.ts` — All shared TypeScript interfaces
- `packages/core/src/declaration/form-config/2025.json` — NRA form field mapping
