---
phase: 06-agent-lifecycle-api
plan: FIX-http
status: complete
commits: 2
---

# Phase 6 Fix: HTTP layer review findings

Both findings were real; a failing test was written first for each (19 failures before the fixes).

## Finding 2: DELETE /api/agents/:id ignored Idempotency-Key (377a030)
The handler now builds the `agent:kill` candidate, runs `readReqId` (same helper as POST) and sets `reqId`. An invalid key
is `400 USAGE` ("invalid header: Idempotency-Key") and the agent is left alone; a repeated valid key replays the original
ack and closes once; a different key does not replay.

## Finding 1: no Host-header check on /api (d8242b4)
Router-level middleware (after Cache-Control, before the CSRF guard) in `server/src/http/apiRouter.ts`. `hostnameOf` accepts
only a plain `host` or `host:port` (DNS name, IPv4 or bracketed IPv6), lower-cased; the name must be 127.0.0.1, localhost,
[::1] or the bound HOST (new required `host` dep, passed from `bootstrap` in `server/src/index.ts`). Otherwise 403 FORBIDDEN,
fixed message `host not allowed`, standard envelope. Applies to every method and path under /api, including health and
unknown routes. The non-/api `/health` route is untouched. Documented in `server/README.md` (also removed the "Host-header
checks: Phase 8" not-yet note and noted Idempotency-Key now covers DELETE).

Tests: `server/__tests__/httpApi.test.ts` (Host and DELETE-key blocks) and `server/src/http/__tests__/hostname.test.ts`.

## Deviations
- `ApiRouterDeps` gained a required `host` field (only `bootstrap` constructs the router).
- An empty `Host:` value is rejected by Node itself (400, no envelope) before reaching the router, so it is covered by the
  `hostnameOf` unit test only.

## Gate
tsc (root and server) clean; server tests 632/632; root tests 1877/1877; server build and root build OK; contract:check OK.
