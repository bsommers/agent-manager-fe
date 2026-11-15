# Agent Manager Gateway (server)

Node/TypeScript gateway that discovers tmux sessions, opens SSH/PTY shells and streams
them to the browser UI over a single WebSocket (`/ws`) plus a `/health` HTTP route.

## Running

```bash
npm install
npm run dev            # tsx watch, loopback only
npm run build && npm start
npm test               # vitest
```

## Configuration

| Variable          | Default                                                                                   | Notes |
| ----------------- | ----------------------------------------------------------------------------------------- | ----- |
| `PORT`            | `8088`                                                                                    | HTTP + WebSocket port. |
| `HOST`            | `127.0.0.1`                                                                               | Loopback (`127.x.y.z`, `localhost`, `::1`) needs nothing. Any other value is accepted only when `AGENT_MANAGER_TOKEN` is set; otherwise startup is refused with a message naming `HOST` and `AGENT_MANAGER_TOKEN`. |
| `AGENT_MANAGER_TOKEN` | *(unset)*                                                                             | Shared secret. Unset or empty: no authentication (zero-config local use). Otherwise 24 to 512 printable ASCII characters, no spaces or control characters (a trailing newline counts), validated even on loopback, never trimmed. An invalid value aborts startup with the rule but never the value. |
| `AGENT_MANAGER_TRUST_PROXY` | `0`                                                                             | `1`/`true` or `0`/`false`. With a loopback proxy in front, key the auth throttle by the last `X-Forwarded-For` entry. Only with a proxy that overwrites that header. |
| `ALLOWED_ORIGINS` | `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:4173`, `http://127.0.0.1:4173` | Comma-separated list of exact `http(s)` origins (no path, no credentials, **no wildcard**). Invalid entries abort startup. |

Fixed limits: WebSocket frames larger than 1 MiB close the connection with code 1009.
Protocol pings are sent every 30 s; sockets that do not answer are terminated.

## Security model

- Loopback by default: the listener binds `127.0.0.1`. A non-loopback `HOST` is refused unless `AGENT_MANAGER_TOKEN` is set.
- Origin allowlist: a WebSocket upgrade whose `Origin` is not in `ALLOWED_ORIGINS` is rejected with HTTP 403
  (blocks cross-site WebSocket hijacking from pages in your browser). Clients that send no `Origin`
  (local non-browser tools) are accepted.
- Token authentication (below) when `AGENT_MANAGER_TOKEN` is set; no authentication when it is not (loopback only).
- TLS is the reverse proxy's job; the gateway speaks plain HTTP and WS. See [docs/RUNNING.md](../docs/RUNNING.md) for
  an nginx example. For ad hoc remote use, tunnel with SSH local port forwarding, e.g. `ssh -L 8088:127.0.0.1:8088 user@host`.

## Authentication

Enforced whenever `AGENT_MANAGER_TOKEN` is set, loopback included. Unset keeps the zero-config local mode.

- **Handshake order.** The first frame must be `{ "type": "hello", "contract": 1, "token": "<token>" }` within 5 s
  and at most 16 KiB. The gateway answers `hello_ack` (contract, epoch, `auth.required`, limits, backends) and then
  `agent:init_list`. An unauthenticated socket receives nothing and is not in the broadcast set; no frame other than
  the hello is processed before it. The token is never read from the URL, a subprotocol or a cookie. With no token
  configured the gateway sends `agent:init_list` once on connect and answers a `hello` with `hello_ack`.
- **Close codes.** `4401` (reason `unauthenticated`): wrong or missing token, malformed or oversize first frame, a
  first frame that is not a `hello`, or the 5 s deadline. `4429` (reason `retry-after-ms=N`): the source is throttled.
- **HTTP.** `Authorization: Bearer <token>` on every `/api` route except the minimal `GET /api/health`; failures are
  `401 UNAUTHENTICATED` with `WWW-Authenticate: Bearer`, throttled sources `429 RATE_LIMITED` with `Retry-After`.
  The Host and Origin guards run first. Three health forms: `GET /api/health` without a header is minimal (`ok`,
  `contract`, `epoch`, `backends`); with a valid Bearer it adds `agents`; a wrong Bearer is a counted `401`. The legacy
  `GET /health` drops `agents` when a token is set.
- **Throttle.** One bounded table shared by WebSocket and HTTP: 5 wrong tokens in 60 s lock the source for 60 s,
  doubling to a 15 min cap; at most 10 000 tracked sources; IPv6 sources are keyed by their /64. Only wrong tokens
  count (missing, malformed, oversize and timeouts do not). A locked source is refused even with the right token.
  Behind a proxy set `AGENT_MANAGER_TRUST_PROXY=1` (the key is then the last `X-Forwarded-For` entry when the peer
  is loopback); otherwise all proxied clients share one key and the startup log says so.
