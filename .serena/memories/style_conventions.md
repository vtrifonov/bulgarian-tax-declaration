# Style & Conventions

## Code Style
- TypeScript strict mode everywhere
- No `any` types in production code
- Pure functions preferred; classes only for stateful engines (FifoEngine, FxService)
- All tax amounts are POSITIVE — callers Math.abs() negative WHT values from IB CSV

## Testing
- TDD: write failing test first, then implement
- Minimum 50% code coverage target
- Vitest with fixtures in tests/fixtures/

## Architecture
- packages/core has ZERO UI dependencies
- All business logic in core — UI only handles rendering
- State flows: parsers → FIFO → tax → declaration → Excel

## Commit Messages
Format: `type: description` (feat, fix, test, chore, docs, refactor)
