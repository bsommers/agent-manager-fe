---
phase: 08-auth-and-secure-transport
verified: 2026-11-15T20:10:00Z
status: human_needed
score: 4/4 must-haves verified
covered_files:
  - server/scripts/smoke-auth.mjs
  - server/src/config.ts
  - server/src/gateway/auth.ts
  - server/src/gateway/authThrottle.ts
  - server/src/gateway/handshake.ts
  - server/src/http/apiRouter.ts
  - server/src/index.ts
  - src/services/auth/tokenStore.ts
  - src/services/backend.ts
  - src/services/redact.ts
  - src/services/session/logout.ts
  - src/services/transport/Transport.ts
covered_digest: "v3:sha256:68f7a99b08271333c9b405ba4a3432323d09b6fde168aa1e9e689928329e4bd3"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run docs/qa-test-plan.md 'Manual QA: Auth and secure transport (Phase 8)' steps 1-6, 8-10 in a real browser (step 12 optional, needs TLS proxy)"
    expected: "Dialog on auth_failed, exactly one WebSocket per wrong token, no token in any URL, only agent-manager.token in sessionStorage, reload keeps session, logout empties everything, palette Log out only when signed in, http:// non-loopback shows banner and opens no socket"
    why_human: "Needs a real browser, Network tab and session storage. 08-EVIDENCE.md records these PENDING-HUMAN. Server side of steps 2, 5, 7, 11 already passes in the smoke."
---

# Phase 8: Auth and Secure Transport Verification Report

**Phase Goal:** Remote access is possible only with a token over TLS; local use stays zero-config.
**Verified:** 2026-11-15
**Status:** human_needed (no code gaps; only the expected PENDING-HUMAN browser steps remain)
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | Wrong token yields `auth_failed`, no reconnect storm | VERIFIED | Server: `index.ts` closes 4401 (`UNAUTHENTICATED_REASON`) on `bad_token`, counted by the throttle, 4429 after repeated failures. FE: `Transport.ts` onclose 4401 sets `authLatched`, state `auth_failed`, schedules no retry; `reconnectNow()` is inert while latched; only `connect()` (via `submitToken`, one attempt) clears it. 3 s ack watchdog also latches. Smoke checks 4 and 8 pass in a real process (re-run by me, 9/9). FE transport/useAuthPrompt/submitToken tests pass. |
| 2 | FE refuses non-loopback `ws://`; gateway refuses non-loopback bind without token | VERIFIED | `backend.ts` `assertSecureOrLoopback` + `isLoopbackHostname` (anchored localhost/::1/127.0.0.0/8), ConfigError makes `WsAdapter` disabled (state closed, no socket), URL with credentials/query/hash refused. `config.ts` `assertBindPolicy` + `validateAuthToken` (24..512 printable ASCII); `bootstrap()` calls it before listen. Smoke 1 and 2 pass (exit non-zero, names HOST and AGENT_MANAGER_TOKEN, never echoes token). |
| 3 | Token never in URL, log line or diagnostics export (test-asserted); logout empties stores | VERIFIED (with note) | Token only in `hello` body and `Authorization: Bearer`; WS upgrade query never read; `safeLogError` redacts; `ws.on('error')` logs a label only; pre-auth path logs nothing; 401/429 bodies fixed text. Canary tests pass: server `authScrub` (13), `authWs`, `authHttp`; FE `authScrubTransport`, `authScrubUi`. Smoke 9: token and its prefix absent from child stdout/stderr. `logout()` clears requests, disconnects, clears token, resets agent/log/ui stores, sweeps `agent-manager.*` from session and local storage; 14 logout tests pass. Note: no diagnostics export exists yet (Phase 21, INT-10); only the redactor (`src/services/redact.ts`) is delivered and tested, and the diagnostics assertion is an explicit `it.todo` handed off to Phase 21. Not a Phase 8 gap. |
| 4 | `hello`/`hello_ack` carries contract version, auth and `epoch` | VERIFIED | `handshake.ts` `buildHelloAck` emits `contract`, `epoch`, `auth.required`, limits, backends; `index.ts` sends it after a valid hello, before `addClient`/`agent:init_list`. FE `WsAdapter` sends `hello{contract, token, epoch}` as first frame, validates `hello_ack`, stores `epoch`/`authRequired`, flags contract mismatch. `contract:check` OK, zero surface diff. Smoke 5 pass. |

