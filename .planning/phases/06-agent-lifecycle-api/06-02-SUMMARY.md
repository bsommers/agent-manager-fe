---
phase: 06-agent-lifecycle-api
plan: 02
subsystem: gateway
tags: [websocket, validation, idempotency, reqId, dispatch]
requires: ["06-01"]
provides:
  - "AgentApi: one validated dispatch path from client messages to AgentService with typed outcomes"
  - "IdempotencyCache (1024 entries, 5 minutes) shared by every surface that shares an AgentApi"
  - "wsFrames: the only mapping from outcomes and validation failures to agent:ack / agent:error"
affects: ["06-04", "06-06", "06-07"]
tech-stack:
  added: []
  patterns: ["parse (package validator) -> execute (AgentApi) -> map (wsFrames)"]
key-files:
  created:
    - server/src/gateway/dispatch.ts
    - server/src/gateway/idempotency.ts
    - server/src/gateway/wsFrames.ts
    - server/src/gateway/__tests__/dispatch.test.ts
    - server/src/gateway/__tests__/idempotency.test.ts
    - server/src/gateway/__tests__/wsFrames.test.ts
    - server/__tests__/lifecycle.test.ts
  modified:
    - server/src/index.ts
    - server/src/services/SessionManager.ts
    - server/README.md
    - docs/superpowers/specs/2026-11-07-fe-be-contract.md
    - server/__tests__/rosterContract.test.ts
    - server/__tests__/killSession.test.ts
    - server/src/services/__tests__/SessionManager.test.ts
    - server/src/services/__tests__/SessionManagerKillSession.test.ts
decisions:
  - "reqId stays optional on the wire; the FE always sending it is a client rule (06-03), not a schema change"
  - "PAYLOAD_TOO_LARGE only when the validator failed on the data field itself, so an invalid agentId on a large frame stays USAGE"
  - "Refusals (UNSUPPORTED backend/params/history/approve) happen before the idempotency cache and are never cached"
status: complete
requirements: [INT-03, GW-04]
duration: 55m
completed: 2026-11-08
commits: 3
plan_head_before: 4896519d5e45c620012a55622b2a9006f5245b75
plan_head_after: afd3c80f39bb5a630a62eeefd8fbefe7f5ae0cd8
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
---

# Phase 6 Plan 02: Validated dispatch, reqId acks and idempotency Summary

The gateway now validates every client frame with `parseClientMessage`, runs it through one `AgentApi.execute` path, and answers create, kill and update with a reqId-correlated `agent:ack` or typed `agent:error`. A repeated reqId is idempotent (1024 entries, 5 minutes, shared across surfaces) and a reqId reused for a different request is `CONFLICT`.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 Tracer: validated create/kill/update with acks over a real WebSocket | 4acbaea | `dispatch.ts`, `wsFrames.ts`, thin `SessionManager.handleClientMessage`, validation hook in `index.ts` (+8/-2 lines); unknown id is NOT_FOUND; `agent:update` renames and announces `agent:updated` |
| 2 Idempotency, CONFLICT, UNSUPPORTED | f60fc61 | `idempotency.ts` (Map-backed, injectable clock, failures not cached), cache wired into create/kill/update; backend/params/history/approve refused |
| 3 Hardening, PAYLOAD_TOO_LARGE, docs | afd3c80 | oversize `data` maps to PAYLOAD_TOO_LARGE, `stats.invalidFrames`, README and spec sections 4.1, 4.2, 6.1 |

Tracer gate: the end-to-end ack path was verified over a real WebSocket in Task 1 (lifecycle suite green) before Tasks 2 and 3 expanded it.

## Tests

- New: idempotency 21, dispatch 29, wsFrames 32, lifecycle 38 (over a real WebSocket, port 0, drivers and tmux mocked).
- Gate: root `npm test` 84 files / 1516 tests (baseline 80/1394; the four new files are picked up), server 20 files / 400 tests (baseline 16/278), `npx tsc --noEmit`, `npm run build`, `npm --prefix server run build`, `npm run contract:check` all pass. `hardening.test.ts` and `index.test.ts` are untouched and passed first time.

## Pinned assertions edited on purpose

| File | Assertion | Reason |
|------|-----------|--------|
| `rosterContract.test.ts` | "answers a kill of an unknown id with an unchanged snapshot to every client" | now NOT_FOUND to the requester only, no snapshot to anyone; asserts the roster via a fresh connection |
| `rosterContract.test.ts` | "ignores agent:update today" | replaced by a test that a rename is announced as `agent:updated` to both clients and visible in a fresh connection; header comment updated |
| `killSession.test.ts` | `rosterNow` sentinel (unknown-id kill snapshot) | replaced by a fresh connection's first frame plus a ping on the second client; the confirm-table `snapshotsAfter(c1)` count becomes 0 because the sentinel no longer lands on c1 |
| `killSession.test.ts` | "confirmed killSession for an unknown agent id ... unchanged snapshot" | now expects NOT_FOUND to the requester and no snapshot |
| `SessionManagerKillSession.test.ts` | "confirmed killSession for an unknown id ... broadcasts an unchanged snapshot" | now expects one NOT_FOUND reply through the callback and no snapshot |
| `SessionManager.test.ts` | five "should route ..." tests | see deviation 1 (spies moved from SessionManager wrappers to `manager.service`); two new cases added (synchronous effect before return, NOT_FOUND through the callback) |

## Deviations from Plan

**1. [Rule 3 - Blocking] Route tests in SessionManager.test.ts spied on SessionManager wrapper methods**
- **Found during:** Task 1
- **Issue:** the plan allows editing `SessionManager.test.ts` only for the unknown-id snapshot, but five "should route agent:create/input/resize/kill/broadcast" tests spy on `manager.createAgent/sendInput/resizeSession/killAgent`. With dispatch calling the service directly (as the plan requires: each operation calls exactly one service method) those spies are never hit.
- **Fix:** the spies now target `manager.service.create/input/resize/close/input`; same intent, assertions on arguments kept (create now receives the input object).
- **Files modified:** `server/src/services/__tests__/SessionManager.test.ts`
- **Commit:** 4acbaea

**2. [Rule 1 - Test bug] Test harness**: `vi.restoreAllMocks()` in `afterEach` reset the module-level `vi.fn().mockImplementation` driver mocks (all later tests failed); replaced by restoring only the console spies. Also the first `agent:history` test frame lacked `beforeSeq` (the validator requires exactly one of beforeSeq/afterSeq) and a markup test value was valid; both fixed in the tests only.

**3. Scope choice (not a plan conflict):** PAYLOAD_TOO_LARGE is returned only when the failing field is `data`; the plan text says "whose raw data is over the limit" without that condition. A frame with an invalid `agentId` and large data stays USAGE (tested).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register (T-06-05 to T-06-10 mitigated as planned: package validation before any action, bounded cache with tested limits, value-free error text).

## Self-Check: PASSED

Files verified present: `server/src/gateway/{dispatch,idempotency,wsFrames}.ts`, the four new test files, this summary. Commits 4acbaea, f60fc61, afd3c80 are ancestors of HEAD.
