# Roadmap

## Milestone v1.0 - Foundation (shipped, pre-GSD history)
Frontend, backend, test-suite enhancement, codebase improvements, and fan-out/search features are merged (see git log and docs/superpowers/plans).

## Milestone v1.1 - Fan-out Close-out (active)

### Phase 1: Verify and reconcile fan-out and search
**Goal:** Confirm broadcast, log search and toasts work end to end with a green suite, and align docs with code.
**Depends on:** Nothing
**Requirements:** VER-01, DOC-01
**Success criteria:**
1. `npm test` and `tsc` pass in root and `server/`
2. Docs plan checkboxes/status reflect shipped work
3. Manual QA per `docs/qa-test-plan.md` for broadcast, search, toasts

Plans: 1 plan (executed; phase stays open for the human QA checkpoint only)
- [ ] 01-01-PLAN.md - Record baseline evidence, reconcile docs with shipped code, run manual QA checkpoint (wave 1). Executed and merged 2026-11-07: VER-01 PASS, docs reconciled (DOC-01); criterion 3 (manual QA per `docs/qa-test-plan.md` section 5) is PENDING-HUMAN and must be recorded in `01-EVIDENCE.md` to close the phase.

---

## Execution model for v2.0 and v2.1

Authoritative contract: `docs/superpowers/specs/2026-11-07-fe-be-contract.md` (reconciles `docs/superpowers/plans/2026-11-07-backend-integration-plan.md` and `docs/superpowers/plans/2026-11-07-ui-and-integration-milestones.md`). Every phase below implements slices of that contract; section 14 of the spec maps contract elements to phases.

