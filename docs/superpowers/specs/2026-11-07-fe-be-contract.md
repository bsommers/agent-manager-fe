# FE <-> BE Contract (reconciled)

**Date:** 2026-11-07
**Status:** Proposed, normative for v2.0 and v2.1 phases
**Reconciles:** `docs/superpowers/plans/2026-11-07-backend-integration-plan.md` (BE plan) and `docs/superpowers/plans/2026-11-07-ui-and-integration-milestones.md` (UI plan). Where they disagree, section 15 records the decision.
**Source of truth for code:** the shared package `packages/protocol` (`@agent-manager/protocol`), created in Phase 2. This document is the human-readable form; the package types, validators and golden fixtures are the executable form. If they diverge, the package wins and this document is corrected.

Keywords MUST, SHOULD, MAY are used in the RFC 2119 sense.

---

## 1. Decisions at a glance

| Topic | Decision |
|---|---|
| Canonical port | **8088**. Matches `server/src/config.ts`, `agentSocket.ts`, `docs/RUNNING.md` and ADR-006 (8080 is routinely occupied on dev machines). The 8080 in the August backend design/plan is superseded. |
| Canonical host (bind) | `127.0.0.1` by default. Non-loopback bind is refused until token auth ships (Phase 8). |
| Endpoints | One origin, one port: WS `/ws`, HTTP `/api/*`, legacy `GET /health`. |
| FE configuration | `VITE_BACKEND_URL` (origin, default `http://localhost:8088`). `VITE_WS_URL` stays as a deprecated alias (full `ws://` URL) used only when `VITE_BACKEND_URL` is unset. `VITE_DEMO_MODE=1` selects explicit Demo mode. |
| Server configuration | `PORT` (8088), `HOST` (127.0.0.1), `ALLOWED_ORIGINS`, `AGENT_MANAGER_TOKEN` (Phase 8). |
| Auth | First WS message `hello` carries the token; HTTP uses `Authorization: Bearer`. Tokens never appear in URLs. |
| Versioning | Integer `contract` major (currently 1) in `hello`/`hello_ack`. Additive changes are announced through capability flags, not minor numbers. |
| Shared schema | `packages/protocol`. Neither side imports from the other's source tree. |
| Non-interactive backends | cvm and climah agents omit the `input` and `resize` agent capabilities; the FE renders their panes read-only. |
| Back-compat | Every addition is optional. A FE that sends nothing new keeps working against a new gateway, and a new FE degrades against a legacy gateway (section 12). |

---

## 2. Transport and connection lifecycle

### 2.1 Endpoints

| Surface | URL | Notes |
|---|---|---|
| WebSocket | `ws://localhost:8088/ws` | JSON text frames only. Max frame 1 MiB. |
| HTTP API | `http://localhost:8088/api/...` | `Content-Type: application/json` required on bodies. |
| Legacy health | `GET /health` | Unchanged `{status, agents, timestamp}`. Kept for the whole of contract 1. |

Remote use MUST be `wss://`/`https://` (typically a reverse proxy in front of the loopback-bound gateway). The FE refuses plain `ws://` to a non-loopback host (Phase 8).

### 2.2 Connection states (FE)

`ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'auth_failed'`

| State | Meaning |
|---|---|
| `connecting` | First attempt in flight. |
| `open` | Socket open (and, for contract 1 gateways, `hello_ack` received). |
| `reconnecting` | Socket lost; backoff timer or attempt in flight. |
| `closed` | Deliberate disconnect or retry budget exhausted. |
| `auth_failed` | Gateway closed with 4401 or answered `UNAUTHENTICATED`. No automatic retry until the token changes. |

The FE connection store additionally records `mode: 'live' | 'demo'`. Demo mode is explicit (`VITE_DEMO_MODE=1` or `?demo=1`); no failure path may enter it. In Demo mode output is simulated and the UI MUST say so.

### 2.3 Reconnect policy (client)

