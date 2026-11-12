# Phase 8: Auth and Secure Transport - Research

**Researched:** 2026-11-12
**Domain:** WebSocket/HTTP token auth for an Express + `ws` gateway and a React/zustand FE; bind policy; secret hygiene
**Confidence:** HIGH (everything below was read from the repo this session; no web research was needed or done)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Token lives in memory plus `sessionStorage` (survives reload in the tab, gone when the tab closes). Never localStorage, never a URL.
- **D-02:** Entry is a password-masked dialog opened on `auth_failed` / auth required. No always-on settings field, no build-time `VITE_` token.
- **D-03:** Logout clears everything: close sockets, empty agent/roster/log stores, remove token and workspace data from storage, return to the token dialog.
- **D-04:** Logout is reachable from a header menu item and a command-palette command (keyboard-first, Phase 5); shown only when a token is set.
- **D-05:** On close 4401 the transport goes to `auth_failed` and stops; no retries until the user submits a new token (no reconnect storm).
- **D-06:** Gateway compares tokens in constant time and applies per-IP backoff/rejection after N failures in a window (in-memory, bounded map).
- **D-07:** A socket that sends no valid `hello` within ~5 s is closed 4401; no message other than `hello` is processed before auth.
- **D-08:** `/api` auth is `Authorization: Bearer <token>` only, never in the URL.
- **D-09:** TLS is terminated by a reverse proxy (user's nginx); the gateway stays plain HTTP/WS. Docs include an nginx example. In-gateway TLS is not built.
- **D-10:** Gateway may bind a non-loopback `HOST` only when `AGENT_MANAGER_TOKEN` is set (with a minimum length, e.g. 24+ chars); otherwise refuse to start with a clear message (extends the existing refusal in `server/src/config.ts`).
- **D-11:** FE allows `ws://` only for loopback (localhost, 127.0.0.0/8, ::1); any other host must be `wss://`, otherwise a visible error and no fallback.
- **D-12:** Auth is enforced whenever `AGENT_MANAGER_TOKEN` is set, including on loopback. Unset means zero-config local with no auth.
- **D-13:** Token is sent in the `hello` message body (user confirmed 2026-11-12). Not in the URL, not a subprotocol, no one-time ticket. `hello_ack` returns contract version, auth result and `epoch`. Server must scrub the token from any logged frame. Reversibility: one-way - changes the `hello` shape in the protocol surface snapshot and fixtures.

### Claude's Discretion
- Exact failure threshold, backoff window, minimum token length and dialog wording.
- Token and its hash must never reach logs or the diagnostics export (test-asserted per roadmap criterion 3).

### Deferred Ideas (OUT OF SCOPE)
- In-gateway TLS termination (cert/key paths): revisit if a reverse proxy is ever not available.
- Origin check on `/api` and an explicit `ALLOW_REMOTE` opt-in flag were offered and not chosen.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INT-02 | Token auth and secure transport (`hello` handshake, `auth_failed`, wss for non-local, logout clears state) | Sections: Contract status, WS gate, HTTP Bearer, Throttle, FE token/Transport, Logout list, ws/wss rule, Scrubbing |
</phase_requirements>

## Summary

**The wire contract already contains everything D-13 needs; Phase 8 is a behavior change, not a schema change.** `hello` already has an optional `token` (string, 0..512, `noControl`) and optional `epoch`; `hello_ack` already has required `epoch` and `auth: { required: boolean }`. The surface snapshot, fixtures (`hello-full` carries a token; `hello-ack-full` has `auth.required: true`) and `CONTRACT_VERSION = 1` need **no change**. The "one-way / changes the hello shape" note in D-13 is therefore already satisfied by Phase 2 (02-02). Plan on `npm run contract:check` reporting zero diff. What is missing is behavior on both sides: the gateway never sends `hello_ack` and ignores `hello` (dispatch treats it as a no-op), and the FE never sends `hello` at all.

The gateway change is one gate in `server/src/index.ts`: when a token is configured, a new socket is **not** registered with `SessionManager` (which is what sends `agent:init_list` and what receives broadcasts) until a valid `hello` arrives; a 5 s timer closes 4401 otherwise. Registering the client only after auth is the whole confidentiality mechanism: `SessionManager.addClient` both adds to the broadcast set and sends the roster snapshot. `/api` gets a Bearer middleware in `apiRouter.ts` after the Host and Origin guards, with `GET /health` and the minimal `GET /api/health` exempt (contract spec section 7). A shared bounded per-IP failure throttle serves both surfaces. Token is held server-side as a SHA-256 digest and compared with `crypto.timingSafeEqual`.

The FE needs: a token module (memory + `sessionStorage`, with only a boolean in zustand), `hello` sent synchronously in `socket.onopen` through a Transport hook (the token never goes through `agentSocket.send`), `hello_ack` handling, a password dialog driven by `auth_failed`, logout orchestration that resets every store plus module-level tracking maps in `agentStore.ts`, and the loopback-only `ws://` rule in `resolveBackendConfig`. Phase 21 owns the "Copy diagnostics" export (INT-10), which does not exist yet; Phase 8 satisfies criterion 3 by asserting a canary token never appears in any log call, store state, URL or `ConnSnapshot` field, and by shipping the redaction primitive Phase 21 must use.

**Primary recommendation:** No contract change; add `server/src/gateway/{auth,authThrottle,handshake}.ts` as pure modules first, then wire them in one plan that owns both `index.ts` and `apiRouter.ts`; build the FE token/Transport layer in parallel (disjoint files), then the dialog/logout UI on top.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token verification, constant-time compare | API / Backend (gateway) | - | Only the gateway holds the secret; FE never validates |
| WS auth gate (hello, 5 s timeout, defer roster) | API / Backend | - | Must precede `SessionManager.addClient` |
| `/api` Bearer check | API / Backend | - | Express middleware beside the Host guard |
| Per-IP failure throttle | API / Backend | Reverse proxy (client IP source) | Needs real client IP; behind nginx `remoteAddress` is the proxy |
| Bind policy (token required for non-loopback) | API / Backend (startup) | - | `config.ts`/`bootstrap` refusal |
| TLS termination | Reverse proxy (nginx) | - | D-09; documentation only |
| `ws://` loopback rule | Browser / Client | - | `resolveBackendConfig` before any socket exists |
| Token store, dialog, logout | Browser / Client | - | sessionStorage + zustand + overlay |
| `hello` send / `hello_ack` handle / no-retry on 4401 | Browser / Client (Transport) | - | Transport owns socket lifecycle |
| Token scrubbing in logs/diagnostics | Both | - | Server log sites; FE stores/console; Phase 21 export consumes the redactor |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` (built-in) | Node v26.8.1 here; `@types/node ^20.11.0` | `createHash('sha256')`, `timingSafeEqual`, `randomUUID` | No dependency; `timingSafeEqual` is the standard constant-time compare. Hash both sides first so the buffers are equal length and the token length does not leak. |
| `ws` | `^8.17.1` (server/package.json) | WebSocket server; `ws.close(code, reason)` | Already used |
| `express` | `^4.19.2` | Router middleware | Already used |
| `zustand` | `^5.0.15` | `hasToken` boolean store, overlay flag | Already used |

### Supporting
None. **No new packages are recommended.** Every item (constant-time compare, token bucket/throttle map, redaction) is a few dozen lines of in-repo code; a rate-limit package would add a dependency for a bounded-map the decisions already describe (D-06).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-repo throttle | `express-rate-limit` etc. | Does not cover the WS path; D-06 wants one in-memory bounded map shared by both surfaces |
| Token in subprotocol/URL | - | Rejected by D-13 and contract spec section 14 row 2 |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase, so the `package-legitimacy` gate was not run (nothing to check).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | - | - | - | - | - | - |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Contract Status (additive vs breaking, epoch)

All values quoted verbatim from files read this session.

| Item | Current definition | Phase 8 change |
|------|--------------------|----------------|
| `hello` (TS) | `type: 'hello'; contract: number; token?: string; epoch?: string; resumeFrom?: Record<string, number>; client?: { name: string; version: string };` [VERIFIED: packages/protocol/src/messages.ts:67-74] | none |
| `hello` (validator) | `token: { kind: 'string', min: 0, max: 512, noControl: true, optional: true },` and `epoch: { kind: 'string', min: 1, max: 128, optional: true },` [VERIFIED: packages/protocol/src/validate.ts:81-82] | none |
| `hello_ack` (validator) | `epoch: { kind: 'string', min: 1, max: 128 },` `auth: { kind: 'object', fields: { required: { kind: 'boolean' } } },` and a required `backends` objectArray (`maxItems: 16`) [VERIFIED: packages/protocol/src/validate.ts:167-182] | none |
| `CONTRACT_VERSION` | `export const CONTRACT_VERSION = 1;` [VERIFIED: packages/protocol/src/limits.ts:2] | none |
| Error codes | `UNAUTHENTICATED: 401,` `RATE_LIMITED: 429,` [VERIFIED: packages/protocol/src/errors.ts:23,28] | none (use for `/api` 401 and 429) |
| Snapshot | `hello.fields.token` = `{"kind":"string","max":512,"min":0,"noControl":true,"required":false}`; `hello_ack.fields.auth` = `{"required": boolean}` [VERIFIED: contract.snapshot.json via python read] | none |
| Fixtures | `hello-minimal`, `hello-full` (token `"test-token-not-a-secret"`) [VERIFIED: fixtures/client.json:82-103]; `hello-ack-full` with `"auth": { "required": true }` [VERIFIED: fixtures/server.json:47-58]; invalid `hello-missing-contract`, `hello-negative-resume-seq`, `hello-ack-auth-required-string` [VERIFIED: fixtures/invalid.json] | optional additive: a `hello-token-max-length` fixture (512 chars) and an invalid `hello-token-too-long` / `hello-token-control-char`. Fixtures are conformance inputs, not snapshot input, so adding them does not touch `contract.snapshot.json`. |

**Epoch status:** already in the contract on both frames. The gateway already generates one per process (`epoch: options.epoch ?? randomUUID()` [VERIFIED: server/src/index.ts:67]) but only hands it to the API router. Hoist it to a single `const epoch` in `bootstrap` so `hello_ack.epoch` and `/api/health.epoch` are the same value. The FE only needs to parse and keep `epoch` (connection store); acting on an epoch change and sending `resumeFrom` is Phase 11. Sending `hello.epoch` back on reconnect is cheap and optional.

**Close codes are not in the package** (no constant for 4401/4429). `CLOSE_AUTH_FAILED = 4401` is local to the FE Transport [VERIFIED: src/services/transport/Transport.ts:5]. Do **not** add them to `LIMITS` (that would change the snapshot's `limits` section and make a raise/diff event). Define local constants in `server/src/gateway/handshake.ts` and the FE Transport (4401, 4429), and add a small drift test, mirroring `contractConstants.test.ts`, that both equal the values in contract spec section 2.6.

If the planner nevertheless wants an "auth result" in `hello_ack` beyond `required`, the only safe route is an additive optional field (for example `auth.authenticated?: boolean`) plus snapshot update via `npm run contract:update`, fixtures, `contract:check` (expect additive). Not recommended: failure is already expressed as close 4401, and success is expressed by receiving the ack.

**Spec status:** contract spec section 2.5 already describes the target handshake: gateway with token "sends nothing until a valid `hello` arrives. First message not a valid `hello`, or no `hello` within 5 s: close **4401**. Token comparison MUST be constant-time."; no-token gateway sends `agent:init_list` immediately "and again after `hello_ack`"; FE with token and no `hello_ack` within 3 s "MUST NOT proceed (state `auth_failed`, message "gateway did not acknowledge authentication")"; FE without token and no ack in 3 s proceeds as legacy [VERIFIED: docs/superpowers/specs/2026-11-07-fe-be-contract.md:68-83]. Section 2.6 lists 4401 (`auth_failed`, no auto-retry) and 4429 ("Back off at least the advertised `retryAfterMs`") [VERIFIED: same file:85-92]. Section 7: "All routes except `GET /health` and the minimal form of `GET /api/health` require `Authorization: Bearer <token>` when a token is configured." and `agents` "omitted when unauthenticated and auth required" [VERIFIED: same file:296,301]. Implement to the spec; update spec text only where behavior differs (see Open Questions).

## Current hello / hello_ack Flow (as built)

| Side | Today | Evidence |
|------|-------|----------|
| Gateway connect | `wss.on('connection')` immediately calls `sessionManager.addClient(ws)`, which adds to the broadcast set and sends `agent:init_list` | [VERIFIED: server/src/index.ts:86-90 and server/src/services/SessionManager.ts:28-41] |
| Gateway `hello` | parsed by `parseClientMessage`, then `api.execute` -> dispatch `case 'hello': case 'ping': return Promise.resolve({ ok: true });` -> no reply frame | [VERIFIED: server/src/gateway/dispatch.ts:105-107] |
| Gateway `hello_ack` | never sent. grep of `server/src` finds no producer | [VERIFIED: grep "hello" server/src] |
| `epoch` | only on `/api/health` | [VERIFIED: server/src/http/apiRouter.ts:162-170] |
| FE `hello` | never sent. No `hello` string in non-test `src/` | [VERIFIED: grep] |
| FE 4401 | `Transport.onclose` with code 4401 sets `state: 'auth_failed'`, `nextRetryAt: null`, `lastError: 'authentication failed (code 4401)'` and returns without scheduling a retry | [VERIFIED: Transport.ts:133-139] |
| FE `open` | set in `socket.onopen` immediately | [VERIFIED: Transport.ts:112-115] |

Existing tests that pin today's behavior and **must be updated** by this phase:
- `server/__tests__/lifecycle.test.ts:359-367` "accepts a hello and ignores it": expects only `['pong']` after a `hello`; with a `hello_ack` reply it becomes `['hello_ack', ..., 'pong']`.
- `src/services/__tests__/backend.test.ts:21-32`: `VITE_WS_URL: 'ws://other:1234/ws'` and `{ VITE_BACKEND_URL: 'http://a:1', VITE_WS_URL: 'ws://b:2/ws' }` use non-loopback `ws://`; under D-11 these become `configError` cases. Change the fixtures to loopback hosts or `wss://` and add the refusal cases.
- `server/__tests__/hardening.test.ts:65-70` asserts `assertLoopbackBind('0.0.0.0')` throws matching `/HOST/`, `/no authentication/i`, `/unset HOST or use 127\.0\.0\.1/i`, and `:79-81` `bootstrap(0, '0.0.0.0')` rejects `/HOST/`. Keep `assertLoopbackBind` untouched and add a new `assertBindPolicy(host, token)`; `bootstrap` calls the new one. Both existing assertions keep passing for the no-token case if the new refusal text keeps those phrases (or update the test text deliberately).
- `server/src/gateway/__tests__/dispatch.test.ts:149-152` ("accepts hello and ping as no-ops") stays valid if the handshake is handled in `index.ts` before dispatch and dispatch's `hello` case is left as is.

## Where the Bearer Check and Hello Gate Go

### WebSocket gate (server/src/index.ts, connection handler)

```
connection(ws, req)
  ip = clientIp(req, trustProxy)                      # see Throttle
  if !auth:                                           # AGENT_MANAGER_TOKEN unset (D-12)
      authed = true; sessionManager.addClient(ws)     # today's behavior: init_list immediately
  else:
      if throttle.isBlocked(ip): ws.close(4429, ...)  # before any token work
      else: helloTimer = setTimeout(() => ws.close(4401, 'unauthenticated'), HELLO_TIMEOUT_MS=5000)
message(raw):
  if !authed:
      # D-07: nothing but hello is processed. No ping reply, no dispatch.
      parse JSON inside try/catch WITHOUT logging the error object
      parseClientMessage -> must be ok and type==='hello'   else close 4401
      auth.verify(msg.token) false  -> throttle.recordFailure(ip); close 4401
      true -> clearTimeout; throttle.recordSuccess(ip); authed = true
              ws.send(hello_ack); sessionManager.addClient(ws)   # ack BEFORE init_list
      return
  existing path (ping -> pong, parseClientMessage, dispatch)
  + a post-auth `hello` replies hello_ack without re-checking the token (and, in the no-token mode, may re-send agent:init_list per spec 2.5)
close/error: clearTimeout(helloTimer); removeClient(ws)  (removeClient on a never-added ws is a Set.delete no-op)
```

Rules that follow from the code:
- **Do not call `sessionManager.addClient` before auth.** `broadcast` iterates only `this.clients` [VERIFIED: SessionManager.ts:43-52], so an unregistered socket receives no `agent:output`/`added`/`removed` frames. This is also why no change to `SessionManager.ts` is needed.
- The existing `ping` special-case at `index.ts:103-108` runs before `parseClientMessage`; the auth check must come first or an unauthenticated peer gets `pong` (D-07).
- `wss.clients` still contains unauthenticated sockets, so the existing heartbeat loop (`terminate` after a missed pong) covers them; the 5 s timer is the primary bound.
- `verifyClient` (Origin allowlist, 403) stays as is and runs before the token.
- Do not send detail before close. A fixed reason string (`'unauthenticated'`) is enough; close reasons are limited to 123 bytes.
- Clear the hello timer in `close` and `error`, and `unref()` it.
- `hello_ack` is built by a pure `buildHelloAck({ epoch, authRequired })` in `handshake.ts` and **validated in a test with `parseServerMessage`** (required `backends` array, `server`/`limits` shapes). Take limits from `LIMITS` (`MAX_FRAME_BYTES`, `MAX_INPUT_BYTES`, `MAX_BROADCAST_TARGETS`). Advertise only capabilities the gateway really implements (`terminal`; do not claim `broadcast`/`history` unless dispatch handles them: `agent:history`/`agent:approve` are routed to an unsupported branch [VERIFIED: dispatch.ts:167-168]). Backend entry mirrors `/api/health`: `id: 'local'`, `up: true`.
- Contract mismatch: reply `hello_ack` anyway (carrying the gateway's `contract`) so the FE can show "gateway speaks contract N, this UI speaks M" (spec section 12) rather than closing.

### HTTP Bearer (server/src/http/apiRouter.ts)

Current order is: `Cache-Control: no-store` -> Host guard -> CSRF/Origin guard -> routes [VERIFIED: apiRouter.ts:133-160]. Insert the auth middleware **after the Origin guard and before every route except health**:

1. Move `router.get('/health', ...)` above the new middleware (it is currently defined at line 162, after the guards, which is correct relative to Host/Origin; keep it behind those two and ahead of auth). When auth is required and the request has no valid Bearer, omit `agents` (spec section 7; the `health-minimal-unauthenticated` fixture exists). When a valid Bearer is present, return the full body.
2. Middleware: read `req.headers.authorization`; scheme match `/^Bearer\s+(\S+)$/i`; `auth.verify(candidate)`; failure -> `401` via `sendError(res, 'UNAUTHENTICATED', 'authentication required', false)` plus `WWW-Authenticate: Bearer`. Fixed message, never echo the header. Missing header = 401 without counting a throttle failure (a probe, not a guess); present-but-wrong counts.
3. Throttled IP -> `429` `RATE_LIMITED` with `Retry-After` (seconds). Check the throttle before computing the token digest.
4. Because auth precedes the catalog stubs and the 404 handler, unauthenticated callers get 401 on every non-health path (no route-existence oracle).
5. `ApiRouterDeps` gains `auth?: AuthGuard` and `throttle?`; `undefined` means zero-config (no behavior change; all existing `httpApi.test.ts` cases pass unchanged because `bootstrap(0, '127.0.0.1', ...)` passes no token).
6. Legacy `GET /health` is defined in `index.ts` [VERIFIED: index.ts:52-58] and returns `agents` unauthenticated. Exempt per spec; recommended (discretion) to omit `agents` there when auth is required. Planner decides.

Place `AuthGuard` and `ApiRouterDeps` changes first (WA1) so the router work and the WS work can be reviewed independently, but **assign `index.ts` and `apiRouter.ts` to one plan** (see File Map).

### Authenticator (new server/src/gateway/auth.ts)

```ts
// Source: node:crypto docs (timingSafeEqual requires equal-length buffers)
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export interface AuthGuard {
  /** Constant-time check. Never throws; undefined/empty candidate is false. */
  verify(candidate: string | undefined): boolean;
}

export function createAuthGuard(token: string): AuthGuard {
  const expected = digest(token);               // held in a closure, never on CONFIG, never logged
  return {
    verify(candidate) {
      if (typeof candidate !== 'string' || candidate.length === 0) return false;
      return timingSafeEqual(digest(candidate), expected);
    },
  };
}

export function bearerOf(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1] : undefined;
}
```

Keep the token off the exported `CONFIG` object (`console.log(CONFIG)` would dump it). Read it in `config.ts` through a function (`resolveAuthToken(env)`), pass it to `bootstrap` as `options.token` (so tests inject it without touching `process.env`), and discriminate "option omitted" from "explicitly none" with `'token' in options`, otherwise a developer's exported `AGENT_MANAGER_TOKEN` silently turns auth on in unrelated tests.

### Bind policy and token validation (server/src/config.ts)

Current refusal: `assertLoopbackBind(host)` throws "Refusing to bind to non-loopback HOST ...: the gateway has no authentication yet. Unset HOST or use 127.0.0.1." [VERIFIED: config.ts:13-20]; `bootstrap` calls it at `index.ts:27`.

Add (keep `assertLoopbackBind` for back-compat/test):
- `MIN_TOKEN_LENGTH = 24`, `MAX_TOKEN_LENGTH = 512` (the validator's `hello.token` cap), charset `/^[\x21-\x7e]+$/` (printable ASCII, no spaces: valid for the `Bearer` header and `noControl` in `hello`). Validate **whenever the variable is set** (also on loopback), not only for non-loopback binds: one rule, and a too-long or non-ASCII token could never authenticate over `hello`/Bearer. Messages state the rule and never include the value.
- `assertBindPolicy(host, token)`: loopback -> ok; non-loopback with a valid token -> ok; non-loopback without -> throw "Refusing to bind to non-loopback HOST "x": set AGENT_MANAGER_TOKEN (at least 24 characters) or use 127.0.0.1." Keep the phrases `HOST` and an "unset HOST or use 127.0.0.1" hint if the old test text should stay green.
- Whitespace: do not `trim()` silently. A token with surrounding spaces fails the charset check with a clear message (an `.env` trailing newline is the usual cause; `rawHost` is trimmed today [VERIFIED: config.ts:60], but a secret should not be mutated).
- Also parse `AGENT_MANAGER_TRUST_PROXY` here (see Throttle).

## Per-IP Failure Throttle (bounded map)

Module `server/src/gateway/authThrottle.ts`, one instance created in `bootstrap` and shared by WS and HTTP.

```ts
export interface ThrottleOptions {
  maxFailures: number;   // default 5
  windowMs: number;      // default 60_000
  lockMs: number;        // default 60_000; doubles per consecutive lockout up to maxLockMs (default 15 min)
  maxKeys: number;       // default 10_000 (hard bound)
  now?: () => number;    // injected clock for tests
}
interface Entry { failures: number; windowStart: number; lockedUntil: number; strikes: number }
// check(ip): { allowed: true } | { allowed: false, retryAfterMs }
// recordFailure(ip): void;  recordSuccess(ip): void (delete entry)
```

Design points:
- `Map<string, Entry>` insertion-ordered. On insert when `size >= maxKeys`: first sweep expired entries (window elapsed and not locked), then evict the oldest key. Memory is O(maxKeys) regardless of attacker behavior; evicting only forgets a counter. Add a lazy sweep (no timer, or an `unref`'d interval) so entries expire without traffic.
- Key = normalized IP: strip `::ffff:` IPv4-mapped prefix; collapse IPv6 to its `/64` so an attacker with a /64 cannot rotate addresses. The key is never derived from, and the entry never stores, the candidate token or its digest.
- WS: blocked IP gets `ws.close(4429, ...)` at connection time without evaluating any token (a correct token during lockout is also refused: standard). Put the retry hint in the close reason as plain text (for example `retry-after-ms=60000`; reason is at most 123 bytes). FE treats 4429 as a normal reconnect with delay `max(backoff, advertised retryAfterMs)`; this satisfies spec 2.6 and still avoids a storm.
- HTTP: `429` + `Retry-After` header + `RATE_LIMITED` envelope.
- Success resets the entry (`recordSuccess`).
- **Client IP source (critical):** with the D-09 nginx topology every connection arrives from the proxy, so `req.socket.remoteAddress` is `127.0.0.1` for everyone and a naive per-IP throttle would lock **all** users after N failures from any one of them. Provide `clientIp(req, trustProxy)`: when `AGENT_MANAGER_TRUST_PROXY` is truthy **and** the socket peer is loopback, use `X-Forwarded-For`; otherwise use the socket address. The nginx example must set `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, not `$proxy_add_x_forwarded_for`) so a client cannot prepend a spoofed value, and the code takes the **last** entry. Default is trust off (safe for direct exposure). For the HTTP path the raw `IncomingMessage` is `req` in both cases; do not rely on Express `req.ip`/`trust proxy` since the WS path has none.

Defaults (N, window, lock) are Claude's discretion; the values above are the recommendation. All are constructor options so tests run with tiny windows and a fake clock.

## FE: Token Store, Hello, 4401, Dialog

### Token module (new `src/services/auth/tokenStore.ts`)
- Private module variable holds the token; mirror to `sessionStorage` under a key with the prefix `agent-manager.` (for example `agent-manager.token`). Wrap every storage access in try/catch (storage can throw `SecurityError`). Never `localStorage`, never a URL, never `import.meta.env` (D-01, D-02).
- Public API: `getToken()`, `setToken(t)`, `clearToken()`, and `useAuthStore` (zustand) holding **only** `hasToken: boolean` (and maybe `epoch`). The token string itself must not be in any zustand state: stores are the thing tests/diagnostics serialize, and `devtools`/dumps would leak it.
- Load from `sessionStorage` once at module init so a reload keeps the session.
- Validate on submit: trim, non-empty, at most 512 chars, no control characters (matches the `hello.token` validator, which otherwise makes the server drop the frame as invalid and close 4401).

### Hello and ack (Transport / WsAdapter / agentSocket)
- `TransportOptions` gets `helloFrame?: () => string` (built per attempt by `WsAdapter`, which reads `getToken()` at open time so reconnects use the current token). In `socket.onopen`, send it **before** `onState('open')` so it is the first frame on the wire. The token travels only through this path; `agentSocket.send` (which logs `message "${msg.type}" not sent`) and `AgentRequests.resendInFlight` never see it.
- `hello` content: `{ type: 'hello', contract: CONTRACT_VERSION, token?: <only if set>, epoch?: <last seen> , client?: ... }` typed as `WSMessageClient` so the package type checks it.
- Without a `helloFrame` option Transport behaves exactly as today (keeps the existing 15+ Transport tests unchanged).
- `hello_ack` handling: intercept in `WsAdapter.handleFrame` next to the `pong` early return [VERIFIED: WsAdapter.ts:112-114], validate with `parseServerMessage`, and (a) if `contract` differs from `CONTRACT_VERSION`, set state `closed` with "gateway speaks contract N, this UI speaks M" (spec section 12); (b) otherwise record `epoch` and `auth.required` in `connectionStore` (new non-secret fields `epoch: string | null`, `authRequired: boolean | null`; update `INITIAL_SNAPSHOT`/`applySnapshot`/`reset` and `connectionStore.test.ts` which does `toMatchObject` on the snapshot) and tell Transport `acknowledge()`.
- Spec timers: with a token set and no `hello_ack` in 3 s -> `auth_failed`, lastError "gateway did not acknowledge authentication"; without a token and no ack -> proceed (legacy). Spec section 2.2 says `open` means socket open "and, for contract 1 gateways, `hello_ack` received". Recommendation: keep the immediate `open` transition (smallest blast radius, nothing else changes) and add only the 3 s ack watchdog for the token-set case. The flash of "Connected" before a 4401 is a UX wart, not a safety issue because the server registers the socket only after auth. If the planner prefers strict spec semantics (state stays `connecting` until the ack), it costs `WsAdapter.test.ts`/`Transport.test.ts`/`agentSocket.test.ts` updates and a 3 s legacy delay, and `resendInFlight` (fires on `open`) then correctly waits for auth. Flag to the planner as an explicit choice (Open Questions).

### 4401 and no reconnect storm (D-05)
Transport already stops on 4401: `clearHeartbeat()`, state `auth_failed`, `nextRetryAt: null`, no timer scheduled [VERIFIED: Transport.ts:129-139]. Keep, and add:
- Test asserting "no storm": after a 4401 close, advance fake timers by minutes and assert the `FakeWebSocket` instance count stays 1 and `vi.getTimerCount() === 0`. Also: `socket.onopen` of an abandoned socket does nothing.
- Guard `reconnectNow()`/`connect()` entry points: after `auth_failed`, only `submitToken(newToken)` (set token + `adapter.connect()`) restarts; `ConnectionBanner` has no Retry button in that state today [VERIFIED: ConnectionBanner.tsx:70-76] and must keep none (add an "Enter token" button that opens the dialog instead).
- 4429: `handleUnexpectedClose` with delay floor from the close reason; still bounded by the existing backoff.
- Wrong token resubmitted: the server throttle handles brute force; the FE does not auto-retry at all.

### Dialog, banner, chip, header, palette
- Overlay: add `'token'` to `Overlay` in `uiStore.ts` [VERIFIED: uiStore.ts:3] and render `TokenDialog` through `OverlayPortal` with `useModalFocus` like `AddAgentModal`/`PaletteDialog` (role `dialog`, `aria-modal`, `aria-labelledby`, initial focus on the `type="password"` input, `autoComplete="off"`; do not render the token anywhere; clear component state on close).
- Trigger: subscribe once (an effect in `App.tsx` or a small hook) to `useConnectionStore.state === 'auth_failed'` and call `openOverlay('token')`. Escape closes the dialog without logout; the banner keeps an "Enter token" button. Banner/Chip already render "Authentication failed"/"Auth failed" [VERIFIED: ConnectionBanner.tsx:70-76, ConnectionStatusChip.tsx:36-37]; do not put raw server text into them.
- Logout entry points (D-04): Header has no menu today [VERIFIED: Header.tsx content], so add a "Log out" button (or small menu) next to the chip rendered only when `useAuthStore.hasToken`; and a palette command `{ id: 'auth.logout', title: 'Log out', keywords: 'token sign out clear session' }` pushed in `buildCommands()` only when `hasToken` [VERIFIED: commands.ts buildCommands structure, lines 63-102]. UI-only command (not a catalog operation, like `filter.focus`). **`PaletteDialog` memoizes `buildCommands()` on `[agents, pending, isBroadcastOpen]` [VERIFIED: CommandPalette.tsx useMemo]; add `hasToken` to that dep list** or the command never appears/disappears.
- `commands.test.ts` pins the exact title list for the default state (`buildCommands().map((c) => c.title)`); since logout only appears with a token, the default stays green. Add tests for both states. `docs/KEYBOARD.md` lists palette reach (line 19 region); add the command there.

## Logout Clearing List (D-03)

Create `src/services/session/logout.ts` (a leaf that imports the stores; avoids import cycles because `agentStore` and `logBufferStore` already import `agentSocket`). Order matters:

| # | What | How | Note |
|---|------|-----|------|
| 1 | In-flight request promises | `agentSocket.requests.clear()` (drops entries and timers **without** rejecting) | `dispose()` rejects with `NOT_CONNECTED`, whose handlers push "Could not create..." roster notices into the store you are about to empty (pitfall). Dropped promises are unreferenced and collected. |
| 2 | Socket | `agentSocket.getAdapter().disconnect()` -> `Transport.close()` (state `closed`, clears timers) | Do this before clearing stores so no late frame repopulates them |
| 3 | `useAgentStore` | New exported `resetAgentStore()`: set `agents`, `pending`, `killing`, `rosterNotices`, `activeAgentId`, `layoutMode`, `searchQuery` back to initial for the current mode; plus reset module-level state `addedAt`, `removedAt`, `updatedAt`, `snapshotIds`, `snapshotAt`, `rosterSeq`, `pendingCounter`, `noticeCounter` [VERIFIED: agentStore.ts:67-92, 143-150, 280-290] | These tracking maps live outside zustand; forgetting them leaks agent ids and ordering across sessions |
| 4 | `useLogBufferStore` | `clearBuffer()` (already exists, no arg clears all) [VERIFIED: logBufferStore.ts clearBuffer] | Holds terminal output text, the most sensitive data in the app |
| 5 | `useUiStore` | `resetUiStore()` (exists) [VERIFIED: uiStore.ts:45-47] then `openOverlay('token')` | Closes palette/search/addAgent/broadcast |
| 6 | `useConnectionStore` | clear `epoch`, `authRequired`, `lastError`; keep `mode` (do not call `reset()`, which sets mode back to `'live'`) | |
| 7 | Token | `clearToken()` (memory + sessionStorage key) | |
| 8 | Other storage | Remove every key beginning with `agent-manager.` from **both** `sessionStorage` and `localStorage` | There is currently no storage use in non-test `src/` [VERIFIED: grep for localStorage/sessionStorage]. Phase 13 (workspace persistence) will add keys; a prefix sweep makes "remove token and workspace data from storage" hold for future keys without editing logout. Document the prefix convention in the Phase 13 hand-off. |
| 9 | Component-local state | `NotificationToastManager` keeps status `toasts` (agent names) in React state [VERIFIED: NotificationToastManager.tsx:20]; they expire in 5 s. Either accept or remount via a `key` bump from a `sessionEpoch` counter. Terminals unmount when the roster empties. | Low risk; mention in the plan |
| 10 | Demo mode | Logout is shown only when a token is set, so Demo mode (no backend) never shows it; guard anyway | |

Result state after logout: socket `closed`, token dialog open. Submitting a token calls `setToken` then `adapter.connect()`; the next 4401 re-opens the dialog. Do not auto-reconnect during logout (that would send a token-less `hello`, burn a throttle failure, and flash an error).

## ws:// Loopback Rule (D-11)

Implement in `resolveBackendConfig` [VERIFIED: src/services/backend.ts:28-63] so the existing `configError` -> `WsAdapter({ disabledReason })` -> state `closed` with `lastError` -> banner path shows the message and never opens a socket. The adapter's `connect()` returns early when `disabledReason` is set [VERIFIED: WsAdapter.ts connect], so there is **no fallback**.

- Compute the final `wsUrl`; if its protocol is `ws:` and the hostname is not loopback -> `configError = 'Refusing plain ws:// to non-loopback host "<host>": use wss:// (https://) behind TLS'` and keep safe defaults as the other error branches do.
- Loopback test on `URL.hostname`: `localhost`, `::1` (the URL parser reports `[::1]`; accept both), and `/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/` with octets <= 255. Exact match only: `localhost.evil.com`, `127.0.0.1.evil.com` and `0.0.0.0` must be non-loopback. `new URL` normalizes shorthand IPv4 such as `127.1`; test it. Mirror the server's anchored implementation [VERIFIED: config.ts:5-11] but do not import server code into the FE; add a test table shared in spirit (same cases) on both sides.
- Token-in-URL hygiene (criterion 3): the legacy `VITE_WS_URL` branch uses the string **verbatim** (`wsUrl = legacyWs`) [VERIFIED: backend.ts:50-55], so `?token=...` or `user:pass@` in it would reach `new WebSocket(url)`. Reject (configError) any `ws(s)` URL with `username`, `password`, `search` or `hash`. Test: `resolveBackendConfig({ VITE_WS_URL: 'wss://h/ws?token=SECRET' })` has `configError` and `wsUrl` without `SECRET`.
- Existing tests to rework: `backend.test.ts:21-32` (see above).
- `httpBase` is unused by any FE code today (only defined in backend.ts), so no Bearer FE client exists; Bearer is for external tools and docs.

## Token Scrubbing (logs and "diagnostics export")

### Server log sites that exist today
| Site | Logs | Token risk | Action |
|------|------|-----------|--------|
| `server/src/index.ts:119` `console.error('Invalid WebSocket message received:', err)` | the thrown error object | `JSON.parse` SyntaxError messages quote a prefix of the input for "Unexpected token" errors, e.g. `Unexpected token 'x', "x{"token":"... is not valid JSON` [VERIFIED: ran node v26.8.1 this session]. A `hello` frame with leading garbage leaks its first characters; with Node/V8 versions that quote longer snippets it could leak the token | Replace with a fixed message plus an error class/name only. Pre-auth path logs nothing per frame (a flood of bad pre-auth frames must not become a log flood either). |
| `index.ts:128` `console.error('WebSocket client error:', err)` | ws error object | no frame content expected from `ws` errors [ASSUMED] | log `err.code`/`err.name` only |
| `apiRouter.ts:280` `oneLine(err)` | error message | body-parser JSON errors carry status 400 and are answered before this line [VERIFIED: apiRouter.ts:271-278]; other messages are internal | keep; unit-test |
| `dispatch.ts:46`, `AgentService.ts:124,191,198,327`, `policy.ts:58` | service-derived text (agent ids truncated, driver errors) | not frames | leave; covered by the canary test only as a regression net |
| `rejectionFor` | `invalid field: <name>` (field names only, never values) [VERIFIED: wsFrames.ts:50-58] | none | keep; pre-auth path does not use it at all |

### Primitive
`redactSecrets(text, secrets: string[])` in the gateway (and a FE copy under `src/services/redact.ts`) replacing every occurrence of each secret (and its hex SHA-256) with `[redacted]`, plus `scrubFrameForLog(raw)` that masks the `token` property of a parsed frame. Use them at any new log site that prints a frame, an error from frame parsing, or `req.headers`. **Never log headers or frames wholesale** (an `Authorization` header is a token). Phase 21's "Copy diagnostics" must call the FE redactor over its whole payload; record that in the Phase 21 hand-off (docs), since the export does not exist yet.

### Test strategy (the "test-asserted" criterion)
Canary approach: use a distinctive token (for example `CANARY-0123456789abcdefghijklmn`, >= 24 chars) and its SHA-256 hex, run hostile flows, and assert that neither string appears anywhere in the collected output.

Server (`server/__tests__/authScrub.test.ts`, real `bootstrap` with `token` option, console spies on `log|info|warn|error`):
- correct hello; wrong token; hello with leading garbage (`x{"type":"hello","token":"<canary>"}`); truncated JSON containing the canary; oversized hello; hello with control chars in the token; hello missing `contract`; HTTP with wrong Bearer, with the canary as an invalid JSON body, with the canary in query and path; throttled IP.
- Assert: `JSON.stringify(allSpyCalls)` contains neither string; every error frame/close reason/HTTP body received by the client contains neither string.
- Unit tests for `redactSecrets`/`scrubFrameForLog`.

FE (`src/**/__tests__/authScrub.test.ts`):
- Drive `tokenStore.setToken(canary)`, a `Transport`/`WsAdapter` with `FakeWebSocket`, `hello` send, 4401 close, token dialog submit and logout. Spy on `console.*` and record the URLs passed to the WebSocket constructor and `fetch` (none expected).
- Assert the canary is absent from: all console calls; every `useXStore.getState()` serialized with `JSON.stringify` (agent, connection, logBuffer, ui, auth); `ConnSnapshot` fields incl. `lastError`; `document.body.textContent` and the DOM `value` of every input after the dialog closes; the only allowed sinks are the `hello` frame body and the single `sessionStorage` entry (assert the `sessionStorage` key list equals exactly `['agent-manager.token']`).
- After logout: `sessionStorage.length === 0` (and no `agent-manager.` keys in `localStorage`), all stores equal their initial state, `useLogBufferStore` buffers `{}`, `requests` has no in-flight entries.
- "Diagnostics" proxy assertion for Phase 8: because the export is Phase 21, test the data sources it will read (connection snapshot, roster notices, console ring if added) and add a skipped/`todo` test named "Copy diagnostics redacts the token" cross-referenced to INT-10 so it cannot be forgotten.

## Architecture Patterns

### System Architecture Diagram

```
Browser (FE)                                       Reverse proxy (nginx, TLS)            Gateway (plain HTTP/WS)
-----------                                        ---------------------------           -----------------------
resolveBackendConfig --ws:// non-loopback?--> configError, no socket
   |
tokenStore (memory + sessionStorage) -----+
   |                                      |
Transport.connect -> new WebSocket(wss://host/ws)  ---TLS--->  proxy_pass http://127.0.0.1:8088
   | onopen: send hello{contract,token?,epoch?}   ------------------------------->  verifyClient (Origin allowlist, 403)
   |                                                                                connection: throttle.check(ip)
   |                                                                                  blocked -> close 4429
   |                                                                                  no token configured -> addClient (init_list)
   |                                                                                  token configured: arm 5s timer, NOT in clients
   |                                                                                message#1 must be valid hello
   |                                                                                  verify(token) timingSafeEqual(sha256)
   |   <---- hello_ack{contract,epoch,auth,limits,backends}  <----- ok --------------  then addClient -> agent:init_list
   |   <---- close 4401 ------------------------------------------- fail/timeout ----  throttle.recordFailure(ip)
   v
4401 -> state auth_failed (no timers) -> TokenDialog -> submitToken -> setToken -> connect
logout -> requests.clear, disconnect, reset stores, clear storage -> TokenDialog

External client:  GET/POST /api/* with Authorization: Bearer  ->  Host guard -> Origin guard -> (health exempt) -> Bearer verify
                                                                  -> 401 UNAUTHENTICATED | 429 RATE_LIMITED | route
```

### Recommended Project Structure
```
server/src/
  config.ts                   # + resolveAuthToken, assertBindPolicy, trust-proxy parse
  gateway/
    auth.ts                   # createAuthGuard, bearerOf, redactSecrets (NEW)
    authThrottle.ts           # bounded per-IP failure map (NEW)
    handshake.ts              # buildHelloAck, HELLO_TIMEOUT_MS, CLOSE_*, clientIp (NEW)
  index.ts                    # WS gate, shared epoch, pass auth/throttle to router (HOT)
  http/apiRouter.ts           # Bearer middleware, health exemption (HOT)
src/
  services/auth/tokenStore.ts # token + useAuthStore(hasToken) (NEW)
  services/session/logout.ts  # orchestration (NEW)
  services/redact.ts          # FE redactor for Phase 21 (NEW)
  components/layout/TokenDialog.tsx (NEW)
```

### Anti-Patterns to Avoid
- Registering the socket (`addClient`) before auth, or gating only on a boolean while still broadcasting.
- Putting the token in `CONFIG`, a zustand store, `ConnSnapshot`, an error message, a URL, or a log argument.
- `===` / `Buffer.compare` / `.includes` to compare tokens.
- Counting throttle failures by `remoteAddress` behind a proxy without the trust-proxy design above.
- Using `requests.dispose()` in logout (generates notices into the store being cleared).
- Calling `useConnectionStore.reset()` in logout (flips `mode` to `live`).
- Adding `LIMITS`/close-code constants to the protocol package (needless snapshot churn).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constant-time compare | char-by-char loop | `crypto.timingSafeEqual` on SHA-256 digests | Equal-length buffers, no length oracle |
| Header parsing | ad hoc split | one anchored regex `bearerOf` | Single tested parse |
| Modal focus/trap/Escape | custom key handling | `useModalFocus` + `OverlayPortal` | Already the standard for every dialog (ADR-009 z-scale) |
| Loopback test (server) | new helper | existing `isLoopbackHost` | Anchored, tested |
| Zustand reset | per-field ad hoc | exported `resetAgentStore()` incl. module maps | One tested place |
| TLS | gateway TLS | nginx per D-09 | Out of scope |

**Key insight:** every security-sensitive primitive here is either in Node's crypto or already in the repo; the risk is in the wiring order (auth before registration, redaction before logging), not in algorithms.

## Runtime State Inventory

Not a rename/refactor/migration phase; omitted (greenfield behavior added to existing files). One adjacent note: gateway `epoch` is per process and regenerated on restart (`randomUUID`), so it changes on every gateway restart [VERIFIED: index.ts:67]; no stored data depends on it yet.

## Common Pitfalls

### Pitfall 1: Roster leaked before auth
**What goes wrong:** the existing connection handler calls `addClient` first, so `agent:init_list` and broadcasts reach an unauthenticated socket.
**Why:** auth was bolted on after the registration line.
**How to avoid:** the gate decides *whether* `addClient` runs; test with a raw `ws` client that never sends hello and assert zero frames for > 5 s until the 4401 close, and that a concurrent authed client's `agent:added` is never seen by it.
**Warning signs:** any frame received before `hello_ack` on a token-protected gateway.

### Pitfall 2: Proxy collapses all clients to one IP
**What goes wrong:** with nginx the peer is always loopback; one attacker locks out everyone, or (if unthrottled) brute force is free.
**How to avoid:** the `AGENT_MANAGER_TRUST_PROXY` + overwrite-XFF design; test `clientIp` with spoofed multi-value headers (last entry wins; header ignored when peer is non-loopback or trust is off).

### Pitfall 3: JSON.parse error text leaks the frame prefix
**What goes wrong:** `console.error('...', err)` prints `Unexpected token 'x', "x{"token":"..."` [VERIFIED: ran node]. 
**How to avoid:** log a fixed string; test with a leading-garbage hello and the canary.

### Pitfall 4: Host guard blocks the proxied `/api`
**What goes wrong:** nginx forwarding `Host: gateway.example.com` fails the DNS-rebinding guard (`allowedHostNames` = loopback names + the bound `HOST`) with 403 "host not allowed" [VERIFIED: apiRouter.ts:127-148], so `/api` works locally but not through the proxy.
**How to avoid:** nginx example sets `proxy_set_header Host 127.0.0.1:8088;` (works with the existing guard, no new config). Also the browser Origin must be in `ALLOWED_ORIGINS` (which accepts https origins via `parseAllowedOrigins` [VERIFIED: config.ts:33-58]) for the WS upgrade and mutating `/api` calls. Document both; nginx must also forward `Upgrade`/`Connection` and set a long `proxy_read_timeout` for `/ws`.

### Pitfall 5: Logout races
**What goes wrong:** rejected in-flight requests push notices after stores are cleared; a late frame repopulates the roster; `mode` flips.
**How to avoid:** logout order table above; test: pending create in flight at logout leaves `rosterNotices` empty.

### Pitfall 6: Stale palette memo
`PaletteDialog` memoizes commands on specific deps; the logout command needs `hasToken` in the deps list.

### Pitfall 7: Empty token semantics
`hello.token` min is 0, so `""` validates. Server must treat empty/absent as "no token" and fail when auth is required (the authenticator already returns false for empty). FE must not send `token: ''`; omit the field.

### Pitfall 8: Env-var leakage into tests
`process.env.AGENT_MANAGER_TOKEN` set in a developer shell would turn auth on in all server tests unless `bootstrap` takes `options.token` and treats an explicit `undefined`/none as "no auth" (use `'token' in options`). Add a test that sets the env var and still boots a no-token instance via the option.

### Pitfall 9: Hello timer and heartbeat interplay
FE heartbeat starts at `onopen` (15 s idle) [VERIFIED: Transport.ts armIdleTimer]; the server's 5 s hello deadline and 3 s FE ack watchdog both complete first. Clear all three on close; assert no timer remains (`vi.getTimerCount()`).

### Pitfall 10: Pre-auth resource use
Pre-auth frames still allow the 1 MiB `maxPayload` [VERIFIED: index.ts:37]. Optionally cap the first frame (a hello with 1000 `resumeFrom` entries can reach well under 256 KiB) and limit simultaneous unauthenticated sockets per IP; with the 5 s timer and `unref`'d timers this is bounded. Discretion; note in plan.

## Code Examples

### WS gate skeleton (index.ts)
```ts
// Source: derived from existing connection handler (server/src/index.ts:86-131)
wss.on('connection', (ws, req) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  let authed = auth === undefined;
  let helloTimer: ReturnType<typeof setTimeout> | undefined;
  const ip = clientIp(req, trustProxy);

  if (auth) {
    const gate = throttle.check(ip);
    if (!gate.allowed) { ws.close(CLOSE_RATE_LIMITED, `retry-after-ms=${gate.retryAfterMs}`); return; }
    helloTimer = setTimeout(() => ws.close(CLOSE_UNAUTHENTICATED, 'unauthenticated'), HELLO_TIMEOUT_MS);
    helloTimer.unref();
  } else {
    sessionManager.addClient(ws);
  }
  ws.on('message', (data) => {
    if (!authed) { /* parse (no logging), require hello, verify, then ack + addClient */ return; }
    /* existing ping / parse / dispatch path unchanged */
  });
  ws.on('close', () => { if (helloTimer) clearTimeout(helloTimer); sessionManager.removeClient(ws); });
});
```

### Transport hello hook
```ts
// Source: derived from Transport.openSocket (src/services/transport/Transport.ts:103-115)
socket.onopen = () => {
  if (this.socket !== socket) return;
  if (this.helloFrame) { try { socket.send(this.helloFrame()); } catch { /* close handler follows */ } }
  this.onState({ state: 'open', lastConnectedAt: Date.now(), lastError: null, nextRetryAt: null });
  this.armIdleTimer();
};
```

### nginx example for docs (D-09)
```nginx
location /ws {
  proxy_pass http://127.0.0.1:8088;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host 127.0.0.1:8088;          # satisfies the /api Host guard
  proxy_set_header X-Forwarded-For $remote_addr; # overwrite; trusted by AGENT_MANAGER_TRUST_PROXY=1
  proxy_read_timeout 3600s;
}
location /api/ { proxy_pass http://127.0.0.1:8088; proxy_set_header Host 127.0.0.1:8088; proxy_set_header X-Forwarded-For $remote_addr; }
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Token in WS URL query | First-message `hello` (this phase, D-13) | Tokens stay out of proxy/access logs and browser history |
| Gateway refuses all non-loopback binds (Phase 4) | Refuses non-loopback unless a valid token is set | Remote use possible behind TLS proxy |

**Deprecated/outdated:** the docs sentence "Non-loopback bind is refused until token auth ships" (spec line 17, README, RUNNING) must be rewritten.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ws` library error objects do not contain frame content | Token Scrubbing | A token could appear in `ws` error text; mitigated by logging only `err.code`/`err.name` |
| A2 | Defaults N=5 failures / 60 s window / 60 s lock (doubling to 15 min) / 10 000 keys / min token 24, max 512 | Throttle, Bind policy | Only tuning; Claude's discretion per CONTEXT |
| A3 | Terminals/panes unmount (and dispose xterm) when the roster is emptied by logout | Logout list | Terminal scrollback could persist in xterm instances until unmount; verify with Workspace/TerminalView tests (`TerminalViewDispose.test.tsx` exists) |
| A4 | nginx directives in the example are correct for the user's nginx version | Code Examples | Docs only; user-verifiable |
| A5 | Keeping immediate `open` + 3 s watchdog (rather than strict "open after ack") is acceptable | FE Hello | Spec 2.2 literal reading says `open` after `hello_ack`; needs a planner/user choice |
| A6 | `new URL('ws://127.1/ws').hostname` normalizes to `127.0.0.1` | ws:// rule | If not normalized, shorthand loopback would be refused (safe direction); test it |
| A7 | Omitting `agents` from legacy `/health` when auth is required is desirable | HTTP Bearer | Spec exempts `/health`; changing it is optional |

## Open Questions

1. **`open` before or after `hello_ack`?**
   - Known: spec 2.2 says after ack for contract-1 gateways; today `open` is set in `onopen`.
   - Unclear: whether to pay the test churn and 3 s legacy delay.
   - Recommendation: keep immediate `open` plus the 3 s token-set watchdog; record the deviation in the spec and ADR.
2. **Re-send `agent:init_list` after `hello_ack` in no-token mode?** Spec 2.5 says yes; not required for correctness (FE already has the connect snapshot). Recommendation: do it via `sessionManager.service.list()` in `index.ts` so `SessionManager.ts` stays untouched, or defer to Phase 11 and amend the spec.
3. **Legacy `/health` `agents` field when auth required** - omit (recommended) or keep (spec-literal).
4. **Trust-proxy flag name/semantics** (`AGENT_MANAGER_TRUST_PROXY=1`) is new config surface; confirm or choose another name.
5. **Pre-auth first-frame cap / per-IP concurrent unauthenticated sockets** - include or leave to Phase 21 hardening.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | server + tests | yes | v26.8.1 | - |
| npm / vitest | tests (`vitest ^1.6.0` root and server) | yes (repo deps) | - | - |
| `crypto` (built-in) | auth | yes | built-in | - |
| nginx | docs example only | not required | - | doc-only, not run |

No missing blocking dependencies. Real-network e2e between FE Transport and gateway is covered by manual QA / Phase 7, as noted in STATE.md (never run end to end).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^1.6.0` (root: jsdom, globals, `setupFiles: ./src/setupTests.ts`; server: default node env with protocol alias) [VERIFIED: vite.config.ts test block, server/vitest.config.ts] |
| Config file | `vite.config.ts` (root), `server/vitest.config.ts` |
| Quick run command | `npx vitest run <file>` (root), `npm --prefix server test -- <file>` |
| Full suite command | `npm test && npm --prefix server test && npx tsc --noEmit && npm run contract:check` |

Note `src/setupTests.ts` stubs `VITE_DEMO_MODE=1`: FE tests of the real Transport/WsAdapter must construct them directly with `FakeWebSocket` (as `Transport.test.ts` does), not via the `agentSocket` singleton.

### Phase Requirements -> Test Map
| Req (criterion) | Behavior | Test Type | Automated Command | File Exists? |
|-----------------|----------|-----------|-------------------|-------------|
| C1 | Wrong token -> `auth_failed`, zero reconnects after minutes of fake time | unit (Transport) | `npx vitest run src/services/transport` | extend Transport.test.ts |
| C1 | Gateway closes 4401 on wrong token / no hello in 5 s / non-hello first frame; no frames before ack | integration (real ws) | `npm --prefix server test -- auth` | Wave 0 (new `server/__tests__/auth.test.ts`) |
| C1/D-06 | Throttle: N failures -> 4429/429; window expiry; bound; eviction; success reset | unit w/ fake clock | `npm --prefix server test -- authThrottle` | Wave 0 |
| C2 | Non-loopback `ws://` -> `configError`, no socket; loopback table; credentials/query rejected | unit | `npx vitest run src/services/__tests__/backend.test.ts` | exists (edit) |
| C2/D-10 | Non-loopback bind w/o valid token refuses; short/long/non-ASCII token refuses; token OK | unit + `bootstrap` | `npm --prefix server test -- hardening` | exists (edit) |
| C3 | Canary token absent from logs/stores/URLs/DOM/errors (server + FE) | integration | see Token Scrubbing | Wave 0 |
| C3 | Logout empties every store, module maps, storage | unit/RTL | `npx vitest run src/services/session` | Wave 0 |
| C4 | `hello_ack` built by gateway passes `parseServerMessage`; carries contract, auth, epoch; same epoch as `/api/health` | unit + integration | `npm --prefix server test -- handshake` | Wave 0 |
| D-08 | Bearer required on `/api/*` except health; missing/wrong -> 401 `UNAUTHENTICATED`; token in query ignored; minimal health body | integration | `npm --prefix server test -- auth` | Wave 0 |
| D-12 | No token configured: legacy behavior byte-for-byte (existing suites unchanged) | regression | `npm --prefix server test` | exists |
| Contract | No surface change | gate | `npm run contract:check` | exists |

### Sampling Rate
- **Per task commit:** the targeted test file for the touched module.
- **Per wave merge:** `npm test`, `npm --prefix server test`, `npx tsc --noEmit`, `npm run contract:check`.
- **Phase gate:** full suite green plus `npm run build` and `npm --prefix server run build` before `/gsd-verify-work`. Known flake: `server/__tests__/hardening.test.ts` liveness test under load (STATE.md); do not weaken it.

### Wave 0 Gaps
- [ ] `server/src/gateway/__tests__/{auth,authThrottle,handshake}.test.ts`
- [ ] `server/__tests__/auth.test.ts` (WS + HTTP over real sockets, mocked drivers like `lifecycle.test.ts`) and `server/__tests__/authScrub.test.ts`
- [ ] `src/services/auth/__tests__/tokenStore.test.ts`, `src/services/session/__tests__/logout.test.ts`, `src/components/layout/__tests__/TokenDialog.test.tsx`, FE `authScrub.test.ts`
- [ ] Drift test for 4401/4429 local constants vs spec values
- Framework install: none.

## Security Domain

`security_enforcement` is enabled (ASVS level 1, block on high) [VERIFIED: .planning/config.json].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Shared secret, min 24 chars enforced at startup, `timingSafeEqual` on SHA-256 digests, per-IP throttle |
| V3 Session Management | partial | Token in `sessionStorage` only; logout clears memory/storage/stores; no cookies (spec section 7) |
| V4 Access Control | yes | Gate precedes registration/broadcast; Bearer precedes all non-health routes; `confirm: true` policy is orthogonal and unchanged |
| V5 Input Validation | yes | `parseClientMessage` for hello (token <= 512, no control chars); Bearer regex; URL validation in `resolveBackendConfig` |
| V6 Cryptography | yes | `node:crypto` only; no custom primitives; TLS delegated to nginx |
| V7 Error Handling/Logging | yes | Fixed messages, canary tests, redactor |
| V9 Communications | yes | wss enforced FE-side for non-loopback; document nginx TLS config |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token brute force | Spoofing | Min length 24, constant-time compare, per-IP throttle (4429/429), no FE auto-retry |
| Timing side channel on compare | Information disclosure | Digest both sides, `timingSafeEqual` |
| Pre-auth data exposure | Information disclosure | Do not `addClient` until valid `hello`; 5 s deadline |
| Token in logs/URL/errors | Information disclosure | Fixed log messages; no URL token; canary tests; redactor |
| Cross-site WebSocket hijack | Spoofing/Tampering | Existing Origin allowlist (403) retained; token required anyway |
| DNS rebinding to `/api` | Spoofing | Existing Host guard retained, ahead of auth |
| Plaintext token over network | Information disclosure | FE refuses non-loopback `ws://`; non-loopback bind requires token; TLS at proxy |
| Throttle evasion/poisoning via proxy headers | Spoofing | XFF trusted only with explicit flag and loopback peer; last entry; IPv6 /64 key |
| Memory exhaustion of throttle map | DoS | Hard `maxKeys`, expiry sweep, eviction |
| Slow/idle unauthenticated sockets | DoS | 5 s hello timer, heartbeat reaping |
| Residual data after logout | Information disclosure | Logout list incl. module maps and storage prefix sweep |

## File Map and Wave/Collision Planning

Hot spots: `server/src/index.ts` and `server/src/http/apiRouter.ts` (STATE.md says Phase 8 plans must follow 06-06, which is merged), `src/store/agentStore.ts` (821 lines, additive export only), `src/services/transport/Transport.ts`. Put **at most one plan on each hot file**.

| Work area | Files (M = modify, N = new) | Depends on |
|-----------|-----------------------------|------------|
| WA1 Server auth core (pure) | M `server/src/config.ts`; N `server/src/gateway/{auth,authThrottle,handshake}.ts`; N tests in `server/src/gateway/__tests__/`; M `server/__tests__/hardening.test.ts` (bind-policy cases) | - |
| WA2 Server wiring | M `server/src/index.ts`; M `server/src/http/apiRouter.ts`; N `server/__tests__/{auth,authScrub}.test.ts`; M `server/__tests__/lifecycle.test.ts:359`; (optional) M `packages/protocol/fixtures/{client,invalid}.json` for new hello fixtures | WA1 |
| WA3 FE token + transport | N `src/services/auth/tokenStore.ts`; M `src/services/transport/Transport.ts`; M `src/services/adapters/WsAdapter.ts`; M `src/services/backend.ts`; M `src/services/agentSocket.ts`; M `src/store/connectionStore.ts` + `src/services/adapters/types.ts` (INITIAL_SNAPSHOT) + `MockAdapter.ts` if snapshot shape changes; N `src/services/redact.ts`; tests (Transport, WsAdapter, backend, tokenStore, connectionStore) | - (parallel with WA1) |
| WA4 FE UI + logout | N `src/components/layout/TokenDialog.tsx`; M `Header.tsx`, `ConnectionBanner.tsx`, `ConnectionStatusChip.tsx` (label only if wording changes), `App.tsx`, `CommandPalette.tsx` (memo deps), `src/store/uiStore.ts`, `src/keyboard/commands.ts`; M `src/store/agentStore.ts` (add `resetAgentStore` + reset module maps); N `src/services/session/logout.ts`; M `docs/KEYBOARD.md`; tests | WA3 |
| WA5 Docs | M `docs/{RUNNING,ARCHITECTURE,RATIONALE_AND_DESIGN_DECISIONS}.md` (new ADR for token-in-hello, trust-proxy, open-vs-ack), `server/README.md`, contract spec sections 2.5/7/11/12 and the "refused until Phase 8" sentences, nginx example, Phase 21 hand-off note (diagnostics must call the redactor), Phase 13 hand-off (storage key prefix `agent-manager.`) | WA2, WA4 |

Suggested waves: **W-a:** WA1 + WA3 (disjoint: server vs `src`; two plans, within `max_concurrent_agents: 3`). **W-b:** WA2 + WA4 (disjoint again; WA2 owns both server hot files, WA4 owns the FE hot-ish files and `agentStore.ts`). **W-c:** WA5 plus an end-to-end manual QA checklist (real gateway with token + browser: correct token, wrong token, throttle, logout, wss refusal). If the planner wants smaller plans, split WA2 into "WS gate" and "HTTP Bearer" but they must be sequential (both edit `index.ts` via the deps wiring). Root `package.json` is untouched (no dependency), and `packages/protocol/src/**` and the snapshot are untouched unless the optional fixtures are added. Phase 10/11 will also touch `agentStore.ts`/`index.ts`; keep the `agentStore.ts` edit to one exported function.

## Project Constraints (from CLAUDE.md)

No `./CLAUDE.md` exists in the repo (`claude_md_path` points at `./.claude/CLAUDE.md`, which contains only `checkpoints` and `worktrees`). Applicable user-global directives: planning/research subagents must use `sonnet` or `haiku` (not opus) unless the user asks. Repo conventions observed from code and CONTEXT: contract changes are additive and update the surface snapshot; destructive operations need `confirm: true` and auth is orthogonal (must not weaken it); all overlays go through `OverlayPortal` with the `Z_LAYERS` scale; dialogs use `useModalFocus`; Bearer check belongs beside the Host guard.

## Sources

### Primary (HIGH confidence - read in this session)
- `.planning/phases/08-auth-and-secure-transport/08-CONTEXT.md`; `.planning/ROADMAP.md` (Phase 8, Phase 21, wave table); `.planning/REQUIREMENTS.md` (INT-02); `.planning/STATE.md`; `.planning/config.json`
- `server/src/{config.ts,index.ts}`, `server/src/http/{apiRouter.ts,envelope.ts}`, `server/src/gateway/{dispatch.ts,wsFrames.ts}`, `server/src/services/SessionManager.ts`, `server/src/protocol/wsProtocol.ts`
- `packages/protocol/src/{messages.ts,validate.ts,capabilities.ts,surface.ts,limits.ts,errors.ts,http.ts}`, `contract.snapshot.json`, `fixtures/{client,server,invalid}.json`
- `src/services/{transport/Transport.ts,agentSocket.ts,agentRequests.ts,backend.ts,adapters/WsAdapter.ts,adapters/types.ts}`, `src/store/{agentStore.ts,connectionStore.ts,logBufferStore.ts,uiStore.ts}`, `src/components/layout/{ConnectionStatusChip,ConnectionBanner,Header,CommandPalette,OverlayPortal,NotificationToastManager}.tsx`, `src/keyboard/commands.ts`, `src/hooks/useModalFocus.ts`, `src/styles/zLayers.ts`, `src/setupTests.ts`
- `docs/superpowers/specs/2026-11-07-fe-be-contract.md` (sections 2.2, 2.5, 2.6, 7, 11, 12)
- Existing tests: `server/__tests__/{lifecycle,hardening,httpApi}.test.ts`, `src/services/__tests__/backend.test.ts`, `src/services/transport/__tests__/{Transport,contractConstants}.test.ts`, `src/keyboard/__tests__/commands.test.ts`
- A local `node` run confirming V8 `JSON.parse` error text quotes an input prefix

### Secondary / Tertiary
- None. Node `crypto.timingSafeEqual` semantics (equal-length requirement) are standard Node behavior cited from training knowledge: tagged [ASSUMED] for the API detail, low risk because the design hashes both sides.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new deps; everything in repo/Node.
- Architecture: HIGH - gate/registration order and router order read directly from source.
- Pitfalls: HIGH for items verified in code (addClient order, JSON.parse snippet, Host guard, requests.dispose, connection reset); MEDIUM for nginx details and `ws` error contents.

**Research date:** 2026-11-12
**Valid until:** 2026-12-12 (stable internal code; revalidate if Phases 10/11 land first and touch `index.ts`/`agentStore.ts`)