**Score:** 4/4 truths verified (0 behavior-unverified)

## Locked decisions D-01..D-13

| D | Status | Evidence |
|---|---|---|
| D-01 memory + sessionStorage only | OK | `tokenStore.ts`: one `agent-manager.token` sessionStorage key; hasToken-only zustand state; no localStorage |
| D-02 masked dialog on auth_failed | OK | `TokenDialog.tsx`, `useAuthPrompt.ts`; tests pass (browser check pending) |
| D-03 logout clears all | OK | `logout.ts`, 14 tests |
| D-04 header + palette, only with token | OK (code/tests) | `Header.tsx`, `commands.ts` `auth.logout`; browser steps 8-9 pending |
| D-05 4401 stops, no retries | OK | `Transport.ts` latch |
| D-06 constant-time + per-IP backoff | OK | `auth.ts` sha256 + `timingSafeEqual`; `authThrottle.ts` bounded map, no timers; smoke 8 |
| D-07 5 s hello deadline, nothing before auth | OK | `index.ts` deadline (unref'd), 16 KiB pre-auth cap, `addClient` after hello; smoke 6 (4.5-7 s) |
| D-08 Bearer only | OK | `apiRouter.ts` `checkBearer`/`bearerOf`, header only, after Host/Origin guards; smoke 7 |
| D-09 TLS at proxy, nginx example | OK | `docs/RUNNING.md` nginx block (Host pinned to loopback, XFF overwritten) |
| D-10 non-loopback needs 24+ char token | OK | `config.ts`; smoke 1, 2 |
| D-11 ws:// loopback only | OK | `backend.ts` |
| D-12 auth enforced whenever token set; unset = zero-config | OK | `bootstrap()` token resolution; `/health` drops `agents` under auth; explicit `token: undefined` option wins |
| D-13 token in hello body | OK | `checkHello`, `WsAdapter.helloOption`; protocol package untouched |

## Verification run by me

| Check | Result |
|---|---|
| `npm --prefix server run build` then `node server/scripts/smoke-auth.mjs` | 9 passed, 0 failed; no leftover gateway process |
| root vitest `src/services src/hooks` + `authScrubUi` | 27 files, 476 passed, 2 todo (Phase 21 hand-offs) |
| server vitest `authWs authHttp authScrub authConfig` | 4 files, 141 passed |
| `npm run contract:check` | OK relative to HEAD |
| `git status` | clean |
| Full-suite gate | not re-run; relied on 08-EVIDENCE.md section C (2281 root, 845 server) plus the subsets above |

## Anti-patterns

None found in the phase files (no TBD/FIXME/XXX; no stubs; no hardcoded-empty data on the auth paths). The two `it.todo` entries are explicit Phase 21 hand-offs recorded in ROADMAP.

## Deferred

| Item | Addressed in | Evidence |
|---|---|---|
| Diagnostics-export token-redaction test | Phase 21 (INT-10) | ROADMAP Phase 8 hand-offs; `it.todo` in two canary tests |

## Human verification required (expected PENDING-HUMAN, not gaps)

Browser steps from 08-EVIDENCE.md section B, all unrecorded:
1. Steps 1, 3, 4, 6, 8, 9, 10: dialog appears without roster; right token connects; no token in any URL and only `agent-manager.token` in session storage; reload keeps session, new tab shows dialog; header Log out empties roster/panes/storage; palette Log out only when signed in; `http://` non-loopback shows banner and opens no socket.
2. Steps 2, 5 (browser half): exactly one WebSocket after a wrong token; sixth wrong token shows a connection problem and a correct token works after the lock.
3. Step 12 (optional): wss through a real TLS proxy, and a client-supplied `X-Forwarded-For` cannot influence the throttle.

Already covered by the smoke: steps 7 and 11, and server halves of 2 and 5.

## Gaps Summary

No code gaps. All four roadmap criteria and D-01..D-13 are implemented, wired and exercised by tests and a real-process smoke. Remaining work is the human browser QA run.

Minor observations (not blocking): the Host-header guard means a TLS proxy must pin `Host` to a loopback name (documented in the nginx example); the 16 KiB pre-auth cap is flagged in ROADMAP for revisit in Phase 11.

---

_Verified: 2026-11-15_
_Verifier: Claude (gsd-verifier)_
