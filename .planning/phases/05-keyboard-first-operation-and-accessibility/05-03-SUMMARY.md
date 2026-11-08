---
phase: 05-keyboard-first-operation-and-accessibility
plan: 03
subsystem: ui
tags: [a11y, keyboard, floating-pane]
requires: []
provides:
  - keyboard move/resize of floating panes (10 px, 50 px with Shift)
  - accessible names for pane controls and text status in the pane header
affects: [05-02, 05-04]
key-files:
  created:
    - src/components/layout/paneKeyboard.ts
    - src/components/layout/__tests__/paneKeyboard.test.ts
    - src/components/layout/__tests__/FloatingPaneKeyboard.test.tsx
    - src/components/agent/__tests__/AgentPaneA11y.test.tsx
    - src/components/agent/__tests__/AgentControlsA11y.test.tsx
  modified:
    - src/components/layout/FloatingPane.tsx
    - src/components/agent/AgentPane.tsx
    - src/components/agent/AgentControls.tsx
decisions:
  - Keyboard move/resize never calls bringToFront or setActiveAgentId (avoids terminal focus theft)
  - No upper bound on keyboard move/resize, matching the mouse path
status: complete
requirements: [UX-08]
commits: 2
plan_head_before: d5241bb
plan_head_after: 427ab3b73b6c9298e2e205224b78fc8bdea4ed2a
actuals:
  tasks: 3
  commits: 2
---

# Phase 5 Plan 3: Pane chrome accessibility Summary

Floating panes can be moved and resized with the arrow keys (10 px, 50 px with Shift) from focusable, named handles, every pane control has an accessible name that includes the agent name, and status is shown as text.

## What was built

- `paneKeyboard.ts`: pure `movePane` / `resizePane` / `isArrowKey` plus shared limits (x 10, y 50, 300 x 200) now also used by the mouse path.
- FloatingPane: title bar is a button named "Move pane <name>", resize handle a button named "Resize pane <name>", both with sr-only hints and focus rings; keyboard actions read the latest layout from the store and do not call bringToFront.
- AgentControls: optional `agentName`, aria-labels, `type="button"`, hidden icons; titles unchanged.
- AgentPane: role group "Agent <name>", `pane-status` text chip (hidden when pending), aria-hidden dot.

## Tests

Added a pin test (per reviewer) asserting Arrow = 10 px, Shift+Arrow = 50 px, resize 10/50 with Right/Down growing and Left/Up shrinking, and the exact accessible names; matches what 05-02 documents. Mouse tests unedited.

Totals: root 48 files / 564 tests (baseline 44 / 498); server 9 / 107.

## Deviations from Plan

- Tasks 1 and 2 were committed together (same FloatingPane edit, one commit `9198937`) rather than as two commits.
- Test-only: a first draft of the resize clamp test used too few presses; fixed before commit.
- Noted: `server/__tests__/hardening.test.ts` "never terminates a responsive client" failed once in a root `npm test` run under load and passed on rerun (timing flake, pre-existing, out of scope).

## Known Stubs

None.

## Self-Check: PASSED
