# UI Feature and FE-BE Integration Milestones

**Date:** 2026-11-07
**Scope:** Front-end work needed to reach the project objective, plus the integration layer that connects the UI to one or more backends.
**Companion:** `2026-11-07-backend-integration-plan.md` (backend detail, written separately). This file stays backend-agnostic by defining a common contract (section 0).

## 0. Objective and the common contract

**Objective (README, FE/BE design specs):** a real-time command center to orchestrate, monitor and interact with many agent processes (local tmux, remote SSH): canvas terminals, window management, layouts, broadcast fan-out, global log search, status alerts.

**Candidate backends and what they could surface**

| Backend | Capability the FE could surface |
|---|---|
| `server/` (in-repo, Node, tmux/ssh drivers) | Terminals, discovery, resize, kill, broadcast. The only backend that speaks the current WS protocol. |
| `mads` (~/src/meso/mads) | Shared state store: claims, handoffs, checkpoints/rollback, bounded context fetch, eight flat verbs. A natural source for task and handoff panels. |
| `mad` (~/src/inter/mad) | Routing decisions (JSON), model-tier dispatch, quota usage (e.g. 36/45), handoff baton. Could surface quota meters and route previews. |
| `climah` (~/src/tests/climah) | Pipelines (SPEC, PLAN, BUILD, TEST, REVIEW), worktrees, token and cost budget, streamed tokens, wave merges. Could surface pipeline and cost views. |
| `cvm` (~/src/ai/projects/cvm) | Sandboxes and VMs across 13 backends, fleet daemon (REST, RBAC, quotas, autoscale), embedded web console, mesh. Could surface sandbox lifecycle, fleet and quota views. |

**Common contract (backend-agnostic).** The FE codes against a `BackendAdapter` interface plus capability flags, not against any one server:

```ts
interface BackendAdapter {
  id: string; capabilities: Set<Capability>;      // 'terminal' | 'broadcast' | 'search' | 'tasks' | 'cost' | 'quota' | 'sandbox' | 'auth'
  connect(): Promise<void>; disconnect(): void;
  state$: Subscribable<ConnState>;                 // connecting | open | reconnecting | closed | auth_failed
  listAgents(): Promise<Agent[]>;
  createAgent(spec: AgentSpec): Promise<Agent>;    // spec.kind selects driver: tmux | ssh | sandbox | pipeline
  killAgent(id: string): Promise<void>;
  sendInput(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  broadcast(ids: string[], data: string): Promise<BroadcastResult>;
  events$: Subscribable<AgentEvent>;               // output | status_change | meta (cost, quota, task)
  // optional by capability
  searchServerLogs?(q: SearchQuery): Promise<SearchHit[]>;
  getReplay?(id: string, fromSeq: number): Promise<OutputChunk[]>;
}
```

The existing `WSMessageClient/Server` union becomes the wire format of one adapter (`WsAdapter`). Other backends (REST for cvm, CLI-bridge for mad/climah/mads) get thin adapters or sit behind a gateway that emits this contract.

## 1. Gap analysis (objectives vs. current UI)

**Present:** React/Vite/TS, Zustand `agentStore` (agents, active id, layout mode, search query) and `logBufferStore` (bounded ring buffer); `TerminalView` (xterm + fit + web-links); `FloatingPane` drag/resize/z-order; Grid/Cascade/Focus layouts; `AddAgentModal`; `AgentControls` (clear, Ctrl+C, kill); `BroadcastBar` + `DestructiveSafetyModal`; `GlobalSearchModal`; `NotificationToastManager`; `AgentSocketService` with mock fallback and `MockStreamGenerator`; vitest tests per component.

