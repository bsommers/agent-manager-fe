---
phase: 03-transport-reconnect-and-connection-state
plan: 02
subsystem: ui
tags: [react, zustand, connection-state, docs]
requires: ["03-01"]
provides: [ConnectionStatusChip, ConnectionBanner, ADR-007]
affects: [Header, App]
key-files:
  created:
    - src/components/layout/ConnectionStatusChip.tsx
    - src/components/layout/ConnectionBanner.tsx
    - src/components/layout/__tests__/ConnectionStatusChip.test.tsx
    - src/components/layout/__tests__/ConnectionBanner.test.tsx
  modified:
    - src/components/layout/Header.tsx
    - src/App.tsx
    - src/components/__tests__/Header.test.tsx
    - src/App.test.tsx
    - docs/RUNNING.md
    - docs/RATIONALE_AND_DESIGN_DECISIONS.md
    - docs/ARCHITECTURE.md
    - README.md
requirements: [INT-01]
status: complete
actuals:
  tasks: 3
  commits: 3
plan_head_before: 57093ab
plan_head_after: 85d9b4fa00706de04b84b942144c0144be1eca28
commits: 3
---

# Phase 3 Plan 02: Connection chip, banner and docs Summary

Header connection chip and global banner driven by connectionStore (Demo, reconnecting countdown with Retry now, closed with Reconnect, auth_failed), plus RUNNING.md, ARCHITECTURE.md, README and ADR-007 documenting the explicit Demo mode.

## Commits
- d688d44 feat: ConnectionStatusChip in Header
- ad76efa feat: ConnectionBanner in App
- 85d9b4f docs: RUNNING, ADR-007, ARCHITECTURE, README

## Verification
- Root `npm test`: 34 files / 329 tests pass; `npx tsc --noEmit` 0; `npm run build` ok
- Server: 8 files / 98 tests pass; build ok
- Doc grep checks from Task 3 pass

## Deviations from Plan
- Banner test and component were written in one step, so the banner RED run was not separately observed (chip RED was observed). Minor tsc type fix to the spy type in the banner test.
- Tracer gate: `<verify>` re-run passed before expansion.

## Known Stubs
None.

## Self-Check: PASSED
