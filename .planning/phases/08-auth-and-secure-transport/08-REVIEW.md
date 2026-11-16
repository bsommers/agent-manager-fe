---
phase: 08-auth-and-secure-transport
reviewed: 2026-11-15T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - server/src/config.ts
  - server/src/index.ts
  - server/src/gateway/auth.ts
  - server/src/gateway/authThrottle.ts
  - server/src/gateway/handshake.ts
  - server/src/http/apiRouter.ts
  - server/scripts/smoke-auth.mjs
  - src/App.tsx
  - src/components/layout/CommandPalette.tsx
  - src/components/layout/ConnectionBanner.tsx
  - src/components/layout/Header.tsx
  - src/components/layout/TokenDialog.tsx
  - src/hooks/useAuthPrompt.ts
  - src/keyboard/commands.ts
  - src/services/adapters/WsAdapter.ts
  - src/services/adapters/types.ts
  - src/services/auth/tokenStore.ts
  - src/services/backend.ts
  - src/services/redact.ts
  - src/services/session/logout.ts
  - src/services/session/submitToken.ts
  - src/services/transport/Transport.ts
  - src/store/agentStore.ts
  - src/store/connectionStore.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-11-15
**Depth:** standard
**Files Reviewed:** 24 (tests excluded; src/store/uiStore.ts and adapters/types.ts are one-line changes)
**Status:** issues_found

## Summary

Traced: hello gate ordering (nothing but a valid hello is processed pre-auth, deadline and
throttle checked first, addClient only after ack), constant-time compare (both sides hashed to 32
bytes, timingSafeEqual), 4401/4429 handling (FE latches on 4401, honours a clamped retry floor on
4429), Bearer-only `/api` (auth middleware precedes body parsing, 401/404/UNSUPPORTED all behind it,
health minimal without a header), token in logs (frame errors reduced to fixed messages, ws errors
logged as a label), token in URLs/storage (never in URL; one sessionStorage key), bind policy
(D-10/D-12 correct, anchored loopback matchers on both sides, D-11 enforced in `resolveBackendConfig`).
No auth bypass, timing oracle or token leak found. Remaining findings are throttle robustness,
UX/state edge cases and quality.

## Warnings

### WR-01: Default-off TRUST_PROXY makes the documented deployment globally lockable

**File:** `server/src/gateway/handshake.ts:110-119`, `server/src/config.ts:118`
**Issue:** Behind the reverse proxy (the only supported remote mode, D-09) the socket peer is the
proxy. With `AGENT_MANAGER_TRUST_PROXY` unset (default) every client shares one throttle key, so
any anonymous caller can send 5 wrong tokens (WS hello or `Authorization: Bearer x` on `/api/*`) and lock all
users out, repeatedly, with the lock doubling to 15 min. With it on, `X-Forwarded-For` is honoured
only when the peer is loopback, so a proxy on another host (common) cannot be trusted and falls back
to the same shared key. The startup log warns, but a missed env var is a remote DoS rather than a
fail-safe.
**Fix:** Fail closed instead of sharing a key: when auth is on and the bind is non-loopback, either
require `AGENT_MANAGER_TRUST_PROXY` to be explicitly set (0 or 1) at start, or accept a trusted-proxy
CIDR list (`AGENT_MANAGER_TRUSTED_PROXIES`) instead of loopback-only. At minimum, key the throttle on
(ip, scope) and never let an unauthenticated count lock a source that has presented a valid token.

### WR-02: `recordSuccess` wipes failures and strikes, defeating the throttle on a shared key

