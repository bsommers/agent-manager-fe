---
phase: 03-transport-reconnect-and-connection-state
plan: 01
subsystem: transport
tags: [websocket, reconnect, heartbeat, zustand, demo-mode]
requires: []
provides:
  - Transport with capped jittered reconnect and heartbeat
  - WsAdapter, MockAdapter (explicit Demo mode), resolveBackendConfig/createBackend
  - useConnectionStore (mode + connection snapshot)
affects: [03-02]
tech-stack:
  added: []
  patterns: [adapter over transport, injected fakes for socket tests]
key-files:
  created:
    - src/services/adapters/types.ts
    - src/services/adapters/WsAdapter.ts
    - src/services/adapters/MockAdapter.ts
    - src/services/transport/Transport.ts
    - src/services/transport/backoff.ts
    - src/services/backend.ts
    - src/store/connectionStore.ts
  modified:
    - src/services/agentSocket.ts
    - src/setupTests.ts
    - src/vite-env.d.ts
decisions:
  - "Heartbeat ping typed locally in Transport.ts (PingFrame); wsProtocol untouched"
  - "attempt counts scheduled retries; delay ceiling uses pre-increment attempt (500, 1000, ...)"
status: complete
commits: 2
plan_head_before: ff4e6e91d1c4f63a4aaaff6a5e767b5c09049a8a
plan_head_after: d2c7efbadbe89fa27726575466fbdae355e4bdb4
actuals:
  tasks: 2
  commits: 2
---

# Phase 3 Plan 1: Transport, reconnect and connection state Summary

Layered live path (Transport -> WsAdapter -> agentSocket shim -> connectionStore) with 500ms/x2/15s full-jitter reconnect, 15s/10s ping heartbeat, 4401 auth_failed, and simulated output only via MockAdapter in explicit Demo mode.

## Commits
- d51a090 Task 1: layered live path, adapters, config, store, shim
- d2c7efb Task 2: backoff, reconnect, heartbeat, reconnectNow, sweep

## Verification
- `npm test`: 29 files / 194 tests passed (baseline 23 / 132); `npx tsc --noEmit` clean.
- Negative searches for `isMockMode`, fallback-to-mock messages and `NODE_ENV` under src: no matches.

## Deviations from Plan
- Worktree was based on 95521d0 (behind master); fast-forwarded to master ff4e6e9 to obtain the plan files. Not a code deviation.
- wsProtocol.ts was already a re-export on master; no change needed.

## Known Stubs
None.

## Self-Check: PASSED
