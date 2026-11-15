---
phase: 08-auth-and-secure-transport
plan: 02
subsystem: gateway
tags: [auth, websocket, hello, bearer, throttle, health, scrub]
requires: ["08-01"]
provides: ["WebSocket auth gate (registration after hello)", "hello_ack with contract/auth/epoch", "4401 deadline and pre-auth rules", "shared WS+HTTP failure throttle (4429/429)", "Bearer check on /api", "auth-aware health", "bind policy at startup", "canary scrub tests"]
affects: [server/src/index.ts, server/src/http/apiRouter.ts, server/vitest.config.ts]
key-files:
  created:
    - server/__tests__/helpers/authHarness.ts
    - server/__tests__/authWs.test.ts
    - server/__tests__/authHttp.test.ts
    - server/__tests__/authScrub.test.ts
  modified:
    - server/src/index.ts
    - server/src/http/apiRouter.ts
    - server/vitest.config.ts
    - server/__tests__/lifecycle.test.ts
key-decisions:
  - "Confidentiality is registration order: sessionManager.addClient runs only after a valid hello (SessionManager untouched); hello_ack precedes agent:init_list"
  - "The throttle is checked at connection AND again before each pre-auth frame, so many sockets opened before a lock cannot each get a guess"
  - "Only bad_token verdicts and wrong/malformed Bearers count; missing token, malformed/oversize frames and the deadline close 4401 uncounted"
  - "Startup auth and proxy-hint lines are logged only outside NODE_ENV=test, so the pre-auth silence assertions hold"
requirements: [INT-02]
status: complete
commits: 3
plan_head_before: 76c724248756ab8897e6ab9b81742659920674f0
plan_head_after: 9664eb446e8dcbe79383401e81b1cf92e856d693
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
---

# Phase 8 Plan 2: Gateway auth wiring Summary

The 08-01 primitives are live: with a token the gateway sends nothing to a WebSocket until a valid hello, answers hello_ack (contract, auth, shared epoch) before the roster, closes wrong tokens 4401 and throttled sources 4429, and requires a Bearer on every `/api` route except the minimal health, with one bounded throttle shared by both surfaces and the token absent from every log, frame, close reason, body and header. With no token the gateway behaves as before.

## Commits
- 757af0c feat(08-02): tracer - hello with token yields hello_ack then roster; bind policy and shared epoch
- 5d6f310 feat(08-02): WebSocket gate hardening - hello deadline, shared throttle, silent pre-auth path
- 9664eb4 feat(08-02): Bearer check on /api, auth-aware health, shared throttle and HTTP scrub tests

## Results
- Server suite 33 files / 845 tests (baseline 30 / 749 after 08-01); passes twice and also with `AGENT_MANAGER_TOKEN` exported (test.env override). Root `npm test` 107 files / 2219 passed, 1 todo.
- New tests: authWs 47, authHttp 36, authScrub 13 (7 WS, 6 HTTP).
- server `tsc --noEmit`, root `tsc --noEmit`, server build, root build, `build:protocol` green. `contract:check` OK relative to HEAD (zero surface diff). `check-wave-collisions.mjs --pending` exits 0.
- `hardening.test.ts`, `index.test.ts`, `httpApi.test.ts` byte-identical to the plan base. `lifecycle.test.ts` diff is the hello case only (now `hello_ack` then `pong`).
- Known hardening liveness flake did not occur.
- Nothing changed under `src/`, `packages/protocol`, `docs/`, `server/src/services`, `server/src/gateway`, `server/src/config.ts`.
- `grep -c 'req\.query\|req\.cookies\|req\.body' server/src/http/apiRouter.ts`: 4 at START and 4 now (pre-existing reads in the POST handlers); the auth middleware reads none, proved by the query/cookie/body token tests.

## Deviations from Plan

**1. [Rule 2 - Hardening] Throttle re-checked before each pre-auth frame.** The plan checks at connection time only; many sockets opened before a lock could each take a guess. The same check now also runs before `checkHello`, using the same 4429 path.

**2. [Rule 3 - Blocking] Worktree dependencies.** `node_modules` and `server/node_modules` are git-ignored symlinks to the main checkout (same as 08-01).

**3. [Test shape] `vi.restoreAllMocks` avoided.** It resets the file-level tmux mocks (`mockResolvedValue`), so the harness tracks and restores only its own console spies (`restoreConsole`).

**4. [Placement] Scrub canary is the configured token.** The gateway runs with the canary as its token and the hostile frames embed the canary and a near miss (`CANARY` + `x`) so echo paths are exercised; the plan's "wrong token" case is the near miss.

## Known Stubs
None.

## Threat Flags
None beyond the plan's register. T-08-06 to T-08-10 are mitigated and test-covered; T-08-11 residual (shared key behind a proxy with trust off) is signalled by the startup hint line.

## Self-Check: PASSED
All 8 plan files exist; commits 757af0c, 5d6f310, 9664eb4 are ancestors of HEAD.