**File:** `server/src/gateway/authThrottle.ts:142-144`, callers `server/src/index.ts:198`, `server/src/http/apiRouter.ts:164`
**Issue:** A successful hello or Bearer deletes the whole entry for the key, including `strikes`.
Under a shared key (WR-01) or NAT, an attacker interleaves guesses with a legitimate user's
successes (or a valid-token holder's polling) and never reaches the limit or the doubling lockout.
**Fix:** On success only clear `failures` and `windowStart`; keep `strikes` until the entry lapses.
Do not reset when the entry is currently locked.

### WR-03: Token is persisted before the gateway has accepted it

**File:** `src/services/session/submitToken.ts:11-13`, `src/services/auth/tokenStore.ts:54-61`
**Issue:** `submitToken` stores a typed token in memory and sessionStorage, shows "Log out", then
connects. A wrong token stays stored; every reload auto-connects with it and counts one more
throttle failure. A token entered while `configError` disables the adapter (`connect()` is a no-op)
is stored with no connection and no feedback.
**Fix:** Hold the candidate in memory only; call `setToken` (storage write) from the `hello_ack`
handler, and `clearToken()` the candidate on `auth_failed`. Surface `disabledReason` in the dialog.

### WR-04: Throttle eviction drops locked entries first

**File:** `server/src/gateway/authThrottle.ts:113-120`
**Issue:** At `maxKeys`, after the lapsed sweep the oldest-inserted entry is evicted regardless of
state. Locked entries inserted early are evicted by a flood of new keys (10 000 IPv4 or /64 prefixes,
cheap on IPv6), which clears a lock and its strikes.
**Fix:** Evict unlocked entries first (iterate for `lockedUntil <= now`); evict a locked entry only
if every entry is locked.

## Info

### IN-01: Connection reports `open` before authentication is confirmed

**File:** `src/services/transport/Transport.ts:156-162`
**Issue:** `state: 'open'`, `lastConnectedAt` and the `reopened` side effect (`requests.resendInFlight`,
agentSocket.ts) fire on the socket open, before `hello_ack`. A rejected token shows "Connected"
briefly, then `auth_failed`. Order on the wire is correct (hello is first), so no data is sent
unauthenticated.
**Fix:** With `expectAck()` true, report `open` from `acknowledge()` instead of `onopen`.

### IN-02: Contract mismatch / malformed hello surfaces as an authentication failure

**File:** `server/src/gateway/handshake.ts:58`, `src/services/transport/Transport.ts:180`
**Issue:** `invalid_hello` (for example a wrong `contract`) closes 4401 with the fixed reason, so the FE
shows "Authentication failed" and opens the token dialog for a version problem. Not throttled (correct).
**Fix:** Use a distinct close code or a non-secret reason (`bad-contract`) for `invalid_hello` only.

### IN-03: Pre-auth size cap is applied after the frame is fully buffered

**File:** `server/src/index.ts:69-72`, `server/src/gateway/handshake.ts:43`
**Issue:** `maxPayload` is 1 MiB for every socket; the 16 KiB pre-auth cap runs only after ws has
assembled the whole frame, and unauthenticated connection count is uncapped (5 s lifetime each).
**Fix:** Lower `maxPayload` for unauthenticated receivers (for example via the receiver's `_maxPayload` until authed) and/or cap concurrent
pre-auth sockets per key.

### IN-04: Non-Bearer `Authorization` header counts as a failed attempt

**File:** `server/src/http/apiRouter.ts:158-163`
**Issue:** A front proxy that forwards `Authorization: Basic ...` (nginx `auth_basic` forwards it by
default) is rejected and each request records a throttle failure. Not a bypass; interoperability and lockout risk.
**Fix:** Document `proxy_set_header Authorization ""` for the basic-auth case, or do not count a
non-Bearer scheme as a wrong token.

### IN-05: Host guard cannot be extended for a wildcard bind

**File:** `server/src/http/apiRouter.ts:168-172`
**Issue:** With `HOST=0.0.0.0`/`::` only loopback names and the literal bind name pass, so `/api` works
remotely only if the proxy rewrites `Host` (RUNNING.md does). No env to allow a public hostname.
**Fix:** Optional `AGENT_MANAGER_ALLOWED_HOSTS`, or keep the doc requirement explicit.

### IN-06: Quality nits

**File:** `server/scripts/smoke-auth.mjs:~197`, `src/services/redact.ts`, `src/services/session/logout.ts:41`
**Issue:** (a) `const main` inside `async function main()` shadows the function. (b) `redact.ts`
(`redactJson`, `knownSecrets`) has no production caller until Phase 21, so the roadmap criterion
"token never reaches the diagnostics export" is only unit-tested, not wired. (c) `requests.clear()`
leaves callers' promises forever pending after logout, so components awaiting a request keep a stale
busy state.
**Fix:** Rename the variable (`gw`); track (b) in Phase 21 verification; reject pending requests with a
dedicated `SESSION_ENDED` error that callers swallow, or clear the owning component state.

---

_Reviewed: 2026-11-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
