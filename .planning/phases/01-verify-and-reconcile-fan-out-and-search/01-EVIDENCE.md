# Phase 1 Evidence: Fan-out and Search Baseline

- Git short SHA: 95521d0
- Date: 2026-11-07

## Command results (VER-01)

| # | Command | Exit | Test Files | Tests |
|---|---------|------|-----------|-------|
| 1 | `npm test` (vitest run) | 0 | 23 passed (23) | 132 passed (132) |
| 2 | `npx tsc --noEmit` | 0 | - | - |
| 3 | `npm run build` (tsc + vite build) | 0 | - | - |
| 4 | `npm --prefix server test` | 0 | 7 passed (7) | 51 passed (51) |
| 5 | `npm --prefix server run build` (tsc) | 0 | - | - |

Counts equal the planning baseline (root 23 files / 132 tests, server 7 files / 51 tests).

## VER-01 status

PASS
