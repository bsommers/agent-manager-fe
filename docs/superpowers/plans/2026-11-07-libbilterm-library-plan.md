# libbilterm Library Plan (how we would do it)

Status: proposal, 2026-11-07. Basis: read-only analysis of `/home/bill/src/ai/bilterm` v3.0.5 (95.5k LOC Rust, single crate, `src/lib.rs:1-20` flat `pub mod`) plus the earlier spike (A/B/C). Not built or run; line counts come from grep, so treat coupling numbers as lower bounds. Companion: `docs/superpowers/specs/2026-11-07-libbilterm-benefits.md`. Milestone: v2.2 in `.planning/ROADMAP.md` (Phases 27-34).

## 0. Bottom line

- Do NOT start with a full library. Start with upstream fixes that the v2.1 BilTerm adapter needs anyway (headless pump, output stream, pane write/resize/spawn), a sidecar adapter, and shared fixtures. Then run a go/no-go gate (section 8). Only on GO do the workspace split.
- The split does not follow existing seams: `WindowManager` (`src/wm/mod.rs:133`) is a god object, and wm, ui, input, colon_command, action, api and config form one strongly connected cycle. The work is breaking that cycle, not moving files.
- Recommended binding order: (1) sidecar JSON-RPC/HTTP+SSE, (2) golden fixtures + JSON Schema, (3) wasm32 pure subset, (4) thin JSON-string C ABI, (5) napi-rs / PyO3 only on demand.

## 1. Crate layout

```
bilterm (bin) -> tui, gui(opt), api, fleet, pty
bilterm-gui   -> tui (ratatui Buffer)            [feature "gui"]
bilterm-tui   -> core, ratatui, crossterm        (ui/, input/, app.rs, mcp_console UI)
bilterm-api   -> core, fleet?, tokio             (AutomationControlPlane, JSON-RPC, HTTP+SSE, MCP); NO ratatui/crossterm
bilterm-fleet -> core, pty                       (remote/, tmux/ parser+transport)
bilterm-pty   -> core, portable-pty, libc        (PtyBackend impl)
bilterm-core  -> serde, toml, vt100-ctt, ...     NO ratatui / crossterm / portable-pty / tokio runtime
```
Core holds: vt, style vocabulary, own `Rect`/`Color`/`Key` types, Action/AppAction, colon_command parse, config, the WindowManager model (split_tree, session, agent_state/mail, registry), pane model, `PtyBackend`/`PtyHandle` traits. Open choice: a separate `bilterm-wm` crate between core and api keeps core wasm-clean (vt + style + geometry only). Recommended: yes, eight crates, because the wasm subset is the high-value artifact.

## 2. Module to crate map (evidence)

