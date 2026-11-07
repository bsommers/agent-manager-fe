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

Client to server: `agent:create`, `agent:input`, `agent:resize`, `agent:kill`, and `ping` (`{"type":"ping","t":<number>}`,
answered with `{"type":"pong","t":<same number>}`). Server to client: `agent:init_list` and the agent
output/status messages. Frames that are not JSON objects with a string `type` are ignored and logged.

The authoritative wire contract is in
[docs/superpowers/specs/2026-11-07-fe-be-contract.md](../docs/superpowers/specs/2026-11-07-fe-be-contract.md).