Exponential backoff with full jitter: `delay = random(0, min(15000, 500 * 2^attempt))` ms. `attempt` resets once a connection has been open and delivered one inbound frame. `maxRetries` defaults to unlimited for live mode; exceeding a configured limit yields `closed`.

### 2.4 Heartbeat

Application-level because browsers cannot observe WS ping frames:

- Client sends `{"type":"ping","t":<ms>}` every 15 s when no inbound frame arrived in that interval.
- Gateway answers `{"type":"pong","t":<same>}`.
- If no inbound frame (of any kind) arrives within 10 s after a ping, the client closes the socket and reconnects.
- The gateway additionally sends protocol-level ping frames every 30 s and terminates sockets that miss a pong.

### 2.5 Handshake

```
client                                   gateway
  | -- WS upgrade (Origin checked) ------> |
  | <-- (no token configured) agent:init_list   [legacy-compatible snapshot]
  | -- hello {contract, token?, epoch?, resumeFrom?} -> |
  | <-- hello_ack {contract, epoch, auth, limits, backends} |
  | <-- agent:init_list                    |
  | <-- agent:output {replay:true}* / agent:gap* (per resumeFrom) |
```

- A gateway with `AGENT_MANAGER_TOKEN` set sends nothing until a valid `hello` arrives. First message not a valid `hello`, or no `hello` within 5 s: close **4401**. Token comparison MUST be constant-time.
- A gateway without a token sends `agent:init_list` immediately (legacy behavior) and again after `hello_ack`. The FE treats `agent:init_list` as an idempotent full snapshot.
- If a FE has a token configured and receives no `hello_ack` within 3 s, it MUST NOT proceed (state `auth_failed`, message "gateway did not acknowledge authentication").
- If a FE has no token configured and receives no `hello_ack` within 3 s, it proceeds as a contract-0 (legacy) gateway with default capabilities (section 9.3).

### 2.6 WebSocket close codes

| Code | Meaning | FE reaction |
|---|---|---|
| 1009 | Frame too large | Report `PAYLOAD_TOO_LARGE`; reconnect. |
| 4401 | Unauthenticated / hello timeout | `auth_failed`, no auto-retry. |
| 4429 | Rate limited | Back off at least the advertised `retryAfterMs`. |
| other / abnormal | Network loss | `reconnecting`. |

---

## 3. Domain types

```ts
type AgentStatus = 'idle' | 'running' | 'thinking' | 'error' | 'disconnected';
type AgentMode   = 'tmux' | 'ssh';            // driver id; 'cvm' | 'climah' are added by Phases 24-25 (consumers MUST tolerate unknown strings)
type AgentKind   = 'terminal' | 'sandbox' | 'pipeline';   // what the UI shows; default 'terminal'

interface Agent {
  id: string; name: string; mode: AgentMode; targetHost: string;
  status: AgentStatus; unreadOutput: boolean; layout: AgentLayout;
  createdAt: number; lastActivity: number;
  // additive, all optional
  kind?: AgentKind;                    // default 'terminal'
  backend?: string;                    // adapter instance id, default 'local'
  capabilities?: AgentCapability[];    // default: section 9.3
  tags?: string[]; group?: string;
  meta?: Record<string, unknown>;      // native detail; schema per scope in section 6.4
}
```

`mode` says how the agent is reached (driver); `kind` says what the UI shows. Adapters MUST map native state to the five `AgentStatus` values and put native detail in `meta`.

Identifiers: `agentId` and `reqId` are opaque strings of at most 128 characters. `reqId` SHOULD be a UUID.

---

## 4. WebSocket messages

"Phase" is the phase that implements the behavior on the gateway and/or FE. The schema for every row ships in Phase 2.

### 4.1 Client -> gateway

