# bilterm integration spike

Date: 2026-11-07. Status: research only. Nothing was compiled or run in either repo; every claim comes from reading source, and the headless-pump, single-consumer and no-`pane.write` claims were re-read for this document (see "Verified claims").
Repos: FE = `/home/bill/src/ui/agent-manager-fe` (browser UI + Node gateway), BT = `/home/bill/src/ai/bilterm` (v3.0.5, ~95k LOC Rust, read-only here).

## 1. Summary and recommendation

The two products have different shapes. bilterm is a terminal OS (VT parser, PTY owner, compositor, window manager) that also exposes a control plane. FE is a browser dashboard where xterm.js already does emulation and the browser does compositing. Most of bilterm's code is the emulator half, which has no meaning in a browser. What is worth sharing is the fleet/agent half: agent state, tmux/ssh lifecycle, broadcast selectors, find, messaging.

Neither of the user's two ideas is right as stated:
- Idea 1 as "make bilterm browser-runnable" is not feasible for the core (wasm32 blocked, see section 4), but a narrower form is: run bilterm `--headless` as a PTY/VT/agent-state host behind the gateway.
- Idea 2 as a full port duplicates tmux/ssh/reconnect/search semantics in a second language and would rot. A cherry-pick of about five small items is fine.

Recommendation, in order:
1. Now (days): run the bilterm TUI as one ordinary FE agent in a PTY pane. Zero code.
2. Phase 2 contract work: make the wire contract language-neutral (JSON Schema plus the existing golden fixtures, run from both repos) and extend capability negotiation. Cheap, useful whatever else happens.
3. Real integration: a `BilTermAdapter` in the gateway, behind the Phase 20 `BackendAdapter`, talking to `bilterm --headless --http` over its existing JSON-RPC/SSE transport, plus a small additive set of upstream bilterm changes (section 7). The gateway keeps hello/seq/replay/search/auth in the TS package.
4. Cherry-pick into FE: tag selectors, secret masking in search, jump-to-blocked, gateway MCP facade.
5. Do not: replace the Node gateway with bilterm, compile bilterm to wasm, napi-bind it, or port the compositor/playbooks/Studio.

## 2. What bilterm is

Single crate, lib + bin (`src/lib.rs`, `src/main.rs`), tokio, ratatui 0.30, crossterm 0.29, portable-pty, vt100-ctt, hand-rolled JSON (`src/api/json.rs`, no serde_json). Rule ARCH-R01..R04 in `CLAUDE.md`: all commands lower to `Action` then `WindowManager::apply`.

Seams that already exist:
- `trait TerminalBackend` (`src/vt/backend.rs:13`) with `GridSnapshot`/`CellSnapshot` value types (`src/vt/snapshot.rs`); no vt100 type crosses out of `src/vt`.
- `trait WorkspaceFrameRenderer` (`src/ui/renderer.rs:133`) with ratatui and GUI implementations. `--gui` rasterizes the same ratatui buffer to pixels; it is not a second UI.
- `WindowManager::new_headless` (`src/wm/mod.rs:231`) and `AutomationControlPlane::new_headless` (`src/api/rpc.rs`), used by the daemon and tests.
- `VtWorkerHandle` + `SharedGridSnapshot` (`src/vt/worker.rs:79,167`), documented as renderer-agnostic.
- A separate UI-attach daemon protocol (`DaemonRequest/Response`, `src/daemon/mod.rs:61,115`, Unix socket). Not byte streaming; completeness unverified.

Seams that do not exist: no `Frontend` input/output trait (`App::run`, `src/app.rs:49-99`, is typed to crossterm; `src/input/*` consumes crossterm events), no `PtyBackend` trait (`CompositePane` owns `portable_pty` types, `src/pane/mod.rs:157-195`), no feature gate separating TUI from core (`wm/mod.rs:73-74` imports ratatui). No plugin system in code; extension is TOML playbooks, themes and agent profiles.

