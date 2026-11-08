---
phase: 06-agent-lifecycle-api
plan: 06
subsystem: gateway-http
tags: [http, express, idempotency, csrf, envelope]
requires: [06-01, 06-02]
provides: [http-api-agents, http-api-health, error-envelope]
affects: [server/src/index.ts]
tech-stack:
  added: []
  patterns: [thin transport wrapper over AgentApi.execute, catalog-tied route coverage]
key-files:
  created:
    - server/src/http/apiRouter.ts
    - server/src/http/envelope.ts
    - server/src/http/__tests__/envelope.test.ts
    - server/__tests__/httpApi.test.ts
  modified:
    - server/src/index.ts
    - server/README.md
decisions:
  - "Idempotency-Key header is the reqId; a body reqId is dropped before validation"
  - "No CORS headers ever; Origin allowlist on POST/DELETE; FE uses WebSocket"
  - "Catalog routes not implemented (logs, search) answer 422 UNSUPPORTED; unknown paths 404 'no such route'"
status: complete
commits: 3
plan_head_before: c2956fc71ceca1dc440fd027d836f77e003c7828
plan_head_after: ef66da49e753d1b494b7453b6364ac2a612497ab
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
requirements: [INT-03, GW-04]
---

# Phase 6 Plan 6: HTTP API Summary

`/api/health` and `/api/agents` (GET, POST, DELETE) as a thin wrapper over `AgentApi.execute`, with a shared
Idempotency-Key cache, Origin/content-type/size guards, no CORS, fixed error envelopes and a catalog coverage test.

## Commits

- 791214a feat(06-06): tracer, POST and GET /api/agents and /api/health
- 8086f1d feat(06-06): DELETE, Idempotency-Key, guards, limits, unsupported routes, catalog coverage
- ef66da4 docs(06-06): HTTP API section in the server README

## Results

- Server suite: 22 files / 499 tests (baseline 20 / 400; httpApi 64 cases, envelope 35).
- Root suite: 88 files / 1698 tests (it also collects the two new server test files).
- tsc, both builds, contract:check: green. index.ts diff: 15 lines.
- Tracer gate (auto mode): verified end to end before expanding.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree had no node_modules**
- Symlinked root `node_modules` and per-entry `server/node_modules` (with `@agent-manager/protocol` pointing at the worktree's own package) from the main checkout. Untracked and gitignored.

**2. [Rule 1 - Bug] Undecodable path (`/api/agents/%E0%A4%A`) would have been 500**
- Express reports it as a 4xx error without a body-parser `type`. The error handler therefore maps any 4xx `status` to USAGE (413 to PAYLOAD_TOO_LARGE) rather than keying on `err.type`. Covered by a test.

### Notes (not deviations)

- RED-first was not run as a separate failing step for the tracer; tests and implementation were written together and verified green.
- `vi.restoreAllMocks()` is not used in the HTTP test teardown (it resets the hoisted `discoverTmuxSessions` mock); spies are restored individually.
- First root `npm test` run at baseline showed one transient failure (1 of 1599); not reproducible on re-run and unrelated (hardening.test.ts untouched).
- `GET /api/health` is included in `registeredRouteIds()`; the coverage test exempts it via `UNCATALOGUED_HTTP_ROUTES`.

## Known Stubs

None. The two UNSUPPORTED routes (logs, search) are intentional and owned by Phases 11 and 16.

## Threat Flags

None beyond the plan's threat model (T-06-21 to T-06-27 mitigated or accepted as planned).

## Self-Check: PASSED

Files and commits verified present: apiRouter.ts, envelope.ts, both test files, README section; 791214a, 8086f1d, ef66da4.