| `type` | Fields | Phase |
|---|---|---|
| `ping` | `t: number` | FE 3, GW 4 |
| `hello` | `contract: 1`, `token?`, `epoch?`, `resumeFrom?: Record<agentId, seq>`, `client?: {name, version}` | 8 (resume: 11) |
| `agent:create` | existing `name, mode, targetHost, initialCmd?` + `backend?`, `params?: Record<string, string\|number\|boolean>`, `reqId?` | 6 |
| `agent:kill` | `agentId`, `reqId?` | 6 |
| `agent:update` | `agentId`, `name?`, `tags?`, `group?`, `reqId?` | 6 |
| `agent:input` | `agentId`, `data` | exists |
| `agent:resize` | `agentId`, `cols`, `rows` | exists |
| `agent:broadcast` | `targetAgentIds`, `data`, `reqId?` | exists; ack 12 |
| `agent:history` | `agentId`, exactly one of `beforeSeq`/`afterSeq`, `limit?`, `reqId?` | 11 |
| `agent:approve` | `agentId`, `gateId`, `decision: 'approve'\|'deny'`, `reqId?` | 25 |

### 4.2 Gateway -> client

| `type` | Fields | Phase |
|---|---|---|
| `pong` | `t` | 4 |
| `hello_ack` | `contract: 1`, `epoch`, `server: {name, version}`, `auth: {required}`, `limits: {maxFrameBytes, maxInputBytes, maxBroadcastTargets}`, `backends: BackendInfo[]` | 8 (backends/caps: 19) |
| `agent:init_list` | `agents: Agent[]` (full, idempotent snapshot) | exists |
| `agent:added` | `agent` | 6 |
| `agent:removed` | `agentId`, `reason?: 'killed'\|'exited'\|'gone'\|'backend_down'` | 6 |
| `agent:updated` | `agentId`, `patch: Partial<Pick<Agent,'name'\|'tags'\|'group'\|'meta'\|'capabilities'>>` | 6 |
| `agent:status_change` | `agentId`, `status`, `reason?`, `exitCode?` | exists (extras: 6) |
| `agent:output` | `agentId`, `data`, `seq?`, `replay?` | exists (seq: 11) |
| `agent:gap` | `agentId`, `fromSeq`, `toSeq` | 11 |
| `agent:history_chunk` | `agentId`, `chunks: {seq, ts, data}[]`, `hasMore`, `reqId?` | 11 |
| `agent:ack` | `reqId`, `op: 'create'\|'kill'\|'update'\|'broadcast'`, `ok: true`, `agent?`, `results?: BroadcastResult[]` | 6, 12 |
| `agent:error` | `reqId?`, `agentId?`, `code: ErrorCode`, `message`, `retryable`, `detail?` | 6 |
| `agent:meta` | `agentId`, `scope: MetaScope`, `data` (section 6.4) | 19 |
| `agent:gate` | `agentId`, `gateId`, `prompt`, `expiresAt?` | 25 |

Rules:

- Unknown `type` values and unknown fields MUST be ignored without error by both sides (logged at debug level). A validator returns a copy containing only known fields.
- A request without `reqId` behaves exactly as today: no `agent:ack` is sent, failures produce an `agent:error` without `reqId`.
- Validator-level rules (the package enforces these; the tables above do not spell them out):
  - `hello.contract` and `hello_ack.contract` are any positive integer (a different-major gateway must still be reportable). `hello.token` is at most 512 characters without control characters and is never echoed in failure details. `hello.resumeFrom` has at most 1000 entries, keys of 1..128 characters, integer values of at least 0, and rejects the keys `__proto__`, `constructor`, `prototype`.
  - `hello_ack.backends` has at most 16 entries; capability strings outside the section 9.1 list are dropped from the validated copy (not fatal) and duplicates removed.
  - `agent:update` requires at least one of `name`, `tags`, `group`; `tags` has at most 32 entries of 1..64 characters, `group` is 1..64 characters, `name` follows the `agent:create` rules.
  - `agent:history` requires exactly one of `beforeSeq`/`afterSeq` (integers of at least 0); `limit` is 1..1000.
  - `agent:create.backend` is a lowercase token of at most 64 characters; `params` has at most 32 entries, keys of at most 64 characters, values that are strings of at most 1024 characters, finite numbers or booleans. Consumers still validate `params` against the backend `AgentSpec`.
  - `reqId` is 1..128 characters wherever it appears.
