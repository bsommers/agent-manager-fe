---
phase: 05-keyboard-first-operation-and-accessibility
plan: 02
subsystem: ui
tags: [keyboard, command-palette, accessibility, zustand, xterm]
requires:
  - phase: 05-01
    provides: useModalFocus (focus trap, Esc, restore)
provides:
  - Ctrl/Cmd+K command palette (agents, layouts, broadcast, search, filter, new agent)
  - Ctrl/Cmd+/ shortcut help overlay driven by a single registry
  - uiStore (one overlay slot, broadcast flag, focus requests)
  - terminal pass-through for registered chords
affects: [05-03]
tech-stack:
  added: []
  patterns: [single shortcut registry, store-driven overlays, render-driven focus requests]
key-files:
  created:
    - src/store/uiStore.ts
    - src/keyboard/shortcuts.ts
    - src/keyboard/hooks.ts
    - src/keyboard/commands.ts
    - src/components/layout/CommandPalette.tsx
    - src/components/layout/ShortcutHelp.tsx
    - docs/KEYBOARD.md
  modified:
    - src/App.tsx
    - src/components/layout/Header.tsx
    - src/components/layout/Toolbar.tsx
    - src/components/agent/TerminalView.tsx
    - README.md
    - docs/ARCHITECTURE.md
key-decisions:
  - "Chords match on event.key only, Alt must not be held, auto-repeat ignored"
  - "Palette has no destructive command; broadcast only reveals and focuses the bar"
  - "Panes rows are documentation-only in the registry; values pinned by test for 05-03"
status: complete
commits: 3
plan_head_before: d5241bba064f8f200310f70ef11e7864f6423843
plan_head_after: e93e33c97e85b2d41d02fab8f781954c989f3530
actuals:
  tasks: 3
  commits: 3
---

# Phase 5 Plan 02: Command palette and shortcut help Summary

Ctrl/Cmd+K command palette and Ctrl/Cmd+/ help overlay sharing one shortcut registry and one UI store, with registered chords passed through xterm so they work inside a terminal.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Tracer: Ctrl+K palette, layout command end to end | 8de5aec |
| 2 | Full command set, shared UI state, focus requests, terminal pass-through | 74e64f2 |
| 3 | Help overlay, full registry rows, docs | e93e33c |

## Verification

- Root `npm test`: 51 files / 592 tests (baseline 44 / 498). Server `npm --prefix server test`: 9 / 107 unchanged.
- `npx tsc --noEmit` and `npm run build` exit 0.
- Existing Header, Toolbar, App, GlobalSearchModal, AddAgentModal, BroadcastBar, AgentPane, FloatingPane and Workspace test bodies untouched and green.
- Real xterm used for the App-level terminal cases (Ctrl+K on the focused textarea opens the palette, Ctrl+C does not); no fallback to the double was needed.

## Reviewer fix applied: pane contract pin

`shortcuts.test.ts` ("Panes rows pin the 05-03 contract"), `ShortcutHelp.test.tsx` (help overlay text and kbd keys) and a docs cross-check test pin: Arrow = 10 px, Shift+Arrow = 50 px for both move and resize; resize Right/Down grow, Left/Up shrink; accessible names "Move pane <name>" and "Resize pane <name>". Plan 05-03 must implement exactly these values.

## Deviations from Plan

None in scope. Minor notes:

- The tracer test waits 80 ms before focusing the toolbar filter so the active terminal's deferred 50 ms auto-focus (existing behaviour) does not steal focus in the test.
- CommandPalette memoisation and the 50-row cap note were written in Task 1 (the component is one file) rather than Task 2; Task 2 added the tests that pin them.
- docs/KEYBOARD.md wraps `<name>` tokens in backticks (markdown would hide them as HTML); the docs test strips backticks before comparing with the registry.

## Known Stubs

None.

## Threat Flags

None. T-05-04..T-05-07 mitigated and covered by tests (chord pass-through only for registered chords, no destructive command, markup rendered as literal text, auto-repeat ignored, 50-row cap).

## Pending human check

In a browser: Ctrl+K inside a terminal, Go to an agent and confirm the cursor lands in its terminal; Ctrl+/ and compare with docs/KEYBOARD.md. After merge with 05-03, confirm the Panes rows match its pinned values.

## Self-Check: PASSED
