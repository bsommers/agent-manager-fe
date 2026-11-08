---
phase: 06-agent-lifecycle-api
plan: 03
subsystem: frontend-store
tags: [reqId, request-layer, agent-ack, agent-error, roster, notices]
requires: [10-01, 09.1-04]
provides:
  - src/services/agentRequests.ts (AgentRequests, AgentRequestError, newReqId, REQUEST_TIMEOUT_MS)
  - AgentSocketService.request(build), ack/error routing, re-send on reopen
  - reqId-driven addAgent, removeAgent, updateAgent in the agent store
affects: [06-05]
tech-stack:
  added: []
  patterns: [reqId-correlated request/ack over WebSocket, request layer owns every timer, typed rollback]
key-files:
  created:
    - src/services/agentRequests.ts
    - src/services/__tests__/agentRequests.test.ts
    - src/store/__tests__/agentStoreLifecycle.test.ts
  modified:
    - src/services/agentSocket.ts
    - src/store/agentStore.ts
    - src/store/rosterReconcile.ts
    - src/services/__tests__/agentSocket.test.ts
    - src/store/__tests__/agentStoreRoster.test.ts
    - src/store/__tests__/agentStoreRosterFailures.test.ts
    - src/store/__tests__/agentStoreKillSession.test.ts
    - src/store/__tests__/rosterReconcile.test.ts
    - src/components/agent/__tests__/AgentControlsKillSession.test.tsx
key-decisions:
  - "Answers that settle (or belong to a recently settled) request are consumed by the request layer and never reach agentSocket listeners; only unmatched agent:error reaches the store, where it becomes a gateway_error notice"
  - "A user-cancelled create stays in flight in the request layer so its late ack adds one ordinary agent without taking focus"
  - "Notice text from the gateway is sanitized (control chars stripped, whitespace collapsed, 200 chars total) and rendered as a text node"
requirements-completed: [INT-03]
status: complete
actuals:
  tokens: 70000
  tasks: 3
  commits: 3
plan_head_before: 4896519d5e45c620012a55622b2a9006f5245b75
plan_head_after: 8f19f2ae0bfa397b030d69748c60a6058d6059e9
---

# Phase 6 Plan 3: Request layer and reqId-driven lifecycle Summary

Every live create, kill and update is now correlated with its gateway answer by `reqId` through `AgentRequests`, resolving with the matching `agent:ack` or rejecting with a typed `AgentRequestError` (gateway code, `NOT_CONNECTED`, or local `TIMEOUT` after 10 s); in-flight requests are re-sent with the same reqId when the socket reopens (max 3 transmissions).

## Tasks

| Task | Commit | Result |
| ---- | ------ | ------ |
| 1 Tracer: create by reqId | b343ebc | Request layer, pending pane settled by ack in either order with a snapshot, typed rollback, reconcileSnapshot no longer claims by name/mode/targetHost |
| 2 Kill, close, update, resend | f4fff6c | Kill ack/refusal/NOT_FOUND handling, `updateAgent`, resend on reopen, store timers removed |
| 3 Notices | 8f19f2a | gateway_error notice for uncorrelated errors, sanitization, duplicate suppression, cap of 20, full gate |

## Verification

- `npm test`: 82 files / 1477 tests (baseline 80 / 1394). `npm --prefix server test`: 16 / 278 (unchanged). `npx tsc --noEmit`, `npm run build`, `npm --prefix server run build`, `npm run contract:check` all exit 0.
- New: agentRequests 24 cases, agentStoreLifecycle 49, agentSocket +8.
- `grep -c 'armRequestTimer\|requestTimers'` and `setTimeout|clearTimeout` in agentStore.ts: 0 (baselines 8 and 2); `grep -c claimed` in rosterReconcile.ts: 0 (baseline 11).
- One run of the full root suite showed `server/__tests__/hardening.test.ts > liveness > never terminates a responsive client` failing under parallel load (06-02 was running concurrently); it passes alone and in the next full run. Unrelated to src/**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] AgentControlsKillSession.test.tsx edited**
- **Found during:** Task 2
- **Issue:** Two assertions pin the exact `agent:kill` frame; frames now always carry `reqId` (the plan requires this and lists the file in Task 2 verify), so the file could not pass unedited, contradicting the "unedited" note and the Task 3 criterion that only `files_modified` change.
- **Fix:** Added `reqId: expect.any(String)` to the two expected frames. No component code changed.
- **Files modified:** src/components/agent/__tests__/AgentControlsKillSession.test.tsx
- **Commit:** f4fff6c

**2. [Rule 3 - Plan consistency] Timer assertions in cancel tests**
- A cancelled pending create stays in flight in the request layer (so a late ack can add the agent), hence two pinned assertions `getTimerCount() === 0` after cancelling became `=== 1` (agentStoreRosterFailures, agentStoreKillSession). Intentional per the plan's cancel behavior.

None otherwise; the plan executed as written. Task 3 RED run was not observed separately (tests and implementation written in one pass for that task; assertions are concrete).

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. T-06-11 to T-06-15 mitigated as planned (parseServerMessage gate, 20-notice cap and 64-entry settled memory, sanitized plain-text notices, same-reqId re-send, UUID v4 reqIds).

## Notes for the orchestrator

- Merge with 06-02 before any live run: a Phase-10 gateway never acks, so creates time out after 10 s.
- `updateAgent` has no UI yet (UX-02 open); `agent:added/removed/updated` handling is 06-05.

## Self-Check: PASSED

Files exist (agentRequests.ts, agentRequests.test.ts, agentStoreLifecycle.test.ts); commits b343ebc, f4fff6c, 8f19f2a are in the branch history.