- Responses go only to the requesting connection (`agent:ack`, `agent:history_chunk`); state changes (`agent:added`, `agent:removed`, `agent:updated`, `agent:status_change`, `agent:output`) go to every connection.

---

## 5. Sequencing, replay and history

- The gateway assigns `seq` to every `agent:output` chunk: integer, starting at 1, strictly increasing per agent. `seq` is optional on the wire so legacy gateways remain valid; a FE treats frames without `seq` as unsequenced (no dedupe, no replay).
- `hello_ack.epoch` identifies the generation of the gateway log store. A FE stores `{epoch, lastSeq per agent}`. After reconnect it sends them in `hello.epoch`/`hello.resumeFrom`. If the epoch differs, the gateway ignores `resumeFrom`; the FE clears local sequence state and treats the roster as fresh.
- Resume: for each `agentId -> lastSeq` the gateway replays chunks with `seq > lastSeq` as `agent:output` with `replay: true`. If the oldest retained chunk is newer than `lastSeq + 1` it first sends `agent:gap {fromSeq: lastSeq + 1, toSeq: oldest - 1}`; the FE renders a visible gap marker.
- Client dedupe: drop any frame with `seq <= lastSeq`. A hole (`seq > lastSeq + 1`) with no preceding `agent:gap` triggers `agent:history {afterSeq: lastSeq}`.
- History (pull): `agent:history` returns `agent:history_chunk` with raw chunks (ANSI preserved) for terminal replay. `beforeSeq` pages backwards (scrollback), `afterSeq` pages forwards (gap fill). Default `limit` 200 chunks, max 1000.
- The gateway MUST decode PTY bytes with a streaming UTF-8 decoder so a multi-byte character is never split across frames. It MAY coalesce chunks arriving within 8 ms or up to 16 KiB into one frame.
- Backpressure: if a connection's send buffer exceeds 4 MiB the gateway drops the oldest unsent output for that connection and emits `agent:gap`. There is no pause/resume message; client-side pause (Phase 14) buffers locally.
- Retention: per-agent ring (default 8 MiB, configurable). Persistence is optional; without it `epoch` changes on every gateway restart.

---

## 6. Requests, errors, broadcast, meta

### 6.1 Correlation and idempotency

`reqId` correlates a request with its `agent:ack`/`agent:error`/`agent:history_chunk` and doubles as the idempotency key. The gateway keeps the last 1024 reqIds (5 minutes). A repeated `reqId` returns the original ack and performs no side effect, so a FE may retry safely after a reconnect. FE default request timeout: 10 s; a timeout rejects locally with code `TIMEOUT`.

### 6.2 Errors

```ts
type ErrorCode =
  | 'USAGE' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'UNSUPPORTED' | 'RATE_LIMITED' | 'PAYLOAD_TOO_LARGE'
  | 'BACKEND_DOWN' | 'TIMEOUT' | 'INTERNAL';
```

The first seven BE-plan codes are kept (aligned with the `mads.contract/1` vocabulary); `UNAUTHENTICATED`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `TIMEOUT` are added so the UI plan's error taxonomy has wire codes.

| Code | HTTP | FE error class (UI plan taxonomy) |
|---|---|---|
| `USAGE` | 400 | protocol |
| `UNAUTHENTICATED` | 401 | auth |
| `FORBIDDEN` | 403 | auth |
| `NOT_FOUND` | 404 | backend |
| `CONFLICT` | 409 | backend |
| `PAYLOAD_TOO_LARGE` | 413 | protocol |
| `UNSUPPORTED` | 422 | protocol |
| `RATE_LIMITED` | 429 | backend |
| `INTERNAL` | 500 | backend |
| `BACKEND_DOWN` | 503 | backend |
| `TIMEOUT` | 504 | timeout |

