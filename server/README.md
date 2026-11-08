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
| `HOST`            | `127.0.0.1`                                                                               | Must be a loopback address (`127.x.y.z`, `localhost`, `::1`). Any other value is refused at startup until token authentication ships. |
| `ALLOWED_ORIGINS` | `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:4173`, `http://127.0.0.1:4173` | Comma-separated list of exact `http(s)` origins (no path, no credentials, **no wildcard**). Invalid entries abort startup. |

Fixed limits: WebSocket frames larger than 1 MiB close the connection with code 1009.
Protocol pings are sent every 30 s; sockets that do not answer are terminated.

## Security model

- Loopback only: the listener binds `127.0.0.1` by default and refuses any non-loopback `HOST`.
- Origin allowlist: a WebSocket upgrade whose `Origin` is not in `ALLOWED_ORIGINS` is rejected with HTTP 403
  (blocks cross-site WebSocket hijacking from pages in your browser). Clients that send no `Origin`
  (local non-browser tools) are accepted.
- There is no authentication yet. Never expose the port beyond the local machine.
- For remote use, tunnel with SSH local port forwarding, e.g. `ssh -L 8088:127.0.0.1:8088 user@host`.

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

## HTTP API

The same operations are reachable over HTTP under `/api`. Each handler parses its input into the validated client
message the WebSocket uses, runs it through the same dispatch path and maps the outcome to the contract's bodies;
no handler touches the registry, a driver or tmux. The legacy `GET /health` is unchanged.

| Route                    | Request                                   | Success                                  | Notes |
| ------------------------ | ----------------------------------------- | ---------------------------------------- | ----- |
| `GET /api/health`        | none                                      | `200 { ok, contract, epoch, backends, agents }` | `backends` is `[{ "id": "local", "up": true }]`; `epoch` is a random id per process; `agents` is an integer count. |
| `GET /api/agents`        | none                                      | `200 { ok: true, agents: Agent[] }`      | The current roster. |
| `POST /api/agents`       | JSON body: `name`, `mode`, `targetHost`, optional `initialCmd`; optional `Idempotency-Key` header | `201 { ok: true, agent }` | Same validation as `agent:create`. |
| `DELETE /api/agents/:id` | none                                      | `200 { ok: true }`                       | Closes the agent and leaves its tmux session running. |
| `GET /api/agents/:id/logs`, `GET /api/search` | none                         | `422` `UNSUPPORTED`                      | Catalogued for a later phase; answered with a fixed message so a client can tell "not in this build" from "no such path". |

Any other `/api` path or method answers `404 NOT_FOUND`. There is no HTTP form of `agent.kill` (ending a tmux
session) yet, so nothing destructive is reachable over HTTP.

Failures use one envelope, `{ "ok": false, "error": { "code", "message", "retryable" } }`, with the status taken from
the contract: `USAGE` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409,
`PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED` 422, `RATE_LIMITED` 429, `INTERNAL` 500, `BACKEND_DOWN` 503, `TIMEOUT` 504.
Messages are fixed strings or name a field only (`invalid field: name`); they never echo request values, stack
traces or internal error text.

`Idempotency-Key` is the `reqId`: 1 to 128 printable ASCII characters (no spaces), and a `reqId` in the body is
ignored. A repeated `POST /api/agents` with the same key and body returns the original `201` body and creates one
agent; the same key with a different body is `409 CONFLICT`. The cache is the one the WebSocket uses (1024 entries
for 5 minutes), so a key used on one surface is honoured on the other. Failures are not cached.

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
curl -s -X DELETE http://127.0.0.1:$PORT/api/agents/<agent-id>
```

Not yet: logs and search (Phases 11 and 16), ending a tmux session over HTTP, authentication and Host-header
checks (Phase 8; until then the API has the same trust model as the WebSocket, loopback plus the Origin gate, and
a DNS-rebinding page could read the roster), rate limits (Phase 12), CORS (Phase 16).

The authoritative wire contract is in
[docs/superpowers/specs/2026-11-07-fe-be-contract.md](../docs/superpowers/specs/2026-11-07-fe-be-contract.md).