Control plane. `AutomationControlPlane` (`src/api/rpc.rs:69`) owns a `WindowManager` and a 512-entry `events: VecDeque<AutomationEvent>`. One dispatch table (`src/api/rpc_dispatch.rs:26-495`) serves every transport:
- JSON-RPC 2.0 over Unix socket or TCP (`src/api/server.rs`; TCP needs `--token-file`, non-loopback needs `--allow-remote`). Client: `bilterm ctl`.
- HTTP+SSE (`src/api/http.rs`, `--http ADDR` with `--headless`): `GET /health`, `POST /rpc`, `GET /events` (text/event-stream); loopback only, random bearer token in a 0600 file. No WebSocket.
- MCP over stdio only (`src/api/mcp.rs`, `--mcp`): 17 tools at `mcp.rs:155-300` (workspace_status, exec_command, inspect_pane, send_keys, colon_command, run_playbook, fleet_exec, agents_list, agent_mail, find, session_map, daemon, ...) and resources `bilterm://state`, `pane/{id}`, `agent/{name}/inbox`. No MCP over HTTP/SSE.
- `--headless`/`--daemon` (`src/main.rs:252`): real PTY panes without a TTY, optional session restore. First-class, but see the pump bug below.
- Methods relevant to FE: `workspace.status/snapshot`, `pane.exec/read/feed_output/send_keys`, `wm.command`, `events.poll`, `remote.connect_ssh/connect_tmux`, `fleet.register/list/exec`, `agents.list`, `find.*`, `session.*`, `agent.name/send/broadcast/inbox/ack/list/wait`.
- Events (`src/api/playbook.rs:14-57`): CommandSubmitted, CommandCompleted, TriggerMatched, NotificationReceived, EchoLockChanged, AlternateScreenChanged, AgentMessage, AgentStateChanged. Structural only, no bytes, no timestamps.

## 3. Option evaluation

Effort S <1 wk, M 1-3 wk, L 3-6 wk, XL >6 wk. "Dup" = duplicated logic left between the repos.

| Option | Effort | Risk | Maintenance | Dup | Verdict |
|---|---|---|---|---|---|
| 1a. Rust WS gateway replaces Node (bilterm serves `/ws` + `/api/*`) | L | H | H | Contract validators, seq/replay, auth rewritten in Rust; cvm/climah/mads/tmux adapters (Phases 24-26) orphaned | Reject now. Long-term only if "Rust-only" becomes a goal, and then via the adapter route |
| 1a'. Rust stream API behind the Node gateway (a2) | M-L | M | M | Low | Same bilterm work as 1b-patched plus a new WS stack; prefer 1b-patched |
| 1b0. Adapter over existing HTTP/SSE or MCP, no bilterm changes | S-M | M | L | None | Read-only text mirror only: `pane.read` polling loses colors, cursor, alt-screen |
| 1b1. Adapter plus ~300-500 LOC additive bilterm changes | M | M | L | None | Recommended real integration |
| 1c. bilterm core to wasm32, React draws the grid | XL | H | H | VT+WM now in browser and server | Reject (blockers in section 4) |
| 1d. TUI in a PTY pane (ttyd style) | S | L | L | None | Do now. FE sees one agent per bilterm; inner agents invisible; nested multiplexers |
| 2a. Full port of bilterm into FE/gateway | XL | H | H | Highest: tmux -CC, ssh, reconnect, masking, messaging rules in two languages | Reject |
| 2b. Cherry-pick (tag selectors, masking, jump-to-blocked, MCP facade, maybe messaging) | S-M | L | L | Small, rule-level | Do, within existing phases |
| 3a. tmux as shared session layer (both UIs attach to same tmux) | S-M | L-M | L | tmux control-mode client in both; status inference | Good default topology for tmux agents; cannot carry cvm/climah/mads |
| 3b. Language-neutral contract + shared golden fixtures run from both repos | S-M | L | L | Removes type/wire drift, not logic | Do regardless |
| 3c. Capability negotiation (client and server advertise) | S | L | L | None | Do; lets partial implementations stay conformant |
| 3d. Gateway MCP facade using bilterm's tool names | M | L | L | Vocabulary only | Do later; automation plane, not UI transport (MCP has no ordered byte streams) |
| 3e. Shared Rust core crate (napi-rs or sidecar) | L-XL | M-H | M | Low once extracted | Reject napi (build matrix, crash coupling). Sidecar equals 1b; extraction of a core crate is the real cost |