| src module | LOC | Target | Evidence / blocker |
|---|---|---|---|
| secure_fs, error, clipboard | 616/137/442 | core | leaves; `error.rs` imports crossterm/ratatui (TerminalRestoreGuard, error.rs:28+) so it moves to bin/tui |
| vt/ | ~6.5-7.2k | core | `vt/snapshot.rs:3,138-345` ratatui leak (`to_ratatui_*`), `vt/recording.rs:5-6`, `vt/worker.rs:31` uses `pty::PtyConfig`, `vt/mod.rs:35` re-exports `Osc133Phase`; `ghostty-vt` stays opt-in |
| pty/mod.rs `PtySession` | 325 | pty | concrete only (`pty/mod.rs:105` spawn); methods at `:196-294` become the `PtyHandle` trait |
| pty/line_discipline, shell_integration | ~0.6k | core | pure state machine, `cfg(unix)` |
| pane/ | ~9-10k | split | `CompositePane` (`pane/mod.rs:49`) owns `vt` (:52) and `pty: Option<PtySession>` (:53); prompt/copy-mode/typography/highlight are UI (`pane/highlight.rs:1-2`, `mod.rs:32`); `modes.rs:657` pulls `input`, `completion.rs:684` pulls `remote` |
| wm/agent_state.rs | 592 | core (classifier+tracker) | `classify()` (:117) is pure over `AgentSignals`; `collect_signals/scan_tail` (:258-336) take `&CompositePane`; WM glue at :393-489 |
| wm/ rest | ~17k | core model + tui widget state | 23 files import ratatui as data (`session.rs:7`, `split_tree.rs:1`); wm->ui 43 refs; `wm/mod.rs:78,81` colon_command/AppAction; `agent_mail_apply.rs:5` uses `api::JsonValue` (upward dep) |
| action.rs, colon_command/, command_registry.rs | 995/6.8k/569 | core | `action.rs:7-10,69-80` import `ui` style enums; ARCH-R04 (all commands lower to Action -> `WindowManager::apply`) |
| config/ | 1.1k | core | `config/mod.rs:16-20` imports `ui` enums (inverted direction), `:603` ratatui Color |
| remote/ | 528 | fleet | pure data; `remote/mod.rs:17` PaneId. Easiest fleet piece |
| tmux/ | ~2.1k | fleet | `tmux/mod.rs:10 use crate::wm::WindowManager` (cycle); glue in `wm/tmux_link.rs`, `tmux_io.rs` stays in core behind a `TmuxHost` trait |
| daemon/ | 1.6k | api/fleet | supervisor lock and registry are WM-free; attach server needs WM |
| api/ | ~5.5-5.8k | api | `AutomationControlPlane` `rpc.rs:69`; `rpc.rs:11` GuiWorkspaceRenderer, `rpc_dispatch.rs:12` AppAction, `mcp.rs:5` crossterm KeyEvent |
| input/ | ~8-9k | tui (key encoding to core) | `input/encode.rs` reusable by `send_keys`; input->wm 115 refs |
| ui/ (non-gui) | ~25k | tui | style vocabulary (theme, glyphs, chrome, cursor, typography) moves to `core::style` |
| ui/gui_* , raster | ~8k | gui | rasterizes the same ratatui Buffer; `gui = []` feature is empty |
| mcp_console/, app.rs, launcher.rs, main.rs | 811/155/329/518 | tui / bin | `app.rs` single `select!` loop |

## 3. Cycles and the refactors they need (ranked)

1. Style enums: config/action/wm import `ui::*` (`config/mod.rs:16-20`, `action.rs:7-10`). Move pure enums/parsers to `core::style`; leave `pub use` shims in `ui`.
2. ratatui/crossterm as data types (error.rs, 23 wm files, split_tree.rs:1, api/mcp.rs:5). Core owns `Rect`, `Rgb`, `KeyEvent`; From/Into impls live in tui. Interim: ratatui with `default-features=false` is acceptable in core only if time-boxed; crossterm must go.
3. wm <-> input/colon_command/action. Put Action, AppAction, colon parse/execute and the WM model in the same crate (cycle becomes legal); input keymap/mouse go to tui.
4. tmux -> wm (`tmux/mod.rs:10`): `TmuxHost` trait implemented by WM.
5. pane -> input (`modes.rs:657`), pane -> remote (`completion.rs:684`): inject by closure or move the function.
6. CompositePane owns PtySession (`pane/mod.rs:53,181`): `trait PtyBackend`/`PtyHandle`; field becomes `Option<Box<dyn PtyHandle>>`. The `Option` already exists (ctor `mod.rs:115`), and the no-PTY path doubles as the browser/remote backend (`pane.feed_output`).
7. api -> ui renderer (`rpc.rs:11`): move the existing `WorkspaceFrameRenderer` trait to core, impls in tui/gui.
8. wm -> `api::JsonValue`: move `api/json.rs` (422 LOC, dependency-free) to `core::json`.
9. wm owns `DaemonServerState`/`McpConsoleState` (`wm/mod.rs:211,213`): console state becomes core data; panel stays tui.
10. agent_state tied to CompositePane: take plain `AgentSignals` (tail string, osc133, alt_screen, echo_lock) behind a `PaneIntrospect` trait. This seam alone is estimated 1-2 weeks and is the gate spike (Phase 30).
11. Frontend/UiEvent: `trait Frontend { poll_events(); render(&WorkspaceSnapshot) }`, `UiEvent = Key|Mouse|Resize|Paste|Tick`, only for `app.rs`. `handle_wm_key_event` (`rpc_dispatch.rs:12`) is the non-crossterm proof of concept.
12. Misc: gate `vt::worker` behind feature `worker` (threads, not wasm), `cfg(unix)` on launcher/secure_fs bits.

