# Requirements

Contract source of truth for v2.x: `docs/superpowers/specs/2026-11-07-fe-be-contract.md`.
ID scheme: `INT-nn` = M-INT-n, `UX-nn` = M-UI-n (the UI plan's `UI-nn` collides with shipped `UI-01`), `GW-nn` = gateway work, `ADP-nn` = backend adapters.

## v1 (validated, shipped)
- [x] SESS-01: Create, kill, resize and send input to agent sessions
- [x] UI-01: Freeform windows with Grid/Cascade/Focus layouts
- [x] BACK-01: Express + WebSocket backend with tmux/SSH drivers
- [x] TEST-01: Expanded test suite (~93.8% coverage)
- [x] FAN-01: Broadcast command to targeted agents with destructive-safety gate
- [x] SRCH-01: Global cross-agent log search with jump-to-pane
- [x] NOTI-01: Toast/browser alerts on agent error or disconnect

## v1.1 (active)
- [ ] VER-01: Full suite (`npm test`, `tsc`, server tests) verified green for fan-out/search work
- [ ] DOC-01: Reconcile docs/plans checkboxes and docs with shipped code

## v2.0 Live-Connected Command Center (planned)

### Integration
- [ ] INT-01: Transport layer with reconnect (jittered backoff, heartbeat), visible connection state, no silent mock fallback, explicit Demo mode, single `VITE_BACKEND_URL`
- [ ] INT-02: Token auth and secure transport (`hello` handshake, `auth_failed`, wss for non-local, logout clears state)
- [ ] INT-03: Server-confirmed agent lifecycle (`reqId`, `agent:ack`/`agent:error`, added/removed/updated, `/api/agents`)
- [ ] INT-04: Lossless ordered output (`seq`, `epoch`, resume, gap markers, LogStore, history, logs endpoint)
- [ ] INT-05: Acked broadcast and input API (per-target results, idempotency, size and rate limits)
- [ ] INT-06: Server-side history search (`/api/search`, cursor pagination, cancellation, local merge)
- [ ] INT-08: Shared protocol package, golden fixtures and breaking-change check; FE never imports from `server/src`
- [ ] INT-09: Offline mock server with seeded scenarios and Playwright e2e

### Gateway
- [ ] GW-01: Gateway baseline hardening (loopback default bind, Origin allowlist, frame cap, ping/pong, liveness)

### UX
- [ ] UX-01: Resilient shell (pane states, error boundary, failure toasts)
- [ ] UX-02: Server-authoritative roster (empty live start, pending/confirmed create, stale markers, rename/tags/group)
- [ ] UX-03: Workspace persistence and named layouts
- [ ] UX-04: Terminal quality (find, scrollback, fonts, pause/resume, replay)
- [ ] UX-05: Broadcast v2 (targeting, per-target results, snippets, dry run)
- [ ] UX-06: Search v2 (regex/case/word toggles, filters, context, virtualization)
- [ ] UX-07: Alerts and notification center (rules, history, desktop permission flow)
- [ ] UX-08: Keyboard-first operation and accessibility (command palette, focus management, axe-clean)

## v2.1 Multi-Backend and Fleet (planned)

- [ ] INT-07: Capability negotiation and validated `agent:meta` events
- [ ] INT-10: Error taxonomy, diagnostics, boundary validation, CSP and security checklist
- [ ] GW-02: Gateway `BackendAdapter` interface; tmux/ssh as adapters; UNSUPPORTED handling and fault isolation
- [ ] UX-09: Multi-capability agent model (cost, quota, pipeline, tasks, sandbox panels; spec-driven Add-Agent wizard; read-only panes)
- [ ] UX-10: Settings UI and multi-backend profiles
- [ ] ADP-01: cvm adapter (cvmd REST + SSE, non-interactive)
- [ ] ADP-02: climah adapter (events.jsonl, gates, budget, non-interactive)
- [ ] ADP-03: Optional mads state store and mad route helper

## Out of Scope
- Replacing the in-repo PTY gateway with mads, mad, climah or cvm (none provides an interactive PTY)
- Interactive attach (stdin, resize) for cvm or climah; tracked as an upstream feature request
- Modifying, pulling or writing into the external repos (`~/src/meso/mads`, `~/src/inter/mad`, `~/src/tests/climah`, `~/src/ai/projects/cvm`) from any GSD plan
- Building a cluster manager (scheduling and quota stay in cvmd)

## Traceability
| Req | Phase |
|-----|-------|
| VER-01 | 1 |
| DOC-01 | 1 |
| INT-08 | 2 |
| INT-01 | 3 |
| GW-01 | 4 |
| UX-08 | 5 |
| INT-03 | 6 |
| INT-09 | 7 |
| INT-02 | 8 |
| UX-01 | 9 |
| UX-02 | 10 |
| INT-04 | 11 |
| INT-05 | 12 |
| UX-03 | 13 |
| UX-04 | 14 |
| UX-05 | 15 |
| INT-06 | 16 |
| UX-07 | 17 |
| UX-06 | 18 |
| INT-07 | 19 |
| GW-02 | 20 |
| INT-10 | 21 |
| UX-09 | 22 |
| UX-10 | 23 |
| ADP-01 | 24 |
| ADP-02 | 25 |
| ADP-03 | 26 |

**Coverage:** 2 (v1.1) + 17 (v2.0) + 8 (v2.1) = 27 active requirements, all mapped, 0 unmapped.
