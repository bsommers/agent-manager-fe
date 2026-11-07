---
phase: 05-keyboard-first-operation-and-accessibility
plan: 01
subsystem: ui
tags: [a11y, focus-trap, aria, modal, react]
requires: []
provides:
  - useModalFocus hook (focus trap, Escape, initial focus, restoration, modal stack)
  - labelled dialog semantics on destructive confirmation, Add Agent and Global Search modals
affects: [05-keyboard-first-operation-and-accessibility]
tech-stack:
  added: []
  patterns: [shared hook with module-level modal stack, window keydown listener only while open]
key-files:
  created:
    - src/hooks/useModalFocus.ts
    - src/hooks/__tests__/useModalFocus.test.tsx
    - src/components/layout/__tests__/DestructiveSafetyModal.test.tsx
  modified:
    - src/components/layout/DestructiveSafetyModal.tsx
    - src/components/agent/AddAgentModal.tsx
    - src/components/__tests__/AddAgentModal.test.tsx
    - src/components/layout/GlobalSearchModal.tsx
    - src/components/layout/__tests__/GlobalSearchModal.test.tsx
decisions:
  - Hand-written focus trap, no new dependency
  - Destructive confirmation opens focused on Cancel; no backdrop dismissal
status: complete
requirements: [UX-08]
commits: 3
plan_head_before: 57093ab5fd6bdd9be8227c9c983e3c679401a1b0
plan_head_after: 59a2cef5467c6c60381d0076a5b9a200d5b0457d
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
---

# Phase 5 Plan 01: Modal focus and dialog semantics Summary

One shared `useModalFocus` hook (focus trap, Escape, initial focus, focus restoration, topmost-modal stack) applied to all three modals, each now a labelled `dialog`/`alertdialog` with accessible control names.

## Tasks

| Task | Commit | Notes |
| ---- | ------ | ----- |
| 1 hook + DestructiveSafetyModal | e9c2f2b | 14 hook tests, 7 modal tests; Cancel gets initial focus |
| 2 AddAgentModal | 10c99cc | htmlFor/id labels, aria-pressed, Close name |
| 3 GlobalSearchModal | 59a2cef | own Escape listener and 50 ms timeout removed |

## Verification

- Root `npm test`: 34 files / 346 tests pass (baseline 32 / 311)
- `npm --prefix server test`: 8 files / 98 tests pass
- `npx tsc --noEmit`, `npm run build`, `npm --prefix server run build`: exit 0
- Header.tsx, App.tsx, Toolbar.tsx, package files untouched

## Deviations from Plan

**1. [Rule 1 - Type] Hook return type**: plan implied React 19 style refs; project uses React 18 types, so the hook returns `RefObject<T>` (not `RefObject<T | null>`). No behavior change.

Otherwise none. Hook and its tests were authored together before the modal test RED run; the modal tests were confirmed failing (6 of 7, 7 of 7 in Task 2, 6 new in Task 3) before the modals were changed.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

All created files exist; commits e9c2f2b, 10c99cc, 59a2cef on branch.