## 4. Where the findings disagree, and how it was resolved

- wasm: A and B agree it is infeasible (portable-pty, tokio "full", crossterm, libc, Unix sockets, 108 `cfg(os)` sites, no wasm cfg anywhere; `WindowManager` owns the PTY). C does not consider it. Even if it compiled, the shell must stay server-side, so a byte protocol is needed anyway and xterm.js features (selection, IME, search, links) would be lost. Resolved: reject. Compile feasibility itself was not tried.
- MCP tool count: C says "11+" (from the README), A counted 17 at `mcp.rs:155-300`. Resolved: use 17 (source over README); README also mentions `bilterm_run_action`, not seen in the tool list.
- Is a streaming endpoint present: C left it as an open question; B states there is none. Resolved by reading `http.rs`: SSE only republishes drained `events.poll` items, and `rpc_dispatch.rs` has no `pane.write`/stream method. No byte stream exists.
- Default topology: C ranks "tmux shared layer + contract + capabilities, no port" first and the bilterm adapter third; B ranks "TUI in a pane" then "headless bilterm adapter". Resolved: these are compatible. tmux sharing needs no work for tmux-mode agents, but only an adapter surfaces bilterm's own agent state, find and mail, and only an adapter reaches non-tmux backends. So the tmux path is the baseline, the adapter is the integration, and neither blocks the other.
- bilterm as gateway: C keeps it as a long-term target, B rejects it. Resolved: defer. If ever done, it arrives as an adapter that grows, not a rewrite, so the near-term work is identical.
- Event consumption: A noted SSE and events are loopback/bearer protected and "no CORS seen"; B states Origin/Host checks exist. Not re-verified; irrelevant because the browser never talks to bilterm directly (token stays in the gateway).
- Agent entity: A says there is no single Agent entity (agent = pane with derived state); B treats `AgentState` as mapping "cleanly". Resolved: both true. Mapping is clean for status, lossy for identity (section 6).

## 5. Verified claims (read in BT for this document)

1. Headless pump bug: confirmed. `serve_loop` (`src/api/server.rs:480-525`) selects only on `acceptor.accept()`, `req_rx.recv()` and a waiter tick (`wait_tick`, only when waiters exist). There is no `poll_all_ptys` call under `src/api/`. `WindowManager::poll_all_ptys` is defined at `src/wm/mod.rs:784`; callers are the TUI loop (`app.rs:88` via `app.rs:101`), the GUI loops (`gui_window.rs:566`, `gui_macos.rs:675`, `linux_x11.rs:822`) and tests (`tmux/mod.rs:897-926`). Consequence: a headless daemon can spawn panes but PTY output is never ingested.
2. `events.poll` single consumer: confirmed. `rpc_dispatch.rs:267-280` defaults `drain=true` and calls `self.events.drain(..)`; `push_event` (`rpc.rs:255-259`) caps the ring at 512 and drops the oldest. `serve_sse` (`http.rs:404`) loops on `events.poll {drain:true}`, so SSE and any other poller steal each other's events. `drain:false` exists but returns the whole ring each time with no cursor.
3. No `pane.write`: confirmed. `pane.*` arms are only `pane.exec` (:33), `pane.read` (:88), `pane.feed_output` (:173), `pane.send_keys` (:189). `send_keys` takes chords for the active pane; there is no raw-bytes, per-pane write, no per-pane resize, no spawn/kill by id.
4. Not independently re-read (taken from findings): the output tap point `pane/mod.rs:727-745`, `write_to_pty` at `pane/mod.rs:769`, the Phase 20 interface being absent from the gateway, and all FE-side citations.

