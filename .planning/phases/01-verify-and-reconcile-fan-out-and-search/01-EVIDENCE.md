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

## DOC-01 status

Docs reconciled (commit 340be4b). All deliverables verified present on disk before ticking: SessionManager `agent:broadcast` case, logBufferStore, BroadcastBar, DestructiveSafetyModal, GlobalSearchModal, NotificationToastManager (mounted in App.tsx), and matching tests. 27 steps ticked (planning baseline said 28; the 28th match was the checkbox-syntax example in the document header, not a step). No "DOC-01 gaps".

Source check found two plan wording claims not matching code, so README states what the code does: global search has a regex toggle but no case-sensitivity option (`caseSensitive: false` is fixed), and toasts are in-app only (no browser Notification API use).

## Manual QA

PENDING-HUMAN. Procedure: docs/qa-test-plan.md section 5 (broadcast, destructive gate Cancel path, search, regex toggle, jump to pane, exit toast). Not executable by the automated executor (requires live tmux and browser). Per-step results: not yet recorded.
