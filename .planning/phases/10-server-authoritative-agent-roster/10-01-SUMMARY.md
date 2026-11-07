---
phase: 10-server-authoritative-agent-roster
plan: 01
subsystem: frontend-roster
tags: [zustand, websocket, roster, live-mode, UX-02]
requires: [02-02 shared protocol validators, 03-01 transport and connectionStore]
provides: [live-mode server-authoritative roster, pending/confirmed create, server-confirmed kill, roster error notices]
affects: [src/store/agentStore.ts, src/services/agentSocket.ts, AgentPane, Workspace, NotificationToastManager]
tech-stack:
  added: []
  patterns: [pure reconcile module, store-owned timers cleared on settle, snapshot-as-truth]
key-files:
  created:
    - src/store/rosterReconcile.ts
    - src/store/__tests__/agentStoreRoster.test.ts
    - src/store/__tests__/agentStoreRosterFailures.test.ts
    - src/store/__tests__/rosterReconcile.test.ts
    - src/components/agent/__tests__/AgentPane.test.tsx
  modified:
    - src/services/agentSocket.ts
    - src/services/__tests__/agentSocket.test.ts
    - src/store/agentStore.ts
    - src/components/layout/NotificationToastManager.tsx
    - src/components/layout/__tests__/NotificationToastManager.test.tsx
    - src/components/agent/AgentPane.tsx
    - src/components/layout/Workspace.tsx
    - src/components/layout/__tests__/Workspace.test.tsx
    - src/components/agent/__tests__/AgentControls.test.tsx
    - src/components/layout/__tests__/BroadcastBar.test.tsx
decisions:
  - "Pending create is an ordinary Agent (id pending-<n>, status idle) plus an entry in the store's pending map; the protocol package is untouched"
  - "Snapshot reconciliation claims a pending create by name/mode/targetHost, FIFO, only against agents not in the roster before"
  - "Create rollback restores the previous active agent only when the pending pane is still the active one"
status: complete
actuals:
  tokens: 18500
  tasks: 3
  commits: 3
plan_head_before: b5cb6c1847ead030d44b6e1a4cf5c2c897d82ca6
plan_head_after: f006f1526fd4f9c9aca43f19d2e720cac4953bca
---

# Phase 10 Plan 01: Server-authoritative agent roster Summary

In live mode the roster now starts empty and follows the gateway: Add Agent sends `agent:create`, shows a Starting pane, and turns it into the server agent when an `agent:init_list` snapshot announces it; kill is confirmed by a later snapshot; unconfirmed requests roll back with a visible error notice. Demo mode is unchanged.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 Live Add Agent end to end (tracer) | ae6e63a | `agentSocket.send` returns the delivery boolean; `rosterReconcile.ts`; `initialAgentsFor`; `pending` map; subscription routes `agent:init_list` to `applyRosterSnapshot` |
| 2 Failure paths and notices | bc0144f | 10 s create rollback and kill timeout, pending cancel, kill guard, `applyStatusChange`, snapshot hardening via `parseAgent`, roster notices in `NotificationToastManager` (8 s auto-dismiss) |
| 3 Pane states | f006f15 | STARTING chip with Cancel, CLOSING chip, empty-roster message in `Workspace` |

## Folded-in review fixes

1. `agentStoreRoster.test.ts` uses gateway-real fixtures copied from `SessionManager.createAgent` (`agent-<ts>-xxxx`) and `TmuxDiscovery` (`tmux-foo`, "Tmux: foo"); both survive `parseAgent`, and a pending create is claimed against the real createAgent shape.
2. Cancelled create then snapshot: roster holds exactly one ordinary agent, no pending, no timers (`agentStoreRosterFailures.test.ts`).
3. Snapshot after rollback: no duplicate, no stuck pending entry, one notice, no timers (same file).

## Known limits

- The create timeout starts at send time, not at connection time. A create sent just before a slow reconnect can be rolled back (and an error notice shown) even though the gateway later processes it. The agent then arrives in a later snapshot as an ordinary agent (pinned by the snapshot-after-rollback test), so the roster stays correct, but the user has seen an error for a create that succeeded. Phase 6 `reqId`/`agent:ack` correlation removes this.
- BroadcastBar counts a pending pane as a target until it is confirmed (a broadcast to the temporary id is a no-op on the gateway).
- If the gateway fails to spawn the driver it registers the agent without announcing it, so a ghost agent can appear in a later snapshot (Phase 6 typed create errors fix this server-side).
- Initial terminal output that arrives before the new pane mounts is replayed only by the redraw on the pane's first resize (full replay is Phase 11).
- Pending claim by name/mode/targetHost can match an identical agent created by another client at the same moment (T-10-02, accepted; Phase 6 replaces it with `reqId`).

## Deviations from Plan

**1. [Rule 3 - Blocking] Two test files outside the plan's file list edited.** Changing `agentSocket.send` to return `boolean` made `tsc --noEmit` fail on `vi.spyOn(agentSocket, 'send').mockImplementation(() => {})` in `src/components/agent/__tests__/AgentControls.test.tsx` and `src/components/layout/__tests__/BroadcastBar.test.tsx`. One-token change each (`() => {}` to `() => true`); no assertions touched. Commit ae6e63a.

**2. Task 2 order.** Task 2 implementation was written before its test files (Task 1 followed RED then GREEN). The tests were then run and written to fail on the contract (assertions on timers, notices, killing, hardening); they pass against the implementation, but there is no separate RED run for Task 2.

**3. Rollback active-id rule.** The plan says active returns to the previously active agent; implemented as: only when the pending pane is still active at rollback time, so a user who has since selected another pane is not yanked back.

**4. STATE.md / ROADMAP.md not updated.** The `gsd_run` SDK is not available in this worktree and this plan runs in a parallel wave; the orchestrator owns state updates after merge.

Test note: `AgentPane.test.tsx` avoids `vi.restoreAllMocks()` (vitest 1.6 resets the xterm `vi.fn()` implementations) and unmounts before resetting store state.

## Verification

- `npm test`: 43 files / 489 tests passed (baseline 39 / 439)
- `npx tsc --noEmit`: exit 0
- `npm run build`: exit 0
- `git diff b5cb6c1 -- server packages/protocol .github vite.config.ts package.json package-lock.json src/store/__tests__/agentStore.test.ts FloatingPane.tsx AgentControls.tsx`: empty
- Server suite not re-run (no server change).

## Known Stubs

None.

## Threat Flags

None. T-10-01 (hostile snapshot) mitigated by `parseAgent` plus non-array guard, tested with a payload containing markup, logging counts only; T-10-04 timers are cleared on every settle and asserted with `vi.getTimerCount()`.

## Self-Check: PASSED

Created files exist; commits ae6e63a, bc0144f, f006f15 are on the branch.