Feature gates: core `ghostty-vt`, `worker`, `unix-fs`; pty tokio `["sync","rt"]` (today `features=["full"]`, Cargo.toml); fleet `["process","io-util","time","rt"]`; api `["net","io-util","rt-multi-thread","time","sync"]`; tui `rt,macros,sync,time` plus ratatui 0.30 / crossterm 0.29.

## 4. Migration steps (strangler, bilterm shippable at each step)

Gate at every step: full `cargo test` (about 140 integration tests under `tests/` use `bilterm::` paths) and `cargo build` green. Keep a `bilterm` facade crate re-exporting `pub use bilterm_core::*` so old paths compile until step 13.

| # | Step | Size |
|---|---|---|
| 0 | Upstream fixes (section 5): headless pump, pane.write/resize/spawn, output stream with cursors. No restructuring | S+M+L |
| 1 | Cargo workspace root; existing crate becomes a member; empty crates added | S |
| 2 | Extract leaves secure_fs, error (strip crossterm/ratatui), clipboard to core | S |
| 3 | Style vocabulary to `core::style`; ui re-exports. Removes cycle 1 | M |
| 4 | Own Rect/Color/Key types; From impls; sweep 23 wm + 24 input files per file group. Riskiest mechanical step | L |
| 5 | vt/ plus PtyConfig/PtyEvent/Osc133Phase to core; ratatui conversions become tui extension trait | M |
| 6 | `PtyBackend`/`PtyHandle` in core; `PtySession` in pty crate; Mock/Null backend | M |
| 7 | Split pane/ into model (core) and UI state (tui) | L |
| 8 | Action, AppAction, colon_command, config, json.rs, WM model, agent_state/mail to core (or `bilterm-wm`) | L, risk |
| 9 | bilterm-fleet: remote/ + tmux/ parser/transport; `TmuxHost` trait | M |
| 10 | bilterm-api over core; `FrameRenderer` trait. First real headless artifact (no ratatui, no crossterm) | M |
| 11 | bilterm-tui: ui/, input/, app.rs, `Frontend`/`UiEvent` | L |
| 12 | bilterm-gui behind feature `gui` | M |
| 13 | Slim bin; move tests per crate; drop facade | M |

Milestone cut: after step 10 the headless path (core + pty + fleet + api) serves agent-manager-fe; steps 11-13 only reorganise the TUI and can be deferred. Steps 3, 4, 8 carry the risk. CI guard: `cargo tree -p bilterm-core | grep -E "ratatui|crossterm|portable-pty"` must be empty (`deny.toml` already exists).

## 5. Architecture changes

