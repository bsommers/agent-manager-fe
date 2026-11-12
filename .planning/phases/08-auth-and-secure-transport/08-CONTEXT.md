# Phase 8: Auth and Secure Transport - Context

**Gathered:** 2026-11-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Remote access works only with a token over TLS; local use stays zero-config. Delivers INT-02: token auth on WS and `/api`, `auth_failed` handling without a reconnect storm, ws/wss and bind policy, logout, and `hello`/`hello_ack` carrying contract version, auth and `epoch`. TLS termination itself is out of scope (reverse proxy).

</domain>

<decisions>
## Implementation Decisions

### Token storage and logout (FE)
- **D-01:** Token lives in memory plus `sessionStorage` (survives reload in the tab, gone when the tab closes). Never localStorage, never a URL.
- **D-02:** Entry is a password-masked dialog opened on `auth_failed` / auth required. No always-on settings field, no build-time `VITE_` token.
- **D-03:** Logout clears everything: close sockets, empty agent/roster/log stores, remove token and workspace data from storage, return to the token dialog.
- **D-04:** Logout is reachable from a header menu item and a command-palette command (keyboard-first, Phase 5); shown only when a token is set.

### Failure and lockout
- **D-05:** On close 4401 the transport goes to `auth_failed` and stops; no retries until the user submits a new token (no reconnect storm).
- **D-06:** Gateway compares tokens in constant time and applies per-IP backoff/rejection after N failures in a window (in-memory, bounded map).
- **D-07:** A socket that sends no valid `hello` within ~5 s is closed 4401; no message other than `hello` is processed before auth.
- **D-08:** `/api` auth is `Authorization: Bearer <token>` only, never in the URL.

### TLS and bind policy
- **D-09:** TLS is terminated by a reverse proxy (user's nginx); the gateway stays plain HTTP/WS. Docs include an nginx example. In-gateway TLS is not built.
- **D-10:** Gateway may bind a non-loopback `HOST` only when `AGENT_MANAGER_TOKEN` is set (with a minimum length, e.g. 24+ chars); otherwise refuse to start with a clear message (extends the existing refusal in `server/src/config.ts`).
- **D-11:** FE allows `ws://` only for loopback (localhost, 127.0.0.0/8, ::1); any other host must be `wss://`, otherwise a visible error and no fallback.
- **D-12:** Auth is enforced whenever `AGENT_MANAGER_TOKEN` is set, including on loopback. Unset means zero-config local with no auth.

### Claude's Discretion
- Token delivery was not discussed. Defaults: token sent in the `hello` message body (never URL or subprotocol logs); `hello_ack` returns contract version, auth result and `epoch`.
- Exact failure threshold, backoff window, minimum token length and dialog wording.
- Token and its hash must never reach logs or the diagnostics export (test-asserted per roadmap criterion 3).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` (Phase 8) - goal and 4 success criteria
- `.planning/REQUIREMENTS.md` (INT-02) - requirement text

### Existing code
- `server/src/config.ts` - current non-loopback HOST refusal
- `server/src/index.ts` - WS handling and hello (Phase 8 plans must follow 06-06)
- `server/src/http/apiRouter.ts` - Host guard on `/api`
- `packages/protocol/src/messages.ts` - `hello` / `hello_ack` shapes (epoch)
- `src/services/transport/Transport.ts` - `CLOSE_AUTH_FAILED = 4401` handling
- `src/components/layout/ConnectionStatusChip.tsx`, `ConnectionBanner.tsx` - auth_failed UI
- `docs/ARCHITECTURE.md`, `docs/RATIONALE_AND_DESIGN_DECISIONS.md` - to update

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Transport already maps close 4401 to an `auth_failed` state.
- Protocol package validators/fixtures and `contract:check` guard any `hello`/`hello_ack` change.
- Operations catalog drives `/api`; Bearer check belongs in the router middleware beside the Host guard.

### Established Patterns
- Destructive ops need `confirm: true`; auth is orthogonal and must not weaken that.
- Contract changes are additive and update the surface snapshot.

### Integration Points
- `server/src/index.ts` hello handling, `apiRouter.ts` middleware, `config.ts` startup validation, FE transport and a new token dialog, header menu and command palette.

</code_context>

<specifics>
## Specific Ideas

No specific requirements; open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- In-gateway TLS termination (cert/key paths): revisit if a reverse proxy is ever not available.
- Origin check on `/api` and an explicit `ALLOW_REMOTE` opt-in flag were offered and not chosen.

</deferred>

---

*Phase: 8-Auth and Secure Transport*
*Context gathered: 2026-11-11*