| # | Gap | Evidence | Impact |
|---|---|---|---|
| G1 | Transport is a single class with silent permanent fallback to mock. No reconnect, backoff, heartbeat, or visible connection state. | `agentSocket.ts` `onerror/onclose` sets `isMockMode=true`, never retries | A dropped socket looks like a live session running fake data. High risk. |
| G2 | Store seeded with hard-coded `INITIAL_AGENTS`; `agent:init_list` and `status_change` may not drive the store. Creation and removal are local-first, not server-confirmed. | `agentStore.ts` | UI and server state diverge. |
| G3 | No auth or session identity; ws URL is plaintext default `ws://localhost:8088/ws`. README says 8088, server spec says 8080. | `agentSocket.ts`, backend spec | Cannot expose beyond localhost; port drift. |
| G4 | No output replay or resume after reconnect; log buffer is client-only and lost on reload. | `logBufferStore` | Search misses history; reload loses context. |
| G5 | Search is client-side over ring buffer only; no regex/filters/time range, no server-side search, no result context. | `GlobalSearchModal` | Weak for long-running agents. |
| G6 | Layout, active agent, window geometry not persisted; no named workspaces. | no `persist` usage | Rework on every reload. |
| G7 | Agent model is terminal-only (`tmux`/`ssh`). No sandbox, pipeline, task, cost, quota, or handoff concepts. | `types/agent.ts` | Cannot surface mad/climah/cvm/mads capabilities. |
| G8 | Broadcast has no per-target result/ack, no templates/history, no group targeting, no dry run. | `BroadcastBar` | Fan-out is fire-and-forget. |
| G9 | Alerts: toasts only; no notification center, per-agent rules, sound/desktop prefs, or history. | `NotificationToastManager` | Easy to miss events. |
| G10 | Accessibility, keyboard-first operation, command palette, themes, responsive/mobile not covered. | no a11y tests | Power-user and compliance gap. |
| G11 | Error surfaces: no error boundary, no per-pane error/empty/loading states, no toast for failed create/kill. | components | Failures invisible. |
| G12 | No contract tests; FE imports server types via relative path `../../server/src/...` (couples build to one backend). | `wsProtocol.ts` | Blocks multi-backend and separate repos. |
| G13 | No e2e or visual tests; no CI config seen for FE+mock server run. | tests dir | Regressions in drag/resize/terminal go unseen. |
| G14 | No settings UI (ws URL, backend selection, scrollback size, theme, font). | none | Env-var-only configuration. |

## 2. UI feature milestones

### M-UI-1: Resilient shell and connection UX
- **Goal:** the UI always shows true connection state and never fakes live data.
- **Features:** connection status chip in `Header`; global banner on reconnecting/closed/auth_failed; explicit "Demo mode" toggle (mock never auto-activates on failure); per-pane error/empty/loading states; React error boundary; failed create/kill toasts.
- **Files:** `Header.tsx`, new `ConnectionBanner.tsx`, `AgentPane.tsx`, `App.tsx`, new `connectionStore.ts`.
- **Acceptance:** killing the server shows "Reconnecting" within 2 s and panes dim; no mock output appears unless Demo mode is on; component tests cover every ConnState; error boundary test renders fallback.
- **Depends on:** M-INT-1 (state source).

### M-UI-2: Server-authoritative agent roster
- **Goal:** roster reflects backend truth.
- **Features:** remove `INITIAL_AGENTS` seed in live mode; hydrate from `agent:init_list`; optimistic create with pending/failed state; status transitions from events; dedupe; orphan/"stale" markers; rename and metadata (tags, group).
- **Files:** `agentStore.ts`, `AddAgentModal.tsx`, `AgentPane.tsx`, `types/agent.ts`.
- **Acceptance:** with mock server returning 3 agents, store equals those 3; create failure rolls back and toasts; status event updates badge and triggers toast rule; unit tests for reducer paths.
- **Depends on:** M-INT-2, M-INT-3.

### M-UI-3: Workspace persistence and named layouts
- **Goal:** reload restores the session.
- **Features:** persist layout mode, window geometry, active agent, minimized state (zustand `persist`, versioned and migrated); save/load/delete named workspaces; per-host defaults; reset layout.
- **Files:** `agentStore.ts`, new `workspaceStore.ts`, `Toolbar.tsx`, new `WorkspaceMenu.tsx`.
- **Acceptance:** reload restores geometry for agents that still exist; geometry for missing agents is dropped without error; schema-version migration test; storage-unavailable path renders default layout.
- **Depends on:** M-UI-2.

### M-UI-4: Terminal quality and replay
- **Goal:** terminals behave like real ones across reconnect.
- **Features:** scrollback size setting; replay-from-sequence on reconnect (no duplicates/gaps); copy/paste, find-in-pane (xterm search addon); font/theme settings; pause/resume output; clear; resize debounce; unread indicator accuracy; WebGL renderer with canvas fallback.
- **Files:** `TerminalView.tsx`, `logBufferStore.ts`, new `SettingsModal.tsx`, `xterm-theme.css`.
- **Acceptance:** after forced reconnect, output sequence has no duplicate or missing chunk (test with seq numbers); find-in-pane works; 100 KB burst renders without dropped input in test harness.
- **Depends on:** M-INT-4.