"network" is a client-only class (no wire code): socket errors and fetch failures. HTTP error body: `{ "ok": false, "error": { "code", "message", "retryable", "detail"? } }`.

### 6.3 Broadcast and input

- `agent:broadcast.data` is raw keystrokes for terminal agents. Limits: `data` at most 65536 UTF-8 bytes, `targetAgentIds` at most 64 entries. `agent:input.data` has the same 65536-byte cap.
- With a `reqId` the gateway answers `agent:ack {op: 'broadcast', results}` with one entry per target in request order: `{agentId, status: 'sent'|'failed'|'offline'|'unsupported', code?, message?}`.
- Targets lacking the `broadcast` (or `input`) agent capability are `unsupported`, never silently skipped. Retrying the same `reqId` does not re-deliver.
- The destructive-command confirmation is a FE safety UX, not a security boundary; the gateway does not rely on it.

### 6.4 Meta scopes (`agent:meta`)

| Scope | `data` |
|---|---|
| `cost` | `{spent: number, cap?: number, currency?: string, tokens?: {in: number, out: number}}` |
| `quota` | `{used: number, limit: number, window?: string, resetAt?: number}` |
| `task` | `{id: string, title?: string, state: 'queued'\|'running'\|'done'\|'failed', exitCode?: number}` |
| `pipeline` | `{stage: string, wave?: string, state?: 'running'\|'passed'\|'failed'\|'waiting_gate'}` |
| `sandbox` | `{state: 'creating'\|'running'\|'stopped'\|'snapshotting'\|'deleting'\|'error', detail?: string}` |

The BE plan's `agent:progress` is folded into `agent:meta` (`pipeline`/`cost` scopes). Approvals stay separate (`agent:gate`/`agent:approve`) because they need an answer. Payloads are validated at the FE boundary; unknown scopes are logged and dropped.

---

## 7. HTTP API

All routes except `GET /health` and the minimal form of `GET /api/health` require `Authorization: Bearer <token>` when a token is configured. Success bodies carry `"ok": true`.

| Route | Request | Response | Phase |
|---|---|---|---|
| `GET /health` | - | legacy `{status, agents, timestamp}` | exists |
| `GET /api/health` | - | `{ok, contract, epoch, backends: [{id, up}], agents?}`; `agents` is an integer count (at least 0), like legacy `/health`, and is omitted when unauthenticated and auth required | 6 |
| `GET /api/agents` | - | `{ok, agents: Agent[]}` | 6 |
| `POST /api/agents` | same fields as `agent:create`; `Idempotency-Key` header = `reqId` | 201 `{ok, agent}` | 6 |
| `DELETE /api/agents/:id` | - | `{ok}` | 6 |
| `GET /api/agents/:id/logs` | `beforeSeq?`, `afterSeq?`, `limit?` (default 500, max 2000) | `{ok, lines: LogLine[], hasMore}` | 11 |
| `GET /api/search` | `q`, `regex?`, `caseSensitive?`, `wholeWord?`, `agentId?` (repeatable), `from?`, `to?`, `context?` (0-5), `limit?` (default 100, max 1000), `cursor?` | `{ok, results: SearchHit[], nextCursor?, truncated?}` | 16 |

```ts
interface LogLine  { agentId: string; seq: number; line: number; ts: number; text: string }
interface SearchHit extends LogLine { matchIndex: number; matchLength: number; before?: string[]; after?: string[] }
```

- `line` is the zero-based line index within the chunk with that `seq`. The cross-source dedupe key for merging server hits with local ring-buffer hits is `(agentId, seq, line)`.
- The gateway stores chunks (for terminal replay) and derives the line view (logs, search) from them. ANSI is preserved in `/logs`; search matches the ANSI-stripped text.
- Search is HTTP only so it is cancellable (`AbortController`), cursor-paginated and authenticated by header. Regex safety: query at most 256 characters, a 2 s execution budget (then `truncated: true`), invalid pattern returns `USAGE`.
- `POST`/`DELETE` require `Content-Type: application/json` where a body exists, and an `Origin` that passes the allowlist when the header is present. Cookies are never used for auth.

