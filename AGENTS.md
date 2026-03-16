# AGENTS.md — Instructions for AI Coding Agents

## Testing Requirements

- **Minimum 50% code coverage** — always aim higher, but never drop below 50%
- Write tests BEFORE implementation (TDD)
- Every new module must have a corresponding test file
- Run `pnpm --filter @bg-tax/core test` after every change to verify nothing broke
- Test edge cases: empty inputs, missing data, boundary values

## Code Style

- TypeScript strict mode everywhere
- No `any` types in production code (tests can use `as` for fixture construction)
- All tax amounts are **positive** — callers normalize (Math.abs) negative WHT values from IB CSV
- Prefer pure functions; classes only for stateful engines (FifoEngine, FxService)
- No heavy abstractions — keep it simple, direct

## Architecture Rules

- `packages/core` has **zero UI dependencies** — never import React, DOM, or Tauri here
- `packages/ui` depends on `@bg-tax/core` via workspace protocol
- All business logic lives in core — UI only handles rendering and user interaction
- State flows one direction: parsers → FIFO → tax → declaration → Excel

## Key Domain Rules

- **IB CSV has TWO Withholding Tax sections** — parser must not stop at first Total line
- **Dividends combine by symbol+date+currency** before WHT matching
- **FIFO sorts trades by datetime** (not just date) before processing
- **Excel formulas**: ArrayFormula ONLY for SWITCH. Plain formula for VLOOKUP.
- **Excel export is always in Bulgarian** — UI language setting does not affect export
- **Base currency**: BGN for tax year ≤2025, EUR for ≥2026. EUR/BGN fixed at 1.95583
- **ECB rates are EUR-native**: 1 EUR = X currency

## When Adding Features

1. Check the design spec: `docs/superpowers/specs/2026-03-15-bulgarian-tax-declaration-design.md`
2. Check the implementation plan: `docs/superpowers/plans/2026-03-15-bulgarian-tax-declaration.md`
3. Write failing test first
4. Implement minimally to pass
5. Refactor if needed
6. Run full test suite before committing

## When Fixing Bugs

1. Write a test that reproduces the bug
2. Verify test fails
3. Fix the code
4. Verify test passes
5. Run full test suite

## Before Push Checklist

Run these before every push:

```bash
pnpm --filter @bg-tax/core test   # All tests pass
pnpm format                        # Format code with dprint
pnpm spell                         # Spellcheck with cspell
```

If cspell flags a legitimate word, add it to `cspell-dict.txt`.

## Public Release Considerations

This repo will be made public eventually. Keep in mind:
- **No secrets/credentials** in code or config files
- **No personal data** (account numbers, real tax amounts) in test fixtures
- **No hardcoded paths** like `/Users/trifonov/` — use relative paths
- **License-compatible dependencies** only (MIT/Apache preferred)
- **GitHub Pages deployment** is pre-configured (`.github/workflows/deploy-pages.yml`) — will auto-deploy when repo goes public
- The app should work as both a Tauri desktop app AND a browser SPA on GitHub Pages

## Commit Messages

Format: `type: description`

Types: `feat`, `fix`, `test`, `chore`, `docs`, `refactor`

Examples:
- `feat: add GBP support to Revolut parser`
- `fix: handle ASML dividend reversal in WHT matcher`
- `test: add edge cases for FIFO partial lot splits`
