---
phase: 06-agent-lifecycle-api
plan: 01
subsystem: gateway-service-layer
tags: [gateway, service-layer, agent-service, typed-errors, tmux]
requires: ["09.1-03", "10-02"]
provides:
  - "AgentService: transport-agnostic agent operations returning ServiceResult"
  - "serviceResult.ts: ServiceError, ServiceResult, ok, fail, errorFrame"
  - "update, per-target broadcast results, MAX_AGENTS cap (not yet wired to a handler)"
affects: ["06-02", "06-04", "06-06", "06-07"]
tech-stack:
  added: []
  patterns: ["result-typed service behind thin transport handlers", "publish callback instead of event emitter"]
key-files:
  created:
    - server/src/services/serviceResult.ts
    - server/src/services/AgentService.ts
    - server/src/services/__tests__/serviceResult.test.ts
    - server/src/services/__tests__/AgentService.test.ts
    - server/src/services/__tests__/serviceLayerBoundary.test.ts
  modified:
    - server/src/services/SessionManager.ts
    - docs/ARCHITECTURE.md
    - docs/RATIONALE_AND_DESIGN_DECISIONS.md
key-decisions:
  - "ADR-010: transport-agnostic AgentService with typed results; confirm gate is the first statement of destroy"
  - "SessionManager keeps per-target sendInput for agent:broadcast because an existing test spies on it; results are ignored there"
status: complete
commits: 3
plan_head_before: d0564671ec3fe4888d405c40bc63aba9142043d4
plan_head_after: 962d2fe3a8dd2527915b1d528c7e5882575197d0
actuals:
  tokens: 28000
  tasks: 3
  commits: 3
metrics:
  duration: "~10 min"
  completed: 2026-11-08
---

# Phase 6 Plan 01: Gateway Agent Service Layer Summary

Registry, drivers and every agent operation moved from `SessionManager` into a transport-agnostic `AgentService` that returns typed `ServiceResult` values, with a failed spawn no longer leaving a ghost agent, plus `update`, per-target broadcast results and an agent cap.

## Commits

| Task | Commit | What |
| ---- | ------ | ---- |
| 1 (tracer) | 5aaa40a | `serviceResult.ts`, `AgentService.ts` (registry, drivers, destroy flow), thinned `SessionManager.ts`, tests |
| 2 | b84c252 | spawn failure as BACKEND_DOWN with no ghost agent, `update`, `BroadcastResult[]`, cap (CONFLICT), input/resize INTERNAL |
| 3 | 962d2fe | `serviceLayerBoundary.test.ts`, ARCHITECTURE section 4.1 and WS note, ADR-010 |

## Gate results

- Root `npm test`: 80 files / 1394 tests (baseline 77 / 1324; the root run includes the server tests).
- `npm --prefix server test`: 16 files / 278 tests (baseline 13 / 208). All 13 pre-existing server files pass unedited.
- `npx tsc --noEmit`, `npm run build`, `npm --prefix server run build`, `npm run contract:check`: exit 0.
- `grep -c 'new TmuxDriver\|new SshDriver'` and `grep -c tmuxKill` on `SessionManager.ts`: 0 and 0 (baseline 3 and 1).
- hardening.test.ts passed on first run (no flake re-run needed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree had no `server/node_modules`**
- **Found during:** Task 1 first test run (ws and express unresolved)
- **Fix:** symlinked `server/node_modules` to the main checkout's installed copy (gitignored, not committed). No package install.
- **Files modified:** none tracked

**2. [Rule 1 - Test constraint] agent:broadcast still routes through `SessionManager.sendInput`**
- **Found during:** Task 1 (SessionManager.test.ts spies on `sendInput` for broadcast)
- **Issue:** calling `service.broadcast` directly from the handler broke an existing, unedited test.
- **Fix:** the legacy mapping loops `sendInput` per target; `AgentService.broadcast` (with results) is ready for 06-02.

**3. TDD ordering (minor)**
- `serviceResult.test.ts` was written before its module (RED); for `AgentService` the implementation was written in the same pass as its test file, and the Task 2 cases were written alongside the code rather than observed failing first. All behaviors are covered by the tests; the pre-existing suite served as the RED/GREEN oracle for the move.

## Behavior notes

- Legacy shims in `SessionManager` (unknown id on a kill, close or destroy answers an unchanged `agent:init_list`) are marked in comments for removal by 06-02.
- `destroy` refusals/replies now arrive one microtask later than before (the service is async); existing tests were unaffected.
- Overlapping destroys now share one promise (and thus one result); a failed overlapping destroy yields a reply per requester instead of silence for the second.

## Known Stubs

None.

## Threat Flags

None (no new endpoints or trust boundaries; T-06-01 to T-06-04 mitigated: confirm-gate tests call the service directly, error messages are fixed strings, spawn failure/cap/broadcast isolation tested, session name derived only from the registry).

## Self-Check: PASSED

- Files exist: serviceResult.ts, AgentService.ts, three new test files, SessionManager.ts, both docs.
- Commits 5aaa40a, b84c252, 962d2fe are ancestors of HEAD.
