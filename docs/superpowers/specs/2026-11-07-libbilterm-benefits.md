# libbilterm: Benefits, Costs and Go/No-Go

Date: 2026-11-07. Source: read-only review of bilterm v3.0.5 (`/home/bill/src/ai/bilterm`, 95.5k LOC). How-to: `docs/superpowers/plans/2026-11-07-libbilterm-library-plan.md`.

## Verdict

NO-GO on a full libbilterm now. Do the sidecar adapter (about 1 week, no bilterm refactor) plus shared golden fixtures first. Extract only a leaf crate (agent-state + VT snapshot, about 13k LOC) if the measurable criteria below are met.

## What it would bring

1. One agent-state engine (highest value per LOC). `AgentState {Working,Blocked,Idle,Done,Errored}` (`src/wm/agent_state.rs:33`) is a heuristic over echo-lock, alt-screen and OSC 133 signals. `classify()` (:117) is about 600 LOC and pure. Duplicating it in the TS gateway risks drift against the FE's `idle|running|thinking|error|disconnected`.
2. Reuse across surfaces: TUI, GUI, web gateway and headless control plane share one model. Today the JSON-RPC/HTTP+SSE/MCP surface (`api/rpc_dispatch.rs`) already gives out-of-process reuse without any library; a library adds value only for in-process embedding (napi in the Node gateway, wasm in the browser).
3. Testability: `TerminalBackend` trait plus mock (`vt/backend.rs:14,242`), insta snapshots and recorded `.cast` files become shared fixtures that gate the gateway classifier. Most of this is achievable with fixtures alone.
4. Duplication removed in the gateway: reconnect, backoff, hydrate and fleet selectors in `TmuxDriver.ts`/`SshDriver.ts`/`SessionManager.ts` (about 351 LOC) overlap bilterm's tmux -CC link and `fleet.*`.
5. Community value: speculative. Ghostty's libghostty-vt, vt100, alacritty_terminal and wezterm-term occupy the "VT engine" niche. The only distinctive pieces are the agent-state classifier and the fleet/agent-mail model. No evidence of outside demand.

## Other consumers (peeked read-only)

- climah (Rust, about 9k LOC), mads (Rust), mad (Python), cvm (bash/docker/py): none use PTY, VT or tmux code. At most they would consume agent-state labels, which the RPC already provides.
- So 0 of 4 are in-process consumers today. The real consumer is agent-manager-fe.

## Costs and risks

- Refactor size. Leaf crate: about 13k LOC, 2-4 weeks, mostly decoupling `agent_state.rs` from `CompositePane`/`WindowManager` (imports at `agent_state.rs:11-14`), 1-2 weeks for that seam. Headless engine: about 45-48k LOC, 2-3 months; wm alone has 23 ratatui-importing files; high regression risk through `Action` (995 LOC) and ARCH-R04.
- API freeze. `lib.rs:1-20` exports 20 `pub` modules, all accidental API on a fast-moving codebase. A semver commitment slows a solo project. Mitigation: 0.x, curated facade, semver on leaf crates only.
- Binding maintenance. napi-rs, wasm-bindgen and PyO3 each add a build and release matrix; estimate 0.5-1 dev-day per week per binding. Shared golden fixtures keep this near constant.
- Single maintainer: 579 of 592 commits. Library plus bindings plus bin quadruples the release surface.
- Opportunity cost: delays FE work (palette, gateway limits, v2.0 phases).
- Technical traps: own JSON (`api/json.rs`, no serde_json) hurts FFI ergonomics; `ghostty-vt` needs Zig and Rust 1.90 and must stay opt-in; secure_fs and daemon use libc/SO_PEERCRED, which are not wasm-clean.

## Alternatives

| Option | Cost | Captures |
|---|---|---|
| A. Do nothing | 0 | Risk: FE and bilterm classifiers diverge |
| B. Sidecar only (`bilterm --headless --http` bridged by the gateway) | about 1 week | Fleet, find, agents, MCP. Gaps: no event timestamps, workspace-local pane ids, poll-drained events; fixable as small upstream PRs |
| C. Leaf crates (`bilterm-vt`, `bilterm-agent`) plus fixtures | 2-4 weeks | About 80% of the value (classifier, VT snapshot). Cheaper variant: copy-port the classifier to TS with Rust-generated golden vectors, about 3 days |
| D. Full libbilterm with bindings | 2-3 months plus upkeep | Only justified by real in-process consumers |

## Go/no-go criteria (all must hold for C; all plus item 5 for D)

1. At least 2 independent consumers commit to embedding in-process. Today: 0.
2. Sidecar measured inadequate: p95 event latency above 100 ms, or above 5% classifier disagreement on a 200-sample recorded corpus.
3. Seam spike: `agent_state.rs` has zero `crate::pane`/`crate::wm` imports, diff at most 1.5k LOC, suite green, at most 5 working days.
4. Core builds for wasm32 or napi with no tokio, libc or portable-pty, under 300 KB gzipped.
5. Maintainer capacity of 4 uninterrupted weeks; binding upkeep at most 1 day/month over 2 releases; CI on Linux and macOS.
6. Leaf API unchanged for 3 months of git history.

NO-GO if criterion 1 fails, if the slice touches more than 15k LOC, or if ratatui cannot be removed from the leaf.

## Unverified

LOC and coupling counts are from grep, not `cargo modules`; z_stack and `wm/registry/*` placement is inferred; wasm32 compilability of the subset is untested.
