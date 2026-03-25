# Bulgarian Tax Declaration (Данъчна декларация)

**[Open the app](https://vtrifonov.github.io/bulgarian-tax-declaration/)** — hosted version, runs entirely in your browser.

> **Privacy:** Your tax data is stored only locally. Nothing is sent to any server.
>
> **Access:** The app requires a Google login. To get access, contact **Vasil Trifonov** ([v.trifonov@gmail.com](mailto:v.trifonov@gmail.com)).

Desktop application for Bulgarian taxpayers (expats/investors) to prepare their annual tax declaration (Годишна данъчна декларация по чл. 50 от ЗДДФЛ).

Parses Interactive Brokers (trades, dividends, WHT, stock yield, interest), Revolut savings (interest per currency and fund positions for SPB-8 Section 04), Revolut investments (trades), E*TRADE/Morgan Stanley (holdings, interest, cash balances from PDF statements), and Bondora (P2P lending interest and account balances from Tax Report PDF or Account Statement CSV). Calculates Bulgarian taxes using FIFO lot matching and exports a formatted Excel declaration. The Import page also allows manual entry of foreign bank account balances (e.g. Revolut, Wise current accounts) for SPB-8 Section 03.

Holdings in the workspace represent end-of-period open positions. Trades that open and close within the same imported statement generate sales, but do not remain in holdings. FIFO matching is scoped to the same `symbol` and `currency`, and only against lots from the same broker or brokerless legacy holdings.

The exported `Данъчна_2025.xlsx` workbook is also a resumable project file. Loading it restores the main tax state plus SPB-8 state, including:
- foreign accounts (`СПБ-8 Сметки`)
- securities and explicit year-end prices (`СПБ-8 Ценни Книжа`)
- Revolut savings fund positions (`Спестовни Ценни Книжа`)
- SPB-8 personal data (`СПБ-8 Лични Данни`)

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
│   │   │   ├── providers/      # BrokerProvider registry (IB, Revolut, E*TRADE, etc.)
│   │   │   ├── parsers/       # CSV/Excel parsers, PDF parsers, WHT matcher
│   │   │   ├── fx/            # ECB API client, FX cache, gap-fill
│   │   │   ├── fifo/          # FIFO lot matching engine
│   │   │   ├── tax/           # Bulgarian tax rules + calculator
│   │   │   ├── validation/    # Non-blocking warnings
│   │   │   ├── declaration/   # NRA form field mapping (2025, 2026)
│   │   │   ├── excel/         # Full xlsx generation (exceljs)
│   │   │   ├── i18n/          # BG/EN string tables
│   │   │   ├── country-map.ts # Symbol → country + OpenFIGI fallback
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

## NRA Form Filler

Automates filling **Приложение 8, Част III** (foreign dividends) in the NRA online tax declaration portal.

### Clipboard Script (Web + Desktop)

A self-contained JavaScript snippet you paste into your browser's DevTools console.

1. In the Declaration page, click **"Генерирай скрипт"**
2. Navigate to the NRA portal → Приложение 8, Част III
3. Open DevTools console (`Cmd+Option+J` on Mac / `F12` on Windows → Console tab)
4. If the console asks, type `allow pasting` and press Enter
5. Paste the script and press Enter
6. Watch the blue progress bar in the top-right corner — click **"Спри"** to stop early

### Browser Automation (Desktop Only)

Launches a Chromium browser via Playwright. Requires **Node.js ≥ 20** ([download](https://nodejs.org/en/download)).

1. In the Declaration page, click **"Отвори браузър"**
2. Log in to the NRA portal and navigate to Приложение 8, Част III
3. A confirmation overlay appears — click **"Попълни"** to auto-fill all rows
4. Review the filled form and submit manually

## Commands

### Root (monorepo)

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm test` | Run tests in all packages |
| `pnpm test:core` | Run core library tests only |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm format` | Format code with dprint |
| `pnpm spell` | Spellcheck with cspell |
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

- **Interactive Brokers**: CSV activity statement — trades, dividends, WHT, stock yield, interest
- **Revolut Savings**: Statement per currency fund — interest paid, service fees
- **Revolut Investments**: Account statement — trades (buys/sells)
- **E*TRADE/Morgan Stanley**: PDF statement — holdings, interest, cash balances
- **Bondora**: Tax Report PDF or Account Statement CSV — P2P lending interest, account balances
- **FX Rates**: Auto-fetched from ECB API (cached locally)

## Excel Round-trip

The main workbook is intended to round-trip cleanly:

- import broker files and/or prior holdings
- export `Данъчна_2025.xlsx`
- re-import `Данъчна_2025.xlsx`
- export again with the same workbook data

This round-trip includes holdings, sales, dividends, interest, FX sheets, and the SPB-8 tabs.

## Contributing

We welcome contributions, especially new broker providers! See [AGENTS.md](./AGENTS.md) for:
- Code principles and style guide
- Step-by-step guide for adding a new broker provider
- Testing requirements and Excel round-trip contract
- Before-push checklist

## Tech Stack

- **Tauri v2** — desktop shell (system webview, ~5-10MB binary)
- **TypeScript** — single language for all code
- **React** — UI with TanStack Table for editable data tables
- **Zustand** — state management with undo/redo
- **exceljs** — Excel generation with formulas
- **Vitest** — testing
- **pnpm workspaces** — monorepo
