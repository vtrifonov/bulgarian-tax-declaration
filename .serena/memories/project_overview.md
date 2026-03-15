# Bulgarian Tax Declaration App

## Purpose
Desktop application for Bulgarian taxpayers (expats/investors) to prepare their annual tax declaration (Годишна данъчна декларация по чл. 50 от ЗДДФЛ). Parses IB and Revolut statements, calculates taxes using FIFO, exports formatted Excel.

## Tech Stack
- **TypeScript** — single language for all code
- **pnpm workspaces** — monorepo
- **Vitest** — testing framework
- **Tauri v2** — desktop shell (Rust backend, system webview)
- **React** — UI framework
- **Zustand** — state management
- **TanStack Table** — editable data tables
- **exceljs** — Excel generation

## Monorepo Structure
- `packages/core/` — Pure TS library (no UI deps): parsers, FX, FIFO, tax, validation, declaration, Excel export, i18n
- `packages/ui/` — Tauri v2 + React desktop app: pages, store, hooks, components
- `docs/superpowers/specs/` — Design spec
- `docs/superpowers/plans/` — Implementation plan

## Key Domain Rules
- BG tax: 10% capital gains, 5% dividends (with WHT credit), 10% interest
- Base currency: BGN for ≤2025, EUR for ≥2026. EUR/BGN fixed at 1.95583
- ECB rates are EUR-native: 1 EUR = X currency
- IB CSV has TWO Withholding Tax sections
- FIFO sorts trades by datetime before processing
- Excel export always in Bulgarian