---

## 8. Limits (defaults, exported as constants by the package)

| Constant | Value |
|---|---|
| `CONTRACT_VERSION` | 1 |
| `MAX_FRAME_BYTES` | 1048576 |
| `MAX_INPUT_BYTES` | 65536 |
| `MAX_BROADCAST_TARGETS` | 64 |
| `MAX_ID_LENGTH` | 128 |
| `MAX_NAME_LENGTH` | 128 |
| `MAX_TARGET_HOST_LENGTH` | 255 |
| `MAX_INITIAL_CMD_LENGTH` | 4096 |
| `MAX_SEARCH_QUERY_LENGTH` | 256 |
| `RECONNECT` | `{baseMs: 500, factor: 2, capMs: 15000}` |
| `HEARTBEAT` | `{intervalMs: 15000, timeoutMs: 10000}` |

---

## 9. Capabilities

### 9.1 Gateway capabilities

Listed per backend in `hello_ack.backends[].capabilities`:

`GatewayCapability = 'terminal' | 'broadcast' | 'search' | 'history' | 'tasks' | 'cost' | 'quota' | 'sandbox' | 'pipeline' | 'gates' | 'route'`

`BackendInfo = {id: string, label: string, up: boolean, capabilities: GatewayCapability[], agentSpecs?: AgentSpec[]}` where `AgentSpec = {mode: string, kind: AgentKind, title: string, fields: {name, label, type: 'string'|'number'|'boolean'|'enum', required?, options?}[]}` drives the Add-Agent wizard (Phase 22). Authentication is reported by `hello_ack.auth.required`, not as a capability.

### 9.2 Agent capabilities

`AgentCapability = 'input' | 'resize' | 'kill' | 'history' | 'broadcast' | 'approve' | 'snapshot'`

The UI hides or disables a control whose capability is absent. The gateway rejects an unsupported operation with `agent:error UNSUPPORTED`.

### 9.3 Defaults and per-backend values

When `Agent.capabilities` is absent (legacy gateway or tmux/ssh), the FE assumes `['input','resize','kill','history','broadcast']`.

| Backend | `mode` | Agent capabilities | Interactive |
|---|---|---|---|
| tmux, ssh (in-repo gateway) | `tmux`, `ssh` | input, resize, kill, history, broadcast | yes |
| cvm (cvmd REST + SSE) | `cvm` | kill, history, snapshot, broadcast (task fan-out, adapter-defined) | **no**: no stdin, no PTY, no resize |
| climah (events.jsonl) | `climah` | kill (signal the process), history, approve | **no**: headless agents |
| mads | not an agent backend | roster/state persistence only; nothing advertised to the FE | n/a |
| mad | not an agent backend | optional `route` gateway capability (suggestion in the create dialog) | n/a |

A pane for an agent without `input` is read-only and labelled as such. Output from cvm/climah is text, normalized to `\r\n`; adapters mark `meta.format`.

---

## 10. Adapter mapping (gateway side)

| FE concept | tmux/ssh | cvm | climah |
|---|---|---|---|
| create | spawn PTY | `POST /vms/spinup` then `POST /tasks/run` with `initialCmd` as the task | `climah run` subprocess (argv array) |
| output | PTY bytes | SSE `log` events, `\r\n` normalized | `agent_chunk_received` payload |
| status | PTY alive / idle heuristic | VM state + task running/done(exit code) | `agent_invoked` -> running; `run_completed` -> idle; `run_failed`, `budget_hard_stop` -> error; `gate_awaiting_approval` -> thinking + `agent:gate` |
| input / resize | yes | `UNSUPPORTED` | `UNSUPPORTED` |
| kill | close PTY | `DELETE /tasks/:id` or `/vms/:n` | signal process |