| Area | Current (file:line) | Change | Size |
|---|---|---|---|
| Headless pump bug (P0) | `serve_loop` `api/server.rs:480-525` selects only accept (:501), request (:515), wait_tick (:518); never calls `wm.poll_all_ptys()`. Only callers: `app.rs:88`, `ui/gui_window.rs:566`. PTY bytes never reach `ingest_pty_events` (`pane/mod.rs:723`), so headless `pane.read` is blank | Add pump arm (8-16 ms interval, `MissedTickBehavior::Delay`) or wake on PTY notify. Regression test in `tests/api_server_edges.rs`: spawn `printf hi`, assert `pane.read` shows it | S |
| Output streams | events ring cap 512, silent drop (`api/rpc.rs:71,256`); `events.poll` drains (`rpc_dispatch.rs:267-275`) so two consumers steal events; SSE `serve_sse` `http.rs:404-416` uses a per-connection seq; output bytes not tapped | Global monotonic `seq`; per-pane byte ring (about 1 MiB, `base_seq`); `subscribe(pane, from_seq)` yielding Output/Gap/Exit; slow subscriber gets Gap and never blocks the pump; non-draining `events.poll {cursor}`; `GET /stream?pane=N&from=SEQ` with `Last-Event-ID`. Tap before coalescing at `pane/mod.rs:723-745` | L |
| pane.write/resize/spawn | only `pane.exec` (`rpc_dispatch.rs:33`), `pane.read` (:88), `pane.feed_output` (:173), `pane.send_keys` (:189) | `pane.spawn`, `pane.write` (base64, 64 KiB cap), `pane.resize` (1..=1000), `pane.kill`, `pane.snapshot` for late join | M |
| Typed errors | `BiltermError` 4 stringly variants (`error.rs:13-25`); `color_eyre` leaks across lib boundary | `#[non_exhaustive] Error` with stable `code()` mapping to JSON-RPC codes and the protocol error codes; eyre only in bin | M |
| Runtime neutrality | `tokio features=["full"]`; core needs only `sync` (`pty/mod.rs:13`, `api/agent_wait.rs:17`) | `tokio::sync` only in core; feature `net-tokio` for api; `Stream`-style `Subscription` | M |
| Semver | 20 modules all `pub` (`lib.rs:1-20`) | `pub(crate)` first, curated facade (`Engine`, `Pane`, `PaneId`, `Error`, `Event`); libbilterm 0.x; wire protocol versioned separately and additive-only; `cargo-semver-checks`, `#[non_exhaustive]` | M |
| Observability | about 23 `tracing::` sites; library installs subscriber | Library never installs a subscriber; spans `rpc{method,id}`, `pane{id}`; counters incl. ring drops; `system.stats` and loopback `/metrics` | M |
| Security | good base: 0700/0600 helpers, constant_time_eq (`secure_fs.rs:272`), peer_cred (`server.rs:347`), loopback + token (`http.rs:64-96`). Gaps: unix-only token generation (`http.rs:73-79`), no scopes | Token scopes read/write/spawn, spawn allowlist and cwd jail, `getrandom`, connection and rate caps, audit log, fuzz `api/json.rs` and the HTTP parser; gateway keeps token server-side | M |
| Docs | no crate docs; `docs/API.md` lacks versions | Doctested crate docs, drift test that every method in the RPC table appears in API.md, STABILITY.md, MIGRATION.md | S/M |

## 6. Bindings (ranked by maintenance cost, lowest first)

1. Sidecar (`bilterm --headless --http`): exists today; cost is supervision and version pinning. Gateway touchpoints: `server/src/services/SessionManager.ts` (driver Map, `handleClientMessage`), `TmuxDiscovery.ts`, `TmuxDriver.ts`/`SshDriver.ts` (reconnect and hydrate that `remote.link`, API.md:517, already does), `server/src/index.ts` (supervisor, token stays server-side), `server/src/config.ts` (`BILTERM_BIN`, `BILTERM_MODE=sidecar|off`), `packages/protocol/src/http.ts` (health `backend` field). Needs push events not poll-drain SSE.
2. Golden fixtures + JSON Schema: a contract, not a binding; lowers the cost of every other row.
3. wasm32 pure subset (vt snapshot/scan, classifier, fleet selector, masking): one artifact for browser, Node and tests. Unverified that the subset compiles for `wasm32-unknown-unknown`.
4. Thin C ABI (cbindgen): `bt_scan(bytes)->json`, `bt_classify(json)->json`, `bt_free`; never expose Rust structs.
5. napi-rs: per-platform prebuilt matrix; only if profiling shows wasm or the sidecar too slow.
6. PyO3: no in-repo Python consumer; Python users get HTTP or ctypes over (4).
Rule: one source of truth in Rust; every binding is thin and passes the same golden fixtures. Never hand-port logic into a binding.

## 7. Contract and testing

