# Suggested Commands

## Install
```bash
pnpm install
```

## Testing
```bash
pnpm --filter @bg-tax/core test        # Run all core tests (vitest)
pnpm --filter @bg-tax/core test:watch  # Watch mode
pnpm --filter @bg-tax/core test -- tests/parsers/ib-csv.test.ts  # Specific file
pnpm --filter @bg-tax/core test -- -t "parses trades"  # Specific test name
```

## Development
```bash
pnpm dev                                # Full Tauri desktop app (requires Rust)
pnpm --filter @bg-tax/ui dev:vite      # Frontend only (http://localhost:5115)
```

## Build
```bash
pnpm --filter @bg-tax/ui build         # Production frontend build
cd packages/ui && pnpm tauri build      # Desktop app binary (.dmg/.msi/.deb)
```

## System utils (macOS/Darwin)
```bash
git status && git diff
```
