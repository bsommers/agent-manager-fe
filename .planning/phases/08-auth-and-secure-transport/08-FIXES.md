# Phase 8: Review Fixes

Source: 08-REVIEW.md (0 critical, 4 warning, 6 info). Fixed: WR-01..WR-04, IN-01, IN-06 (a, c).

| Finding | Fix | Commit | Tests |
|---------|-----|--------|-------|
| WR-01 shared throttle key behind the proxy | `AGENT_MANAGER_TRUST_PROXY` unset = auto: `X-Forwarded-For` (last entry) honoured only when the TCP peer is loopback; `0/false` and `1/true` still override; a header from a non-loopback peer is never honoured. Startup log line per mode; RUNNING.md, server README, ARCHITECTURE and ADR-013 updated. | 1d86cc8 | `handshake.test.ts` (auto loopback, auto non-loopback spoof ignored, explicit false wins), `authConfig.test.ts` (parse unset = undefined), `authWs.test.ts` / `authHttp.test.ts` (auto keys per forwarded client), startup-line test for the auto message |
| WR-02 `recordSuccess` wipes strikes | Success clears failures and window only, keeps strikes (entry without strikes is dropped), and never touches a locked entry. | b884c20 | `authThrottle.test.ts`: strike history kept across success (next lock doubles), failures cleared but lock untouched, strikes forgotten once lapsed, strike-less entry dropped |
| WR-04 eviction drops locked entries | At `maxKeys`: sweep lapsed, evict the oldest unlocked entry; if every entry is locked, new keys share one overflow entry outside the map (bound holds, locks and strikes survive a flood). | 802bc1e | `authThrottle.test.ts`: never evicts locked, strikes kept through a flood, overflow entry throttles untracked keys while size stays bounded |
| WR-03 token persisted before acceptance | Typed token is an in-memory candidate (`setCandidate`); `commitCandidate` writes sessionStorage only from the adapter's `hello_ack` (auth required) hook; `auth_failed` (4401 / no ack) clears candidate and stored token. `submitToken` returns the adapter's `disabledReason` and stores nothing when the adapter is disabled; the dialog shows it inline. | 6bf422d | `tokenStore.test.ts` (candidate), `submitToken.test.ts` (memory only, commit, disabled), `backend.test.ts` (persist after ack, clear on 4401 for stored and candidate), `TokenDialog.test.tsx` (disabled feedback), `authScrubUi.test.tsx` updated |
| IN-01 "Connected" before `hello_ack` | With a token configured the Transport reports `open` (and `lastConnectedAt`, so `resendInFlight`) from `acknowledge()`, and refuses `send()` until then; the heartbeat ping writes directly. | 496c973 | `Transport.test.ts`: no open before ack, open on ack, send refused pre-ack, 4401 never shows open, no-token path unchanged; watchdog tests updated to `connecting` |
| IN-06a shadowed `main` in smoke-auth.mjs | Variable renamed `gw`. | 5f08c8a | `node server/scripts/smoke-auth.mjs`: 9 passed |
| IN-06c logout leaves request promises pending | `requests.clear()` rejects in-flight requests with `SESSION_ENDED`; `isSessionEnded` is swallowed in create rollback, kill and update handlers (no notice, `updateAgent` resolves false). | eed7aec | `agentRequests.test.ts` (clear rejects SESSION_ENDED, timers cleared), `logout.test.ts` (no notice, update settles) |

Not fixed (out of the requested scope): IN-02, IN-03, IN-04, IN-05, IN-06b (redact wiring, tracked for Phase 21).

## Gate

Root vitest 2307 passed; server vitest 858 passed; tsc root and server clean; `npm run build` root and server OK;
`build:protocol` OK; `contract:check` OK; tmuxKill count in `server/src/services/SessionManager.ts` is 0;
`node server/scripts/smoke-auth.mjs` 9 passed, 0 failed. `server/__tests__/hardening.test.ts` untouched.