### M-UI-5: Broadcast v2
- **Goal:** safe, observable fan-out.
- **Features:** target selection by group/tag/status/all; per-target delivery result (sent, failed, offline); snippet library and history; dry run preview; destructive pattern list editable; rate limit and confirmation threshold; undo hint (Ctrl+C to targets).
- **Files:** `BroadcastBar.tsx`, `DestructiveSafetyModal.tsx`, new `broadcastStore.ts`, new `SnippetLibrary.tsx`.
- **Acceptance:** result table shows one row per target with status; failed targets can be retried individually; destructive pattern always forces the modal; tests for each pattern class.
- **Depends on:** M-UI-2, M-INT-5.

### M-UI-6: Search v2
- **Goal:** find anything across agents, live and historical.
- **Features:** regex/case/whole-word toggles; agent, status and time filters; context lines around hit; jump-to-pane scrolls terminal to hit; ANSI-stripped indexing; server-side history search when `search` capability exists; saved searches; result virtualization.
- **Files:** `GlobalSearchModal.tsx`, `logBufferStore.ts`, new `searchService.ts`.
- **Acceptance:** 50k-line corpus search under 200 ms (benchmark test); invalid regex shows inline error; jump-to-pane focuses and highlights the match; falls back to local-only with notice when backend lacks capability.
- **Depends on:** M-UI-4, M-INT-6.

### M-UI-7: Alerts and notification center
- **Goal:** no important event is missed.
- **Features:** notification center with history and mark-read; per-agent and global rules (error, disconnect, idle-after-running, regex match in output); desktop notifications with permission flow; sound toggle; quiet hours; badge counts on roster.
- **Files:** `NotificationToastManager.tsx`, new `notificationStore.ts`, `NotificationCenter.tsx`, `Header.tsx`.
- **Acceptance:** rule match creates exactly one notification (debounced); permission-denied path degrades to in-app; history survives reload (bounded to N).
- **Depends on:** M-UI-2.

### M-UI-8: Keyboard-first and accessibility
- **Goal:** operate without a mouse; meet WCAG 2.1 AA for chrome.
- **Features:** command palette (Ctrl+K) for agents, layouts, broadcast, search; shortcut map and help overlay; focus management for modals; ARIA roles/labels on panes, roster, toasts; reduced-motion; high-contrast theme; light/dark.
- **Files:** new `CommandPalette.tsx`, `ShortcutHelp.tsx`, all modals, `globals.css`.
- **Acceptance:** axe run reports zero serious/critical on main views; every toolbar action reachable by keyboard; focus trap tests for each modal.
- **Depends on:** none (parallelizable).

### M-UI-9: Multi-capability agent model (tasks, cost, quota, sandboxes)
- **Goal:** surface what mads/mad/climah/cvm offer without hard-coding any one.
- **Features:** extend `Agent` with optional `kind`, `meta` (cost, tokens, quota, task, pipelineStage, sandboxState); capability-gated panels: Cost/Quota meters (mad, climah), Pipeline stage strip (climah), Task and handoff drawer with claim/checkpoint/rollback (mads), Sandbox lifecycle controls and fleet view (cvm: start/stop/snapshot, quota); Add-Agent wizard driven by backend-advertised `AgentSpec` schemas; unsupported panels hidden, not broken.
- **Files:** `types/agent.ts`, `AgentPane.tsx`, new `components/panels/{CostMeter,QuotaMeter,PipelineStrip,TaskDrawer,SandboxPanel,FleetView}.tsx`, `AddAgentModal.tsx`.
- **Acceptance:** with a mock adapter advertising only `terminal`, no extra panel renders; advertising `cost` shows meter fed by `meta` events; wizard renders fields from a JSON schema fixture; each panel has a test using fixtures from the shared contract.
- **Depends on:** M-INT-7 (capability negotiation), M-UI-2.

### M-UI-10: Settings, multi-backend and polish
- **Goal:** configurable without env vars; connect to several backends at once.
- **Features:** settings UI (backend URL(s), token, scrollback, theme, font, mock/demo); multiple backend profiles, agents tagged by backend; responsive layout (tablet); performance pass (memoization, pane virtualization offscreen); empty-state onboarding.
- **Files:** `SettingsModal.tsx`, new `backendStore.ts`, `Workspace.tsx`, `Header.tsx`.
- **Acceptance:** two profiles active show merged roster with backend badge; offline profile does not block the other; 20 panes sustain 60 fps scroll in profiling checklist (documented, not CI-gated).
- **Depends on:** M-INT-1, M-INT-7.