- **Comparison and logging.** Tokens are compared as SHA-256 digests with `timingSafeEqual`. The token, frames and
  headers are never logged; a JSON error is reported with a fixed message; close reasons and error bodies are fixed
  strings.
- **`confirm` is not authentication.** The destructive gate (`confirm: true`) is an explicit-intent check that sits
  behind authentication; it does not replace it.

```bash
# Read the token from the environment. A -H value is visible in the process list while curl runs;
# on a shared host put the header in a curl config file (curl -K) instead.
curl -s -H "Authorization: Bearer $AGENT_MANAGER_TOKEN" http://127.0.0.1:$PORT/api/agents
curl -s http://127.0.0.1:$PORT/api/health   # minimal form, no header needed
```

Smoke test: `npm run build && node scripts/smoke-auth.mjs` (from `server/`) starts the built gateway on free ports with
a random token and checks bind refusal, the token length rule, WebSocket 4401 and 4429, the handshake order, the
Bearer rule, the health forms and that the token never reaches the gateway's output. It exits non-zero on any
failure.

## Messages

Client to server: `agent:create`, `agent:input`, `agent:resize`, `agent:kill`, `agent:update` (rename, tags, group),
`agent:broadcast`, and `ping` (`{"type":"ping","t":<number>}`, answered with `{"type":"pong","t":<same number>}`).
Server to client: `agent:init_list`, the agent output/status messages, `agent:updated`, `agent:ack` and `agent:error`.

Every client frame is validated against the shared protocol package before anything acts on it. A frame of a
known type with an invalid field is answered with `agent:error` `USAGE` to the sender only; the message names the
field (`invalid field: name`) and never the value. Oversized `agent:input` or `agent:broadcast` data (over 65536
UTF-8 bytes) is answered with `PAYLOAD_TOO_LARGE`. An unknown `type` is ignored without any output, and frames that
are not JSON objects with a string `type` are ignored and logged once.

`reqId` is an optional string of 1 to 128 characters on `agent:create`, `agent:kill` and `agent:update`. With it the
sender gets exactly one `agent:ack` `{ reqId, op, ok: true, agent? }` on success, or one `agent:error` carrying the
same `reqId` on failure; without it nothing is acknowledged and behavior is as before (the 10 s client timeout is
the frontend's, not the gateway's). `reqId` is also the idempotency key: a repeated `reqId` with an identical
request returns the original ack and performs no side effect, the same `reqId` with a different request is refused
with `CONFLICT`, and failures are not cached so a retry executes again. The window is 1024 entries for 5 minutes,
shared by the WebSocket and HTTP surfaces. An unknown agent id is refused with `NOT_FOUND` (no snapshot is
broadcast). Fields the gateway cannot honour are refused with `UNSUPPORTED`: `agent:create` with a `backend` or
non-empty `params`, and `agent:history` and `agent:approve`. `agent:input` and `agent:resize` never produce a reply
for a failure other than validation, and `agent:broadcast` is not acknowledged.

`agent:kill` takes the optional booleans `killSession` and `confirm`. Without `killSession` it only closes the
agent: the gateway detaches its pty and the tmux session keeps running. With `killSession: true` the gateway
also ends the agent's tmux session, but only for tmux agents it knows about (created or discovered), and only
when `confirm` is exactly `true`; otherwise it answers the requesting client with `agent:error` code `USAGE`
and does nothing. The session name is derived server-side from the registry and never taken from the client. The
gateway runs `tmux kill-session -t =<name>` (exact-match target) through `execFile` with an argument array,
never a shell, and only for names matching `^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$`. Refusals are typed `agent:error`
replies to the requesting client only: `UNSUPPORTED` for non-tmux agents, `USAGE` for a missing confirm or an
unkillable session name, `INTERNAL` when tmux fails. A session that is already gone counts as success. To kill a
session the gateway refuses, run `tmux kill-session -t <name>` by hand.

Destructive operations are enforced by one policy stage in the dispatch path, derived from the `destructive` and
`confirmParam` flags of the operations catalog (`agent.kill` today): a request without the confirm parameter exactly
`true` is refused with `USAGE` before any lookup, cache entry or process, on WebSocket and HTTP alike.

## HTTP API

The same operations are reachable over HTTP under `/api`. Each handler parses its input into the validated client
message the WebSocket uses, runs it through the same dispatch path and maps the outcome to the contract's bodies;
no handler touches the registry, a driver or tmux. The legacy `GET /health` is unchanged.