Gateway rules: credentials for backends (cvmd token) stay server-side and never reach the browser; subprocesses use argv arrays only (never a shell string); backend failure is isolated per adapter (`BACKEND_DOWN`, agents `disconnected`, retry with backoff); external repositories (cvm, climah, mads, mad) are treated as read-only inputs: adapters are developed against recorded fixtures committed in this repo, never by modifying or pulling those checkouts.

---

## 11. Security requirements

1. Bind `127.0.0.1` by default. Binding a non-loopback `HOST` is refused unless token auth is active (Phase 8); until then it is refused unconditionally (Phase 4).
2. WS upgrade checks `Origin` against `ALLOWED_ORIGINS` (default `http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173`). A missing `Origin` (non-browser client) is allowed; a present but unlisted one gets HTTP 403.
3. Frame cap 1 MiB; input cap 64 KiB; broadcast target cap 64; per-connection rate limit returns `RATE_LIMITED`.
4. Tokens: never in a URL, a log line, an error message or diagnostics export. FE keeps the token in memory by default; persisting it is an explicit opt-in. Logout clears roster, log buffers and token.
5. Malformed frames never crash either side: they are dropped, counted and (gateway) answered with `agent:error USAGE` when a `reqId` is present.
6. Logs are redacted per adapter before persistence where the backend provides a redaction rule; persistence has a per-agent size cap and rotation.
7. Terminal links are opened with `rel="noopener noreferrer"`; the app ships a CSP (Phase 21).

---

## 12. Versioning and compatibility

| Pair | Behavior |
|---|---|
| New FE, legacy gateway | No `hello_ack` within 3 s and no token configured: proceed as contract 0 with default capabilities; no `seq`, no `reqId` acks (requests time out locally only when the FE awaited an ack, so the FE sends `reqId` only after seeing `hello_ack`). |
| Legacy FE, new gateway | Never sends `hello`; receives the legacy message set; extra gateway messages are ignored by the legacy parser. Not possible when a token is configured (4401). |
| Same major | Interoperates. Unknown messages/fields are ignored. |
| Different major | `hello_ack.contract` differs: FE shows "gateway speaks contract N, this UI speaks M" and stays `closed`. |

Breaking = removing or renaming a message type, a field, an error code or a capability; making an optional field required; narrowing a type. A breaking change bumps `CONTRACT_VERSION`. `npm run contract:check` (Phase 2) diffs the package's surface snapshot against a base ref and fails on breaking changes.

---

## 13. Shared schema location and workflow

```
packages/protocol/            @agent-manager/protocol
  src/                        types, validators, limits, surface (TypeScript)
  fixtures/{client,server,invalid}.json   golden messages (language-neutral)
  contract.snapshot.json      surface snapshot for the breaking-change check
```

- FE resolves the package by a Vite alias and TypeScript `paths` entry pointing at `packages/protocol/src/index.ts`; no build step in FE dev/test.
- Gateway depends on it through `"@agent-manager/protocol": "file:../packages/protocol"` and consumes the built `dist/` (`npm run build:protocol`, run automatically by the server `prebuild`/`predev`/`prestart` scripts). Gateway tests alias the source for speed.
- `server/src/protocol/wsProtocol.ts` and `src/services/wsProtocol.ts` remain as one-line re-exports so existing import paths do not change.
- Adapters in other languages consume `fixtures/*.json`.
- No registry dependency is added for validation: validators are hand-written and table-driven.

---

## 14. Implementation map

