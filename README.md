# Bulgarian Tax Declaration (Данъчна декларация)

Desktop application for Bulgarian taxpayers (expats/investors) to prepare their annual tax declaration (Годишна данъчна декларация по чл. 50 от ЗДДФЛ).

Parses Interactive Brokers and Revolut savings statements, calculates Bulgarian taxes using FIFO lot matching, and exports a formatted Excel declaration.

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (enable via `corepack enable && corepack prepare pnpm@latest --activate`)
- **Rust** (for Tauri desktop builds):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

## Setup

```bash
git clone git@github.com:vtrifonov/bulgarian-tax-declaration.git
cd bulgarian-tax-declaration
pnpm install
pnpm dev          # starts desktop app (first run: ~3-5 min for Rust compilation)
```

## Project Structure

```
bulgarian-tax-declaration/
├── packages/
│   ├── core/          # Pure TypeScript library (no UI deps)
│   │   ├── src/
│   │   │   ├── parsers/       # IB CSV, Revolut CSV, WHT matcher, Excel import
│   │   │   ├── fx/            # ECB API client, FX cache, gap-fill
│   │   │   ├── fifo/          # FIFO lot matching engine
│   │   │   ├── tax/           # Bulgarian tax rules + calculator
│   │   │   ├── validation/    # Non-blocking warnings
│   │   │   ├── declaration/   # NRA form field mapping (2025, 2026)
│   │   │   ├── excel/         # Full xlsx generation (exceljs)
│   │   │   ├── i18n/          # BG/EN string tables
│   │   │   ├── country-map.ts # Symbol → country mapping
│   │   │   └── types/         # Shared interfaces
│   │   └── tests/
│   └── ui/            # Tauri v2 + React desktop app
│       ├── src/
│       │   ├── pages/         # YearSetup, Import, Workspace, Declaration
│       │   ├── store/         # Zustand state management
│       │   └── hooks/         # Auto-save, FX fetching
│       └── src-tauri/         # Rust shell (minimal)
└── docs/
    └── superpowers/
        ├── specs/             # Design spec
        └── plans/             # Implementation plan
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Run core library tests
pnpm test:core

# Start UI dev server (frontend only, no Tauri)
pnpm --filter @bg-tax/ui dev:vite

# Start full Tauri desktop app (requires Rust)
pnpm dev
```

## Commands

### Root (monorepo)

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm test` | Run tests in all packages |
| `pnpm test:core` | Run core library tests only |
| `pnpm build` | Build all packages |
| `pnpm dev` | Start Tauri desktop app |

### Core Library (`packages/core`)

| Command | Description |
|---------|-------------|
| `pnpm --filter @bg-tax/core test` | Run all tests (vitest) |
| `pnpm --filter @bg-tax/core test:watch` | Run tests in watch mode |

### UI (`packages/ui`)

| Command | Description |
|---------|-------------|
| `pnpm --filter @bg-tax/ui dev:vite` | Vite dev server only (no Tauri) |
| `pnpm --filter @bg-tax/ui dev` | Full Tauri dev (frontend + desktop shell) |
| `pnpm --filter @bg-tax/ui build` | Production build (frontend) |

## Building for Distribution

### macOS

```bash
cd packages/ui
pnpm tauri build
```

Output: `packages/ui/src-tauri/target/release/bundle/dmg/Bulgarian Tax Declaration_0.1.0_aarch64.dmg`

### Windows

```bash
cd packages/ui
pnpm tauri build
```

Output: `packages/ui/src-tauri/target/release/bundle/msi/Bulgarian Tax Declaration_0.1.0_x64_en-US.msi`

### Linux

```bash
cd packages/ui
pnpm tauri build
```

Output: `packages/ui/src-tauri/target/release/bundle/deb/` and `appimage/`

### Cross-compilation

Tauri does not support cross-compilation. Build on the target platform or use CI (GitHub Actions).

## Debugging

### Core library

```bash
# Run a specific test file
pnpm --filter @bg-tax/core test -- tests/parsers/ib-csv.test.ts

# Run a specific test by name
pnpm --filter @bg-tax/core test -- -t "parses trades"

# Watch mode for rapid iteration
pnpm --filter @bg-tax/core test:watch
```

### UI (frontend)

```bash
# Start Vite dev server with HMR
pnpm --filter @bg-tax/ui dev:vite
# Open http://localhost:5173 in browser — React DevTools and browser DevTools work normally
```

### UI (Tauri desktop)

```bash
# Start with Rust debug logging
RUST_LOG=debug pnpm --filter @bg-tax/ui dev

# Tauri DevTools: right-click in the app window → Inspect Element
```

## Bulgarian Tax Rules

The app implements flat tax rates per ЗДДФЛ:

- **Capital gains** (Приложение 5): **10%** on profit from sale of securities
- **Foreign dividends** (Приложение 8, Таблица 1): **5%** on gross dividend (WHT credit applies)
- **Foreign interest** (Приложение 8, Таблица 6): **10%** on gross interest

WHT credit formula: `tax_due = max(0, bg_rate × gross - wht_paid)` — excess foreign WHT is not refundable.

## Base Currency

- Tax year ≤ 2025: BGN (EUR/BGN fixed at 1.95583)
- Tax year ≥ 2026: EUR

## Data Sources

- **Interactive Brokers**: CSV activity statement — trades, dividends, WHT, stock yield
- **Revolut Savings**: CSV per currency/vault — interest paid, service fees
- **FX Rates**: Auto-fetched from ECB API (cached locally)

## Tech Stack

- **Tauri v2** — desktop shell (system webview, ~5-10MB binary)
- **TypeScript** — single language for all code
- **React** — UI with TanStack Table for editable data tables
- **Zustand** — state management with undo/redo
- **exceljs** — Excel generation with formulas
- **Vitest** — testing
- **pnpm workspaces** — monorepo