| Route                    | Request                                   | Success                                  | Notes |
| ------------------------ | ----------------------------------------- | ---------------------------------------- | ----- |
| `GET /api/health`        | none (optional Bearer)                    | `200 { ok, contract, epoch, backends }`, plus `agents` with a valid Bearer when a token is set | `backends` is `[{ "id": "local", "up": true }]`; `epoch` is a random id per process; `agents` is an integer count. |
| `GET /api/agents`        | none                                      | `200 { ok: true, agents: Agent[] }`      | The current roster. |
| `POST /api/agents`       | JSON body: `name`, `mode`, `targetHost`, optional `initialCmd`; optional `Idempotency-Key` header | `201 { ok: true, agent }` | Same validation as `agent:create`. |
| `DELETE /api/agents/:id` | none                                      | `200 { ok: true }`                       | Closes the agent and leaves its tmux session running. |
| `POST /api/agents/:id/kill` | JSON body `{ "confirm": true }`; optional `Idempotency-Key` header | `200 { ok: true }` | Ends the agent's tmux session and removes the agent. Without `confirm: true` exactly: `400 USAGE`, nothing runs. |
| `GET /api/agents/:id/logs`, `GET /api/search` | none                         | `422` `UNSUPPORTED`                      | Catalogued for a later phase; answered with a fixed message so a client can tell "not in this build" from "no such path". |

Any other `/api` path or method answers `404 NOT_FOUND`. `DELETE /api/agents/:id` only closes the agent and never
touches tmux; only the explicit `POST /api/agents/:id/kill` ends a session. The route implies `killSession`, reads
`confirm` from the JSON body only (never the path or query) and is refused by the same gateway policy as the
WebSocket. `confirm` is an explicit-intent gate against accidents that sits behind authentication; it does not replace it.

Failures use one envelope, `{ "ok": false, "error": { "code", "message", "retryable" } }`, with the status taken from
the contract: `USAGE` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409,
`PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED` 422, `RATE_LIMITED` 429, `INTERNAL` 500, `BACKEND_DOWN` 503, `TIMEOUT` 504.
Messages are fixed strings or name a field only (`invalid field: name`); they never echo request values, stack
traces or internal error text.

`Idempotency-Key` is the `reqId` on `POST /api/agents`, `POST /api/agents/:id/kill` and `DELETE /api/agents/:id`:
1 to 128 printable ASCII characters (no spaces; otherwise `400 USAGE`), and a `reqId` in the body is
ignored. A repeated `POST /api/agents` with the same key and body returns the original `201` body and creates one
agent; the same key with a different body is `409 CONFLICT`. The cache is the one the WebSocket uses (1024 entries
for 5 minutes), so a key used on one surface is honoured on the other. Failures are not cached.

Host-header guard, on every `/api` request (all methods, including `GET /api/agents` and `GET /api/health`): the
`Host` header must name `127.0.0.1`, `localhost`, `[::1]` or the configured `HOST` (any port, case-insensitive), and
must be a plain host or `host:port`; anything else, or no `Host`, is `403 FORBIDDEN` with the fixed message
`host not allowed`, before any route runs. This closes DNS rebinding: a page on an attacker's name that resolves to
`127.0.0.1` reaches the API same-origin and sends no `Origin` on a `GET`, but its `Host` still carries the attacker's
name. Clients that dial `127.0.0.1:$PORT` or `localhost:$PORT` (curl, the frontend proxy) are unaffected; a reverse
proxy that rewrites `Host` must send a loopback one. The non-`/api` `GET /health` is not guarded.

Guards, in order, on `POST` and `DELETE`: an `Origin` header outside `ALLOWED_ORIGINS` is `403 FORBIDDEN` before
anything else is read (requests with no `Origin` are local tools and pass); `POST` requires
`Content-Type: application/json` (otherwise `400 USAGE`); bodies are capped at 64 KiB (`413 PAYLOAD_TOO_LARGE`);
malformed JSON or a non-object body is `400 USAGE`. No CORS headers are ever sent, so a cross-origin page cannot
read these routes or pass a preflight; the frontend talks to the gateway over WebSocket. Responses carry
`Cache-Control: no-store`, no `X-Powered-By`, and no cookies are used. The first browser consumer of these routes
must add a CORS policy with the same allowlist.

```bash
# PORT is the port the gateway listens on.
curl -s http://127.0.0.1:$PORT/api/health
curl -s http://127.0.0.1:$PORT/api/agents
curl -s -X POST -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"name":"demo","mode":"tmux","targetHost":"demo"}' http://127.0.0.1:$PORT/api/agents   # run twice: same agent id
curl -s -X DELETE http://127.0.0.1:$PORT/api/agents/<agent-id>   # closes; tmux keeps running
curl -s -X POST -H 'Content-Type: application/json' -d '{"confirm":true}' \
  http://127.0.0.1:$PORT/api/agents/<agent-id>/kill                # ends the tmux session
```

Not yet: logs and search (Phases 11 and 16), further rate limits (Phase 12), CORS (Phase 16). Authentication is described
above: with `AGENT_MANAGER_TOKEN` set every route except the minimal health needs the Bearer.

The authoritative wire contract is in
[docs/superpowers/specs/2026-11-07-fe-be-contract.md](../docs/superpowers/specs/2026-11-07-fe-be-contract.md).