No claim was found wrong. One precision: `poll_all_ptys` exists both on `WindowManager` (`wm/mod.rs:784`) and as an `App` wrapper (`app.rs:101`).

## 6. Data model mapping

FE `Agent` (`packages/protocol/src/agent.ts`): id, name, mode `tmux|ssh`, targetHost, status `idle|running|thinking|error|disconnected`, unreadOutput, layout (float rect, zIndex, isMinimized), createdAt, lastActivity.

| FE field | bilterm source | Notes |
|---|---|---|
| id | none stable | `PaneId = usize` (`pane/mod.rs:43`) is per-workspace and not stable across sessions. Adapter owns a map `(daemon, session, pane_id) <-> agentId` and handles pane reaping (`wm/mod.rs:784` reaps exited panes when more than one) |
| name | `agent.name` alias (`agent_mail` registry) or pane title | Alias is stable per pane |
| status | `AgentState` (`wm/agent_state.rs:33`): Working, Blocked, Idle, Done, Errored | Working -> running/thinking, Idle -> idle, Errored -> error. Blocked and Done have no FE value; Blocked maps best to an "attention/needs input" signal. `disconnected` comes from tmux link banner / `FleetNode.connected`, not `AgentState`. State is classified heuristically from `AgentSignals`; `AgentStatus.reported` says whether the agent reported it |
| mode / targetHost | pane `remote_target`; `FleetNodeKind::{SshPane, SshTmux, HostProfile}` (`remote/mod.rs:249`) | Add `mode: 'bilterm'` via `BackendInfo.agentSpecs`; spec says consumers must tolerate unknown modes |
| unreadOutput | agent mail unread (`wm/agent_mail.rs:193`) or notifications | Not output-based in bilterm |
| layout | `FloatingWindowGeometry` in `z_geometries` (`wm/session.rs:82`) | FE layout is FE-owned; do not sync from bilterm. No minimized flag |
| createdAt / lastActivity | only `since_ms` on `AgentStatus` | Adapter stamps its own times |
| tags / groups (FE has none yet) | tags on `FleetNode` only; hierarchy via `SessionTree` | Source for Phase 12/15 selectors |
| mail | `AgentMessage` (8 KiB body, 64 inbox, 8 hops, 32 msg/min) | Surface as `agent:meta` or toast; not an Agent field |

## 7. Staged path (FE ROADMAP phases and upstream bilterm changes)

FE phases referenced are in `.planning/ROADMAP.md`: Phase 2 shared protocol and fixtures (merged work in progress), 6 lifecycle API, 8 auth, 11 output streaming/seq/replay, 12 broadcast API, 19 capability negotiation, 20 gateway `BackendAdapter` refactor (depends on 11 and 19), 22 multi-capability agent, 23 profiles, 24-26 cvm/climah/mads adapters.

Stage 0, now, no phase needed: run `bilterm` as a `tmux`-mode agent (or `initialCmd`) in a normal pane. Validates xterm.js fidelity with kitty keyboard, mouse, OSC52, sixel (xterm.js lacks kitty keyboard and full sixel).

Stage 1, alongside Phase 2: add JSON Schema emission from `packages/protocol` and a cargo-test fixture runner on the BT side that replays `packages/protocol/fixtures/*.json`. Pin fixtures by tag (separate repos, no submodule churn). Extend Phase 19 so clients also advertise capabilities in `hello`.

