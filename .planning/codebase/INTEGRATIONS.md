# External Integrations

**Analysis Date:** 2026-11-07

## APIs & External Services
- No third-party SaaS APIs detected.
- Frontend <-> backend WebSocket at `ws://localhost:8088/ws` (override `VITE_WS_URL`); client `src/services/agentSocket.ts`, server `server/src/index.ts`.
- Protocol (single source of truth): `server/src/protocol/wsProtocol.ts`, re-exported by `src/services/wsProtocol.ts` and `src/types/agent.ts`.
  - Client->server: `agent:input`, `agent:resize`, `agent:create`, `agent:kill`, `agent:broadcast`
  - Server->client: `agent:output`, `agent:status_change`, `agent:init_list`
- HTTP: `GET /health` returns status, agent count, timestamp.

## System Integrations
- tmux CLI: discovery via `tmux list-sessions` (`server/src/services/TmuxDiscovery.ts`); attach via `tmux new-session -A -s <name>` in node-pty (`TmuxDriver.ts`)
- SSH servers: ssh2 client, target format `user@host[:port]` (`SshDriver.ts`); auth via `SSH_AUTH_SOCK` agent, else `~/.ssh/id_rsa` / `id_ed25519` (`server/src/utils/sshKeyLoader.ts`)

## Data Storage
- None. Agents held in memory (`SessionManager.agents`); frontend log history in memory ring buffer (`src/store/logBufferStore.ts`). Layout not persisted.
- Caching: None. File storage: local filesystem only.

## Authentication & Identity
- None for WebSocket/HTTP clients (no auth, no origin check). SSH auth only as above.

## Monitoring & Observability
- Error tracking: None. Logs: `console.*`.

## CI/CD & Deployment
- Hosting/CI: Not detected (no CI config). Scripts in `scripts/`.

## Environment Configuration
- Vars: `PORT`, `SHELL`, `SSH_AUTH_SOCK`, `USER`, `HOME`, `NODE_ENV`, `VITE_WS_URL`. No `.env` files read.

## Webhooks & Callbacks
- Incoming: None. Outgoing: None.

## Mock Mode
- When no live socket, `AgentSocketService` falls back to `src/services/mockStreamGenerator.ts` (always in `NODE_ENV=test`).

---
*Integration audit: 2026-11-07*