## 3. FE-BE integration milestones

### M-INT-1: Transport layer and reconnect
- **Goal:** replace the single-class socket with a `BackendAdapter` + `WsAdapter`.
- **Work:** extract `Transport` (connect, backoff with jitter, heartbeat ping/pong, max-retry, ConnState stream); `WsAdapter` implementing the contract; `MockAdapter` implementing the same interface; inject via a registry; remove silent mock fallback; resolve 8080/8088 drift via a single `VITE_BACKEND_URL` documented in README/RUNNING.
- **Files:** `src/services/transport/*`, `src/services/adapters/{WsAdapter,MockAdapter}.ts`, `agentSocket.ts` (deprecated shim).
- **Acceptance:** fake-timer tests show backoff sequence and cap; heartbeat timeout triggers reconnect; adapters pass the same shared conformance suite (M-INT-8); no code path sets mock mode on error.
- **Depends on:** none (first).

### M-INT-2: Auth and secure transport
- **Goal:** safe remote access.
- **Work:** token/bearer handshake (query-less: first message or subprotocol header); `wss://` enforcement for non-localhost; login/token entry UI hook; token storage policy (memory first, opt-in persisted); `auth_failed` state and re-prompt; logout clears buffers; origin and CSP docs. Support backend variants: static token (server/), RBAC token (cvm daemon).
- **Acceptance:** wrong token yields `auth_failed` and no reconnect storm; non-local `ws://` is refused with clear error; token never appears in URL or logs (test asserts); logout empties stores.
- **Depends on:** M-INT-1.

### M-INT-3: Agent lifecycle API
- **Goal:** create, list, kill, rename confirmed by the server.
- **Work:** request/response correlation (`reqId`) over WS or REST; `AgentSpec` kinds; idempotent create; timeouts; error codes mapped to UI messages; init_list hydration and resync on reconnect (diff against local).
- **Acceptance:** create resolves with server agent or rejects with typed error; after reconnect the roster resyncs with no duplicates; timeout path covered; contract fixtures for each error code.
- **Depends on:** M-INT-1.

### M-INT-4: Output streaming, sequencing and replay
- **Goal:** lossless, ordered terminal streams.
- **Work:** per-agent monotonically increasing `seq` on output chunks; client tracks last seq; `resume {agentId, fromSeq}` after reconnect; backpressure (client pause/resume or server drop-with-marker); batching and frame coalescing; bounded buffer policy aligned with `logBufferStore`; binary/encoding handling (UTF-8 split safe).
- **Acceptance:** chaos test (drop/reorder/duplicate frames) yields exact output; marker shown on unrecoverable gap; split multi-byte char test passes.
- **Depends on:** M-INT-1, M-INT-3.

### M-INT-5: Broadcast and input API
- **Goal:** acked fan-out.
- **Work:** `agent:broadcast` returns per-target result (`BroadcastResult[]`); input size limits; server-side rate limit errors surfaced; idempotency key to avoid double send on retry.
- **Acceptance:** partial failure reported per target; retry does not duplicate delivery (mock enforces key); oversize payload rejected client-side.
- **Depends on:** M-INT-3.

### M-INT-6: Search API
- **Goal:** server-side history search when available.
- **Work:** `search {query, regex, agentIds, from, to, limit, cursor}` with pagination; capability-gated; merge with local hits and dedupe by (agent, seq); cancellation.
- **Acceptance:** paginated results merge deterministically; cancelled query ignores late responses; absent capability uses local-only path.
- **Depends on:** M-INT-4.

### M-INT-7: Capability negotiation and meta events
- **Goal:** one UI, many backends.
- **Work:** `hello {protocolVersion, capabilities, agentSpecs}` handshake; version compatibility check with clear upgrade message; `meta` events (cost, quota, task, pipeline, sandbox) with schema-validated payloads (zod or equivalent); unknown fields ignored (forward compatible); gateway/adapters notes for mads, mad, climah (CLI/JSON) and cvm (REST daemon): each maps to the contract, documented in a table in the backend plan.
- **Acceptance:** unknown event types are logged and dropped without throwing; older/newer minor versions interoperate; capability set drives UI gating (M-UI-9).
- **Depends on:** M-INT-1.