Stage 2, upstream bilterm (can run in parallel with FE Phases 6-12, no FE dependency):
- BT-1: fix the headless pump. Add a tick arm to `serve_loop` (`src/api/server.rs:497-520`) calling `plane.wm.poll_all_ptys()`; add a regression test using `new_headless`.
- BT-2: output stream. Tap in `CompositePane::ingest_pty_events` (`src/pane/mod.rs:727-745`) feeding a `tokio::sync::broadcast<PaneOutput{pane_id, seq, bytes}>` through an output-sink trait with a no-op default; replace the drain-once ring with per-subscriber cursors (broadcast subscribe) so TUI, SSE, MCP and the gateway coexist; add `GET /stream?pane=N&from=SEQ` (SSE/NDJSON, base64 bytes) in `src/api/http.rs`. Mind `MAX_RPC_LINE_BYTES` and the 1 MiB HTTP body cap.
- BT-3: input and lifecycle. `pane.write {pane_id, data_b64}` -> `write_to_pty` (`pane/mod.rs:769`, keep the password-prompt guard used on the `send_keys` path); `pane.resize {pane_id, cols, rows}` with a fixed-size/detached pane flag so layout does not override; `pane.spawn {cmd, cwd, env}` and `pane.kill` returning stable ids; `agents.list` adds id, `AgentState`, last-activity.
- BT-4 (optional, only if reuse beyond headless is wanted): `PtyBackend` trait so `CompositePane` stops owning `portable_pty` types; `Frontend` trait over bilterm-owned `UiEvent` replacing direct crossterm use in `app.rs:132` and `src/input/*`; cargo feature `tui` gating ratatui/crossterm/`ui/*` and `wm/mod.rs:73-74` imports; later a workspace split into core/api/tui/gui. Multi-week; not needed for stages 3-4.
- Any WS support, if wanted, goes behind an optional `ws` feature; `deny.toml` exists, audit new deps.

Stage 3, FE Phase 20 (after 11 and 19): extract `BackendAdapter` from `server/src/services/SessionManager.ts:9,111-119` (gateway currently hardcodes `TmuxDriver | SshDriver`). Then add `server/src/adapters/BilTermAdapter.ts`: reads bilterm's token from the runtime dir (never forwarded to the browser), maps state per section 6, declares capabilities `input,resize,kill,history,broadcast`, reuses gateway seq/ring/replay (do not duplicate in Rust), handles UTF-8 chunk boundaries. Before BT-2/3 land, a read-only variant (1b0) can ship under a capability set omitting `input` and `resize`, as spec s9.3 allows for text mirrors.

Stage 4, Phases 22-26: bilterm adapter rides on multi-capability agents; replay golden fixtures through it against a headless bilterm in CI.

Stage 5, cherry-picks, each inside an existing phase: tag selectors (Phases 12/15), secret masking in search and history (Phases 16/18, security value), jump-to-blocked and attention nav (Phases 10/17), gateway MCP facade reusing bilterm tool names (after Phase 21). Agent-to-agent messaging only if web swarm orchestration becomes a goal; hop and idle-only-nudge rules are subtle.

Gate between stages: do a one-adapter spike first (list + read + exec against `agents.list`, `pane.read`, `pane.exec`) before investing in BT-2/3.

## 8. Open questions and risks

- Nothing was compiled or run in either repo. All effort figures are estimates from reading; wasm blockers come from `Cargo.toml` and grep, not a build attempt.
- Unverified: daemon `Attach` protocol completeness; whether per-pane resize can bypass WM layout; whether discovery of existing tmux sessions exists in bilterm (attach is by name); HTTP Origin/CORS behavior.
- The pump bug is the biggest "looks supported, isn't" trap: any prototype against headless bilterm without BT-1 shows empty panes.
- Two identity systems (FE `agentId` vs bilterm `PaneId`/name); mapping and reaping bugs are likely.
- Heuristic status: `AgentState` is inferred, so FE status badges for bilterm agents may flap; surface `reported` and consider debouncing.
- Upstream dependency: BT changes need bilterm's maintainer cadence, and bilterm is read-only from this repo. Ask whether the same person owns both; if not, the 1b0 read-only path is the fallback.
- Terminal fidelity for stage 0: kitty keyboard and sixel gaps in xterm.js; nested multiplexer UX.
- Security: bilterm's bearer token and loopback-only HTTP must stay behind the gateway (Phase 8 auth); fleet.exec/broadcast through the adapter must go through the gateway's rate limits.
- Duplication that remains even in the recommended path: tmux control-mode handling (gateway TS driver vs bilterm Rust) and agent-status inference. Mitigation is fixtures, not more porting.
