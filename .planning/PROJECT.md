# Agent Manager FE

## What This Is
A web UI (React 18 + Vite + Zustand + xterm.js) for managing multiple AI agent terminal sessions, backed by a Node/Express + WebSocket server (`server/`) that drives tmux/SSH sessions. Users get a freeform window grid (Grid/Cascade/Focus snapping), per-agent terminals, multi-agent command broadcast, global log search and status toasts.

## Core Value
Run and supervise many agent terminals from one screen, safely and observably.

## Requirements

### Validated (existing, shipped)
- Agent session create/kill/resize/input over WebSocket (port 8088)
- Freeform draggable windows with Grid/Cascade/Focus layouts
- Zustand state, consolidated protocol schemas, raw PTY input streaming
- Multi-agent `agent:broadcast` with destructive-command safety modal (BroadcastBar)
- Bounded ring-buffer log store + GlobalSearchModal with jump-to-pane
- NotificationToastManager for status transitions
- Test coverage ~93.8% (vitest)

### Active
- Verify and close out the fan-out/global-search milestone (plan checkboxes in docs are unticked; code is merged)

### Out of Scope
- None declared yet

## Context
Brownfield; existing design docs in `docs/` and `docs/superpowers/{specs,plans}` are the source of truth for history. Codebase map in `.planning/codebase/`.

## Constraints
- Stack: TypeScript, React 18, Vite 5, Tailwind 3, vitest; server is Node + ws
- Default backend WS port 8088

## Key Decisions
See `docs/RATIONALE_AND_DESIGN_DECISIONS.md`.

---
*Created by gsd-onboard on 2026-11-07*