Phase numbers continue after v1.1 (no restart). Source milestone mapping: M-INT-n -> INT-nn, M-UI-n -> UX-nn (the UI plan's `UI-nn` keys collide with the shipped v1 `UI-01`), plus GW-xx (gateway) and ADP-xx (adapters) from the backend plan.

**Phase-level waves** (derived from `Depends on`; unchanged for phases 9-26; phases 1-8 are superseded by the plan-level schedule below):

| Wave | Phases | Notes |
|------|--------|-------|
| 1 | 1, 2, 3, 4 | Done (merged 2026-11-07). |
| 2 | 5, 6, 7, 8 | Re-cut at plan level, see below. 6 and 8 both edit `server/src/index.ts`: sequence 6 before 8. 5 and 7 add devDependencies: require a Package Legitimacy Audit in their RESEARCH.md. |
| 3 | 9, 10, 11, 12 | |
| 4 | 13, 14, 15, 16, 17 | |
| 5 | 18 | |
| 6 | 19 | v2.1 starts. |
| 7 | 20, 21, 22, 23 | |
| 8 | 24, 25, 26 | Adapters treat external repos as read-only (fixtures in this repo only). |

**Plan-level schedule** (authoritative from 2026-11-07; one global wave counter; plans in the same wave have disjoint file ownership, verified by `node .planning/tools/check-wave-collisions.mjs --pending`):

| Wave | Plans | Status |
|------|-------|--------|
| 1 | 01-01, 02-01, 03-01, 04-01 | Complete. 01-01 manual QA pending-human. |
| 2 | 02-02, 03-02, 05-01 | Planned. 05-01 touches only modals, so it needs none of the files 03-02 (Header, App) and 02-0x (package.json) own. |
| 3 | 02-03, 10-01, 10-02 (planned); 05-02, 05-03 (to plan after wave 2 merges) | 02-03 needs 02-02 (same package files). 10-01 and 10-02 are the Phase 10 roster slice pulled forward on 2026-11-07 (disjoint from 02-03: they touch `src/store`, `agentSocket.ts`, `NotificationToastManager.tsx`, `AgentPane.tsx`, `Workspace.tsx`, `server/__tests__` and four docs). 05-02 edits Header.tsx, App.tsx, Toolbar.tsx and needs 03-02 and 05-01 merged; 05-03 (pane chrome) is disjoint from 05-02 but shares `AgentPane.tsx` with 10-01, so plan it for wave 4 (after 10-01 merges) or exclude that file. Wave 3 now holds three plans, the configured `max_concurrent_agents`, so 05-02/05-03 would run as a second batch or move to wave 4 when planned. |
| 4 | 02-04 (planned); Phase 6 plans (to plan; needs 02-03 merged) | 02-04 owns package.json, CI and the surface snapshot; Phase 6 owns `server/src` dispatch and FE lifecycle, so they are disjoint. |
| 5 | 05-04 (devDependency for the axe audit, so after 02-04 owns package.json); Phase 8 plans (after Phase 6: both edit `server/src/index.ts`) | |
| 6 | Phase 7 plans (adds devDependencies, so after 05-04) | |

Deviations from the UI plan's ordering: UI-8 (a11y, Phase 5) moves from wave 1 to the wave-2 to wave-5 range because parts share `Header.tsx`/`App.tsx` with Phase 3 and `package.json` with Phase 2 (the modal-focus part, 05-01, shares neither and runs in wave 2); INT-10 follows INT-7; the connection chip/banner of UI-1 is delivered in Phase 3 with the transport (needs no later dependency), leaving pane states, error boundary and failure toasts to Phase 9.

## Milestone v2.0 - Live-Connected Command Center (planned)

Objective: the UI truthfully reflects a real, hardened gateway: server-authoritative roster, lossless streaming, acked broadcast, server-side search, resilient shell, accessible controls, offline mock for development.

### Phase 2: Shared Protocol Package and Contract Fixtures
**Goal:** FE and gateway share one executable, versioned contract that cannot drift, and the FE no longer imports from `server/src`.
**Depends on:** Nothing
**Requirements:** INT-08
**Success criteria:**
1. `packages/protocol` exports the full contract (types, validators, limits) from the contract spec; neither FE nor server imports the other's source tree
2. Golden fixtures for every message validate in both directions; malformed or unknown messages are rejected or ignored without throwing
3. `npm run contract:check` exits non-zero on a breaking schema change and CI runs it
4. `npm test`, `npm run build`, server tests and server build stay green

Plans: 4 plans (re-cut 2026-11-07: the original 02-02 was split because it exceeded one executor context; the original 02-03 is now 02-04)
- [x] 02-01-PLAN.md - Package skeleton, consumer wiring, validators for existing messages (wave 1, done)
- [ ] 02-02-PLAN.md - Field-spec engine extraction, hello/hello_ack tracer, error vocabulary, client-to-gateway messages and fixtures (wave 2)
- [ ] 02-03-PLAN.md - Gateway-to-client messages, additive Agent fields, per-scope meta, HTTP shapes, limits, FE/gateway drift guards (wave 3)
- [ ] 02-04-PLAN.md - Surface snapshot, `contract:check`, CI workflow, package README (wave 4)

### Phase 3: Transport Reconnect and Connection State
**Goal:** The UI always shows the true connection state, recovers by itself, and never fabricates live data.
**Depends on:** Nothing
**Requirements:** INT-01
**Success criteria:**
1. Stopping the backend shows Reconnecting in the header chip and a banner within 2 s; the app reconnects without reload (capped, jittered backoff) when the backend returns
2. No simulated output appears unless Demo mode (`VITE_DEMO_MODE=1` or `?demo=1`) is on, and Demo mode is visibly labelled
3. A heartbeat timeout triggers reconnect; malformed frames are dropped without throwing
4. `VITE_BACKEND_URL` (default `http://localhost:8088`) configures the backend and `docs/RUNNING.md` documents it

Plans: 2 plans
- [x] 03-01-PLAN.md - Transport, adapters, connection store, truthful agentSocket shim (wave 1, done)
- [ ] 03-02-PLAN.md - Connection chip, banner, docs (RUNNING, README, ARCHITECTURE) and ADR-007 (wave 2)

### Phase 4: Gateway Baseline Hardening
**Goal:** The gateway is safe by default on a developer machine: loopback only, origin-checked, size-capped, liveness-aware.
**Depends on:** Nothing
**Requirements:** GW-01
**Success criteria:**
1. The server listens on `127.0.0.1` by default; a non-loopback `HOST` refuses to start with an actionable message
2. A WebSocket upgrade from an Origin outside `ALLOWED_ORIGINS` is rejected with 403; allowed dev origins and Origin-less clients connect
3. Frames over 1 MiB close with 1009; non-object and unknown-type frames are ignored; `ping` is answered with `pong`; unresponsive sockets are terminated
4. `server/README.md` documents `PORT`, `HOST`, `ALLOWED_ORIGINS`

Plans: 1 plan (complete)
- [x] 04-01-PLAN.md - Loopback bind, origin allowlist, frame cap, pong, liveness, hostile-input tests (wave 1, done)

### Phase 5: Keyboard-First Operation and Accessibility
**Goal:** Everything is operable without a mouse and the chrome meets WCAG 2.1 AA.
**Depends on:** Phase 3 (shared `Header.tsx`/`App.tsx`), Phase 2 (shared `package.json`)
**Requirements:** UX-08
**Success criteria:**
1. Ctrl+K command palette reaches agents, layouts, broadcast and search; a shortcut help overlay lists every binding
2. Every modal traps and restores focus (component tests)
3. An axe run reports zero serious or critical issues on the main views
4. Reduced-motion, high-contrast and light/dark themes work

Plans: 1 of 4 planned (split by file ownership so the unblocked part runs in wave 2)
- [ ] 05-01-PLAN.md - Shared modal focus hook; dialog semantics, labels, focus trap and restoration for the three modals (wave 2; criterion 2)
- [ ] 05-02 (to plan after wave 2 merges) - Shortcut registry, Ctrl+K command palette, shortcut help overlay, shared UI store; edits Header.tsx, App.tsx, Toolbar.tsx (wave 3; criterion 1)
- [ ] 05-03 (to plan) - Pane chrome keyboard operation: keyboard move/resize of floating panes, accessible names for pane controls, status not by colour alone (wave 3; part of criterion 3)
- [ ] 05-04 (to plan) - Light/dark/high-contrast themes, reduced motion, axe audit on the main views; adds a devDependency, so RESEARCH.md needs a Package Legitimacy Audit (wave 5; criteria 3 and 4)

### Phase 6: Agent Lifecycle API
**Goal:** Create, list, kill and rename are server-confirmed with typed errors, and the gateway validates every client frame.
**Depends on:** Phase 2, Phase 3
**Requirements:** INT-03
**Success criteria:**
1. `create`/`kill`/`update` resolve with the server's agent or reject with a typed error (`reqId` correlation, 10 s timeout)
2. The gateway validates every client frame with the package validators; malformed frames yield `agent:error USAGE`
3. After reconnect the roster resyncs from `agent:init_list` without duplicates; `agent:added/removed/updated` are applied
4. `/api/health` and `/api/agents` (GET, POST, DELETE) work; a repeated `reqId` is idempotent

### Phase 7: Offline Mock Server and Dev Tooling
**Goal:** Full UI development and e2e testing without any real backend.
**Depends on:** Phase 2, Phase 3
**Requirements:** INT-09
**Success criteria:**
1. `npm run dev:mock` serves the UI against a scriptable mock WS server with normal, flaky, auth-fail, slow, large-output and partial-broadcast-failure scenarios, reproducible by seed
2. The mock server conforms to the shared fixtures
3. Playwright e2e covers create, type, broadcast, search and reconnect; `npm run test:e2e` is green in CI

### Phase 8: Auth and Secure Transport
**Goal:** Remote access is possible only with a token over TLS; local use stays zero-config.
**Depends on:** Phase 2, Phase 3, Phase 4
**Requirements:** INT-02
**Success criteria:**
1. A wrong token yields `auth_failed` with no reconnect storm
2. The FE refuses non-loopback `ws://`; the gateway refuses a non-loopback bind without `AGENT_MANAGER_TOKEN`
3. The token never appears in a URL, log line or diagnostics export (test-asserted); logout empties stores
4. `hello`/`hello_ack` carries contract version, auth and `epoch`

### Phase 9: Resilient Shell: Pane States and Failure Surfaces
**Goal:** Every failure is visible where it happens.
**Depends on:** Phase 3, Phase 6
**Requirements:** UX-01
**Success criteria:**
1. Panes dim and show reconnecting, disconnected, loading, empty and error states for every connection state
2. A React error boundary renders a fallback instead of a blank screen
3. Failed create and kill produce toasts with typed messages

### Phase 10: Server-Authoritative Agent Roster
**Goal:** The roster reflects backend truth.
**Depends on:** Phase 6, Phase 8
**Requirements:** UX-02
**Success criteria:**
1. In live mode the store starts empty and equals the gateway's `agent:init_list`; Demo mode keeps its seed agents
2. Create shows pending then confirmed; a failure rolls back with a toast
3. Status events update the badge and toasts; stale agents are marked; rename, tags and group go through `agent:update`

**Pulled forward (2026-11-07) as a slice:** Phase 10 runs now, ahead of its declared dependencies Phase 6 and Phase 8, because manual QA step 1 (`docs/qa-test-plan.md` section 5) fails in live mode: Add Agent builds a local agent and never sends `agent:create`. The slice works against what the gateway emits today (a full `agent:init_list` snapshot after every create, kill and new connection; the gateway assigns agent ids) and changes no server source and no `packages/protocol/**`.
- Covered by the slice: criterion 1 (empty live start, roster equals the last snapshot, Demo mode unchanged); criterion 2 (Starting pane reconciled by name, mode and targetHost, rollback after 10 s or on a failed send with a plain error notice; typed failure toasts stay with Phase 9); criterion 3 for the status badge, plus gateway-confirmed kill.
- Deferred and still open: stale-agent markers (need new server fields); rename, tags and group via `agent:update` (the gateway has no `agent:update` handler yet; Phase 6 adds it); `reqId` correlation, typed errors, `agent:added/removed/updated` and HTTP `/api/agents` (Phase 6); auth (Phase 8). UX-02 stays unticked in REQUIREMENTS.md until those land. When Phase 6 runs it replaces the key-based pending reconciliation with `reqId` acks.

Plans: 2 plans (slice, both wave 3, disjoint file ownership)
- [ ] 10-01-PLAN.md - Frontend roster slice: empty live start, `agent:init_list` snapshot reconciliation, `agent:create` with Starting pane and rollback, gateway-confirmed kill, status events in the store, error notices, empty-roster copy (wave 3; criteria 1-3 partly)
- [ ] 10-02-PLAN.md - Gateway roster contract tests over a real WebSocket (no `server/src` change) and docs: RUNNING, ARCHITECTURE, ADR-008, manual QA sub-steps 1a-1c (wave 3)

### Phase 11: Output Streaming, Sequencing and Replay
**Goal:** Lossless, ordered terminal streams across reconnects.
**Depends on:** Phase 3, Phase 6, Phase 8
**Requirements:** INT-04
**Success criteria:**
1. After a forced reconnect the output has no duplicate or missing chunk (chaos test: drop, reorder, duplicate)
2. An unrecoverable gap shows a visible marker; a split multi-byte character renders intact
3. The gateway LogStore serves `/api/agents/:id/logs` and `agent:history`; a gateway restart changes `epoch` and the FE resyncs

### Phase 12: Broadcast and Input API
**Goal:** Acked fan-out.
**Depends on:** Phase 6
**Requirements:** INT-05
**Success criteria:**
1. `agent:broadcast` returns a per-target result; partial failure is reported
2. Retrying a `reqId` does not duplicate delivery
3. Oversize input is rejected client-side and server-side; rate limiting is surfaced

### Phase 13: Workspace Persistence and Named Layouts
**Goal:** Reload restores the session.
**Depends on:** Phase 10
**Requirements:** UX-03
**Success criteria:**
1. Reload restores layout mode, geometry, active agent and minimized state for agents that still exist
2. Named workspaces can be saved, loaded and deleted; storage migration is versioned and tested
3. Unavailable storage falls back to the default layout without error

### Phase 14: Terminal Quality and Replay
**Goal:** Terminals behave like real ones across reconnect.
**Depends on:** Phase 11
**Requirements:** UX-04
**Success criteria:**
1. Find-in-pane, copy/paste, scrollback, font and theme settings work
2. A 100 KB burst renders without dropped input in the test harness
3. Replay on reconnect shows no duplicate or missing output

### Phase 15: Broadcast v2
**Goal:** Safe, observable fan-out.
**Depends on:** Phase 10, Phase 12
**Requirements:** UX-05
**Success criteria:**
1. Targets can be selected by group, tag, status or all; one result row per target; failed targets are individually retryable
2. Snippet library, history and dry-run preview work
3. A destructive pattern always forces the confirmation modal (tests per pattern class)

### Phase 16: Search API
**Goal:** Server-side history search when the gateway offers it.
**Depends on:** Phase 11
**Requirements:** INT-06
**Success criteria:**
1. `GET /api/search` paginates by cursor and merges deterministically with local hits (dedupe `(agentId, seq, line)`)
2. A cancelled query ignores late responses
3. A gateway without the `search` capability uses the local-only path

### Phase 17: Alerts and Notification Center
**Goal:** No important event is missed.
**Depends on:** Phase 10
**Requirements:** UX-07
**Success criteria:**
1. A notification center keeps bounded history across reload with mark-read
2. A rule match creates exactly one notification (debounced)
3. A denied desktop-notification permission degrades to in-app alerts

### Phase 18: Search v2
**Goal:** Find anything across agents, live and historical.
**Depends on:** Phase 14, Phase 16
**Requirements:** UX-06
**Success criteria:**
1. Regex, case and whole-word toggles plus agent, status and time filters work; invalid regex shows an inline error
2. A 50k-line corpus search completes in under 200 ms (benchmark test)
3. Jump-to-pane scrolls to and highlights the match; server and local hits merge with a notice when capability is absent

## Milestone v2.1 - Multi-Backend and Fleet (planned)

Objective: one UI over several backends (cvm sandboxes, climah pipelines, optional mads/mad) through gateway adapters and capability flags.

### Phase 19: Capability Negotiation and Meta Events
**Goal:** One UI, many backends.
**Depends on:** Phase 3, Phase 8
**Requirements:** INT-07
**Success criteria:**
1. `hello_ack.backends` and `Agent.capabilities` drive UI gating; unknown capabilities are ignored
2. `agent:meta` payloads are schema-validated; unknown event types are logged and dropped without throwing
3. Older and newer gateways of the same major interoperate; a different major shows a clear upgrade message

### Phase 20: Gateway BackendAdapter Refactor
**Goal:** tmux and ssh become adapters behind one gateway interface.
**Depends on:** Phase 11, Phase 19
**Requirements:** GW-02
**Success criteria:**
1. `BackendAdapter` (list, create, kill, input, resize, events, capabilities) is the only path from the session manager to a backend
2. Unsupported operations return `agent:error UNSUPPORTED`; a failing adapter isolates to its own agents
3. A fake adapter plus recorded-fixture contract tests exist; FE behavior with tmux/ssh is unchanged

### Phase 21: Error Handling, Observability and Hardening
**Goal:** Diagnosable failures.
**Depends on:** Phase 3, Phase 6, Phase 8, Phase 11, Phase 12, Phase 16, Phase 19
**Requirements:** INT-10
**Success criteria:**
1. Fuzzed malformed frames never crash the app (package validators at the FE boundary)
2. "Copy diagnostics" exports a ring-buffered report containing no tokens
3. A CSP and a terminal-link security checklist are documented and signed off

### Phase 22: Multi-Capability Agent Model
**Goal:** Surface what cvm, climah, mads and mad offer without hard-coding any one.
**Depends on:** Phase 10, Phase 19
**Requirements:** UX-09
**Success criteria:**
1. With a mock adapter advertising only `terminal`, no extra panel renders
2. Advertising `cost`, `quota`, `pipeline`, `tasks` or `sandbox` shows the matching panel fed by `agent:meta`
3. The Add-Agent wizard renders its fields from a backend-advertised `AgentSpec` fixture; agents without `input` get read-only panes

### Phase 23: Settings, Multi-Backend Profiles and Polish
**Goal:** Configure without env vars; connect to several backends at once.
**Depends on:** Phase 3, Phase 19
**Requirements:** UX-10
**Success criteria:**
1. A settings UI edits backend profiles, token, scrollback, theme, font and Demo mode
2. Two active profiles show a merged roster with a backend badge; an offline profile does not block the other
3. A 20-pane profiling checklist is documented

### Phase 24: cvm Adapter
**Goal:** Run and watch sandboxed agents (cvmd REST + SSE) from the UI.
**Depends on:** Phase 8, Phase 20, Phase 21
**Requirements:** ADP-01
**Success criteria:**
1. Creating a cvm agent spins a VM and streams the task log into a read-only pane; exit 0 maps to idle, non-zero to error with a toast
2. cvmd down yields `disconnected` then recovery; a quota error surfaces as `agent:error`
3. The cvmd token stays server-side; tests run against recorded fixtures of a fake cvmd

### Phase 25: climah Adapter
**Goal:** Observe pipeline runs, budget and gates from the UI.
**Depends on:** Phase 20, Phase 22
**Requirements:** ADP-02
**Success criteria:**
1. A climah run replayed from a recorded `events.jsonl` fixture shows agents with statuses, output and budget
2. A gate prompt appears as a toast and an approve/deny action; `budget_hard_stop` raises an error toast
3. Unknown event kinds and schema bumps are tolerated

### Phase 26: mads State Store and mad Route Helper
**Goal:** Optional durable roster and routing suggestions.
**Depends on:** Phase 20
**Requirements:** ADP-03
**Success criteria:**
1. After a gateway restart the roster and last status are restored from the mads store; the `mads.contract/1` version is asserted at startup
2. A `mad route` suggestion appears in the create dialog, non-blocking and off by default
3. Subprocesses use argv arrays only; both integrations are optional and absent by default

## Progress

| Phase | Milestone | Plans Complete | Status |
|-------|-----------|----------------|--------|
| 1. Verify and reconcile fan-out and search | v1.1 | 1/1 | Executed; open for manual QA (pending-human) |
| 2. Shared Protocol Package and Contract Fixtures | v2.0 | 1/4 | In progress (02-02..02-04 planned) |
| 3. Transport Reconnect and Connection State | v2.0 | 1/2 | In progress (03-02 planned) |
| 4. Gateway Baseline Hardening | v2.0 | 1/1 | Complete |
| 5. Keyboard-First Operation and Accessibility | v2.0 | 0/4 | In progress (05-01 planned) |
| 6-18 | v2.0 | 0/TBD | Not planned |
| 19-26 | v2.1 | 0/TBD | Not planned |
