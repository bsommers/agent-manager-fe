---
phase: 08-auth-and-secure-transport
plan: 03
subsystem: auth
tags: [websocket, hello, hello_ack, sessionStorage, redaction, transport]
status: complete

requires:
  - phase: 06-07
    provides: Transport, WsAdapter, resolveBackendConfig baseline
provides:
  - Token store (memory plus one sessionStorage key, hasToken-only zustand)
  - hello as first frame with token; hello_ack handling (epoch, auth.required, contract mismatch)
  - 3 s ack watchdog, 4401 latch, 4429 delay floor
  - Loopback-only ws:// rule and URL hygiene in resolveBackendConfig
  - redactSecrets / redactJson / knownSecrets for Phase 21 diagnostics
affects: [08-04 token dialog and logout, 08-05 docs and QA, Phase 21 diagnostics export]

actuals:
  tokens: 14200
  tasks: 3
  commits: 3
plan_head_before: 154d7c8a50c8eb02224b13e72bc43fb8d85d2bb6
plan_head_after: 5f9e626d4e6feca17c36022bdccdb8a5952141fa
commits: 3

tech-stack:
  added: []
  patterns:
    - Handshake hook on Transport (frame builder read at each open, expectAck predicate)
    - Latch (authLatched) instead of a new reconnect state for auth failures
    - ConfigError class so only vetted messages reach configError (no URL echo)

key-files:
  created:
    - src/services/auth/tokenStore.ts
    - src/services/redact.ts
    - src/services/auth/__tests__/tokenStore.test.ts
    - src/services/__tests__/redact.test.ts
    - src/services/__tests__/authScrubTransport.test.ts
    - src/services/transport/__tests__/authConstants.test.ts
  modified:
    - src/services/transport/Transport.ts
    - src/services/adapters/WsAdapter.ts
    - src/services/adapters/types.ts
    - src/store/connectionStore.ts
    - src/services/backend.ts
    - src/services/transport/__tests__/Transport.test.ts
    - src/services/adapters/__tests__/WsAdapter.test.ts
    - src/services/__tests__/backend.test.ts
    - src/store/__tests__/connectionStore.test.ts

key-decisions:
  - "Keep immediate open state; add only a 3 s ack watchdog when a token is set (PLANS-NOTES decision 1)"
  - "4429 is a normal reconnect with a delay floor parsed from retry-after-ms=N (strict anchored, max 9 digits, capped 15 min)"
  - "clearing the 4401 latch happens on connect() and close(); reconnectNow is inert while latched"
  - "Close-code constants live in Transport.ts, pinned to spec 2.5/2.6 by a drift test"

duration: 25min
completed: 2026-11-12
---

# Phase 8 Plan 03: FE transport auth Summary

The FE now sends a validated `hello` carrying the token as the first frame of every connection, consumes `hello_ack`, stops cleanly on `auth_failed`, refuses plaintext `ws://` to non-loopback hosts, and holds the token in memory plus one `sessionStorage` key with a canary test proving it reaches nothing else.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 Tracer: token store, hello hook, 4401 latch | 8535e56 | hello is written from onopen before the open state; 4401 leaves 0 timers and 1 socket after 10 min |
| 2 hello_ack, ack watchdog, 4429 floor, epoch/authRequired | c54b697 | ack consumed by adapter; 3 s watchdog only with a token; snapshot and store gain epoch/authRequired |
| 3 ws:// loopback rule, URL hygiene, redactor, canary, drift | 5f9e626 | lookalike hosts refused; credentials/query/fragment refused without echo; createBackend passes getToken |

## Verification

- Root `vitest run`: 100 files, 2017 passed, 1 todo (the Phase 21 hand-off test); baseline was 1905 tests.
- Root `tsc --noEmit`, `npm run build`, `npm run build:protocol`, `npm run contract:check`: all clean.
- New cases: tokenStore 21, Transport +18, WsAdapter +10 hello/ack (+5 hello), connectionStore +1, backend +30, redact 10, authScrubTransport 5 + 1 todo, authConstants 4.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Environment: Node 26 exposes an experimental global `localStorage` that is undefined in the vitest jsdom environment**
- **Found during:** Task 1
- **Issue:** `localStorage.clear()` threw in tests; the plan's "persistent storage stays empty" assertion could not use the real object.
- **Fix:** the test installs a spy object with `vi.stubGlobal('localStorage', ...)` and asserts none of its methods are called. Production code is unaffected.
- **Files modified:** src/services/auth/__tests__/tokenStore.test.ts

**2. [Minor - test edits outside the stated region]** `backend.test.ts` gained extra import lines (added as separate lines, existing import lines untouched); the existing-case edits are confined to the two fixtures the plan listed (the line numbers in the plan are stale). `Transport.test.ts` and `WsAdapter.test.ts` changes are additions only (imports added as new lines); `connectionStore.test.ts` literals gained the two fields.

**3. [Environment] worktree setup:** `node_modules` and `server/node_modules` were symlinked from the main checkout (gitignored) so the suites could run; no package installed, no package.json or lockfile change.

No architectural changes. 08-04 should know: `WsAdapter.disconnect()` clears `epoch`/`authRequired`; `Transport.close()` clears the auth latch; `connect()` is the only way out of `auth_failed`.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-08-13 to T-08-17 mitigated; T-08-18 accepted).

## Self-Check: PASSED

- Files exist: tokenStore.ts, redact.ts, all four new test files (verified by the passing suite).
- Commits 8535e56, c54b697, 5f9e626 are ancestors of HEAD.