| Phase | Contract elements delivered |
|---|---|
| 2 | The whole schema: types, validators, limits, fixtures, surface snapshot, `contract:check`. |
| 3 | FE transport: ConnState, backoff, heartbeat `ping`, explicit Demo mode, `VITE_BACKEND_URL`. |
| 4 | Gateway: loopback bind, Origin allowlist, frame cap, `pong`, liveness. |
| 6 | `reqId`/`agent:ack`/`agent:error`, `agent:added/removed/updated`, `/api/health`, `/api/agents` (+POST/DELETE), validators wired at the gateway dispatch point. |
| 8 | `hello`/`hello_ack`, token auth, `auth_failed`, `wss` enforcement, non-loopback bind with token. |
| 11 | `seq`, `epoch`, `resumeFrom`, `agent:gap`, `agent:history`, LogStore, `/api/agents/:id/logs`. |
| 12 | Broadcast ack/results, idempotency, limits, `RATE_LIMITED`. |
| 16 | `GET /api/search`. |
| 19 | `backends`/capabilities in `hello_ack`, `Agent.capabilities`, `agent:meta`. |
| 20 | Gateway `BackendAdapter` interface; tmux/ssh become adapters. |
| 24-26 | cvm, climah, mads/mad adapters; `agent:gate`/`agent:approve`. |

---

## 15. Reconciliation log

| # | BE plan | UI plan | Decision |
|---|---|---|---|
| 1 | Port: FE 8088 vs spec 8080 flagged | `VITE_BACKEND_URL` resolves the drift | **8088** (code + ADR-006). Single `VITE_BACKEND_URL`; `VITE_WS_URL` kept as deprecated alias. |
| 2 | Auth via `?token=` or subprotocol | "query-less: first message or subprotocol"; token never in URL | First-message `hello` only. Query strings and subprotocol rejected (leak into logs/history). |
| 3 | `AgentMode` extended with cvm/climah | `AgentSpec.kind` tmux/ssh/sandbox/pipeline | `mode` = driver id (unchanged, extended per adapter phase), new optional `kind` = UI category. |
| 4 | Capabilities per agent: input, resize, kill, history, approve, snapshot | Capabilities per backend: terminal, broadcast, search, tasks, cost, quota, sandbox, auth | Two levels: gateway capabilities (per backend, drive panels) and agent capabilities (per agent, drive controls). `auth` becomes `hello_ack.auth`. |
| 5 | `agent:history {beforeSeq}` (scrollback) | `resume {agentId, fromSeq}` (reconnect) | Both: `hello.resumeFrom` + `replay:true` push for reconnect; `agent:history` pull with `beforeSeq`/`afterSeq`. |
| 6 | `agent:progress`, `agent:gate` | `meta` events (cost, quota, task, pipeline, sandbox) | One `agent:meta` envelope with scopes; `agent:gate`/`agent:approve` kept for answerable prompts. |
| 7 | `hello {contract, token, resumeFrom}`, `hello_ack` | `hello {protocolVersion, capabilities, agentSpecs}` | Field name `contract`; capabilities/agentSpecs live in `hello_ack.backends`. |
| 8 | Search `GET /api/search` | `search {query, ...cursor}` unspecified transport | HTTP only; cursor pagination; cancellable. |
| 9 | Log hits `{seq, ts, text}` | Dedupe by (agent, seq) | Added `line` index; dedupe key `(agentId, seq, line)`. |
| 10 | Error codes (7) | Error taxonomy network/auth/protocol/backend/timeout | Wire codes extended to 11; taxonomy derived (section 6.2). |
| 11 | `/api/health` | legacy `/health` exists | Both; `/health` unchanged. |
| 12 | Sync wsProtocol "single source in server/, FE re-exports" | Move protocol to standalone package | Standalone `packages/protocol`; FE must not import from `server/src`. |
| 13 | Lifecycle only via WS | Lifecycle via WS or REST with `reqId` | Both surfaces, same semantics; `reqId` = idempotency key. |
| 14 | Gateway adapters in BE phases 2/4/5 | v2.1 lists only INT-7/INT-10/UI-9/UI-10 | v2.1 adds GW-02 (adapter refactor) and ADP-01..03 (cvm, climah, mads+mad). |
| 15 | - | INT-10 and INT-7 share a wave | INT-10 depends on INT-1..7, so it follows INT-7. |
| 16 | - | requirement keys `UI-01..10` | `UI-01` already exists (v1 windows); v2 UI keys are `UX-01..10`. |