- packages/protocol already has language-neutral fixtures (`fixtures/{client,server,http,invalid}.json`, `src/__tests__/conformance.test.ts`). Add `fixtures/fleet/*.json` of the same shape: `agents.list`, `fleet.list/exec`, `find.*` envelope, SSE records, classifier input->state vectors, scan(bytes)->events, masking vectors. Generate from real bilterm output (`BLESS=1` test), reviewed in diff. Rust consumes via `tests/contract.rs`; TS via a `fleet.conformance.test.ts`.
- JSON Schema 2020-12 generated from the FE FieldSpec tables (`src/fieldspec.ts`), checked in, CI fails on `git diff` after regeneration (same idea as the Phase 2 drift guards). Pin integer fields (`pane_id`, `since_ms`) as `integer`; closed enums with an explicit unknown bucket; additive-only; integer `contract` version in the handshake.
- Status mapping lives in one gateway adapter with its own fixtures: bilterm `working|blocked|idle|done|errored` (API.md:1101-1127) versus FE `idle|running|thinking|error|disconnected` (`packages/protocol/src/agent.ts:5`); `blocked` has no FE equivalent, `disconnected` has no bilterm one. Needs a protocol contract bump and a capability flag.
- VT golden corpus (`.bin` byte streams to expected screen JSON) replayed against vt100-ctt and ghostty; proptest for escape sequences; shared conformance cases for pane.spawn/write/resize/stream/gap run by both the Rust suite and the FE adapter tests.

## 8. Go/no-go (from the benefits analysis; ALL must hold for the leaf crate, all plus #5 for the full library)

1. At least 2 independent consumers commit to in-process embedding. Today 0 of 4 checked (climah, mads, mad, cvm use no terminal or PTY code).
2. Sidecar measured inadequate: gateway bridge p95 event latency above 100 ms, or above 5% classification disagreement on a 200-sample recorded corpus.
3. Seam spike: `agent_state.rs` decoupled with zero `crate::pane`/`crate::wm` imports, diff at most 1.5k LOC, full suite green, at most 5 working days.
4. Core builds for wasm32 or napi with no tokio/libc/portable-pty and under 300 KB gzipped.
5. Maintainer capacity of at least 4 uninterrupted weeks, semver on leaf crates only, binding upkeep at most 1 day/month for 2 releases.
6. Leaf API unchanged for 3 months of git history.
NO-GO if criterion 1 fails, the slice needs more than 15k LOC touched, or ratatui cannot be removed from the leaf.
Fallback if NO-GO: stay on sidecar plus fixtures, or copy-port the classifier to TS with Rust-generated golden vectors (about 3 days).

## 9. Risks

1. Single maintainer (579 of 592 commits): lib plus bindings multiplies release surface.
2. Steps 4 and 8 (types sweep, WM move) can regress behaviour across a large 140-test suite; WindowManager placement is a judgement call.
3. API freeze on a fast-moving v3.0.5 codebase slows bilterm; mitigate with 0.x, facade-first, leaf-only semver.
4. Poll-drained single-consumer events: gateway must be the sole consumer until cursors land.
5. Cross-repo version skew between bilterm and `packages/protocol`; mitigate with fixture pinning and `contract` handshake.
6. Per-user daemon shape: multi-tenant gateways need one sidecar per backend profile (Phase 23) or a pane namespace policy; pane ids are workspace-local `usize`.
7. Bindings: napi/PyO3 platform matrices are a permanent tax; `ghostty-vt` needs Zig and Rust 1.90, keep it out of the core subset.

## 10. Open questions

- Separate `bilterm-wm` crate or WM in core? (recommended: separate.)
- Hand-rolled `api/json.rs` or `serde_json` behind a feature for FFI ergonomics?
- Does the pure subset really compile for `wasm32-unknown-unknown`? (unverified; part of Phase 32.)
- Who executes upstream bilterm phases? The roadmap's Out of Scope forbids GSD plans editing the external mads/mad/climah/cvm repos; bilterm is not listed there but is likewise external. Proposed: Phases 27 and 30-33 are executed in the bilterm repo by its owner, and this repo's phases only assert acceptance via fixtures.
- Sidecar supervision on Windows (token generation is unix-only today).