### M-INT-8: Contract tests and shared schema
- **Goal:** FE and BE cannot drift.
- **Work:** move protocol to a standalone package or generated JSON Schema/TypeScript (replace relative import from `server/src/protocol`); golden fixture files per message; conformance suite run against `MockAdapter`, `WsAdapter` + in-repo mock WS server, and (optional, CI-gated by env) the real `server/`; breaking-change check in CI (schema diff).
- **Acceptance:** CI fails on an incompatible schema change; all adapters pass the same suite; fixtures validate both directions.
- **Depends on:** M-INT-1 (can start in parallel with a draft schema).

### M-INT-9: Offline mock and dev tooling
- **Goal:** full UI dev without any backend.
- **Work:** `mock-server` (scriptable WS server) with scenarios: normal, flaky, auth-fail, slow, large-output, partial-broadcast-failure; replaces `MockStreamGenerator` timers in app; `npm run dev:mock`; scenario selector in Demo mode; Playwright e2e running against the mock server.
- **Acceptance:** each scenario reproducible by seed; e2e covers create, type, broadcast, search, reconnect; `npm run test:e2e` green in CI.
- **Depends on:** M-INT-8 (schema), M-INT-1.

### M-INT-10: Error handling, observability, hardening
- **Goal:** diagnosable failures.
- **Work:** typed error taxonomy (network, auth, protocol, backend, timeout); central error reporter with ring-buffered diagnostics and "copy diagnostics" action; payload validation at the boundary (reject malformed frames without crashing); size caps; optional client metrics hooks; security review (XSS via terminal links, CSP, token handling).
- **Acceptance:** fuzzed malformed frames never crash the app; diagnostics export contains no tokens; security checklist signed off in docs.
- **Depends on:** M-INT-1..7.

## 4. Suggested ordering (GSD import format)

Phases are ordered by dependency; items on the same wave can run in parallel.

```
Milestone v2.0 "Live-Connected Command Center"
  Wave 1  Phase 1  M-INT-1  Transport layer and reconnect
          Phase 2  M-INT-8  Contract tests and shared schema      (parallel with 1)
          Phase 3  M-UI-8   Keyboard-first and accessibility      (independent)
  Wave 2  Phase 4  M-INT-3  Agent lifecycle API
          Phase 5  M-INT-2  Auth and secure transport
          Phase 6  M-INT-9  Offline mock and dev tooling
          Phase 7  M-UI-1   Resilient shell and connection UX
  Wave 3  Phase 8  M-UI-2   Server-authoritative agent roster
          Phase 9  M-INT-4  Output streaming, sequencing, replay
          Phase 10 M-INT-5  Broadcast and input API
  Wave 4  Phase 11 M-UI-3   Workspace persistence
          Phase 12 M-UI-4   Terminal quality and replay
          Phase 13 M-UI-5   Broadcast v2
          Phase 14 M-INT-6  Search API
          Phase 15 M-UI-7   Alerts and notification center
  Wave 5  Phase 16 M-UI-6   Search v2

Milestone v2.1 "Multi-Backend and Fleet"
  Wave 6  Phase 17 M-INT-7  Capability negotiation and meta events
          Phase 18 M-INT-10 Error handling, observability, hardening
  Wave 7  Phase 19 M-UI-9   Multi-capability agent model
          Phase 20 M-UI-10  Settings, multi-backend, polish
```

**Requirement IDs for import:** use milestone IDs as requirement keys (`INT-01..10`, `UI-01..10`). Gap-to-milestone map: G1 INT-1/UI-1; G2 UI-2/INT-3; G3 INT-2; G4 INT-4/UI-4; G5 UI-6/INT-6; G6 UI-3; G7 UI-9/INT-7; G8 UI-5/INT-5; G9 UI-7; G10 UI-8; G11 UI-1/INT-10; G12 INT-8; G13 INT-9; G14 UI-10.

**Recommended first slice (MVP):** Phases 1, 2, 4, 7, 8 deliver a UI that truthfully reflects a real backend. Everything after is additive.

**Risks:** protocol drift while the backend plan evolves (mitigate with INT-8 first); port/URL inconsistency (8080 vs 8088) resolved in INT-1; scope creep from multi-backend panels (gate behind capabilities, v2.1).
