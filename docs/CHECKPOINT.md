# Checkpoint 2026-11-08 (agent-manager-fe) - Phase 6 complete, review fixes merged, QA passed, all pushed

## Decisions (user, standing)
- Per wave: plan (gsd-planner) -> check (gsd-plan-checker) -> parallel gsd-executor worktrees (ff-only to master sha first) -> merge --no-ff -> full gate -> push only on explicit user go-ahead (each push needs a fresh "yes"; approvals expire).
- Subagents: Sonnet 5.5 default (planner too), Opus only for hard tasks, haiku mechanical; always pass explicit `model`; terse output. User wants parallel subagents as much as possible.
- Closing an agent must not kill tmux; gateway enforces destructive ops (confirm exactly true); port 8088 is the user's nginx, also do not touch :8089 gateway / :3000 vite or tmux qa-agent-1/qa-agent-2; no token in URL.
- Live QA runs on own ports (gateway 18090, vite 13000) with Playwright in the scratchpad (`.../scratchpad/qa/qa.mjs`, `qa2.mjs`); tear down only what I started.

## State (verified)
- Branch master, tree clean. origin/master = local master = 7f9fb8d (pushed). No worktrees besides main; no background jobs; my ports 18090/13000 free.
- Phase 6 complete: all 7 plans (06-01..06-07) merged. INT-03 and GW-04 ticked; GW-05 left unticked (MCP surface pending Phase 21). ROADMAP 06-0x and STATE.md updated.
- Review-fix pass (9 findings from wave 8-9 review, all real) merged and pushed: Host guard on /api, DELETE Idempotency-Key, idempotency cache never evicts in-flight (RATE_LIMITED when full), dispatch logs exceptions, AgentService late-callback guard + initialCmd timer cleared/unref, FE replay-ack fixes (no ghost agent, no stale update overwrite, pane layout kept).
- Gate on master: root 94 files / 1898 tests, server 26 / 643, tsc root+server, both builds, build:protocol, contract:check OK, tmuxKill count 0.
- Live QA PASSED after fixes: 1e two-tab sync, HTTP POST/DELETE live, 1b reload, 1c gateway restart/banner, Host guard, DELETE idempotency.
- Flaky: server hardening.test.ts "never terminates a responsive client" (re-run once, never edit).

## Deviations to remember
- FE create-ack fix depends on agent:added arriving before the ack on the same connection (server publishes in that order).
- Edited pinned tests on purpose: index.test.ts (waits for agent:added), agentStoreRoster.test.ts (agent:added before ack), operations.test.ts (removed "destructive ops have no HTTP binding" invariant).
- Logging uses console.error (repo has no logger).

## Open
1. User request, UNANSWERED: "daemons menu and functions are not working properly; dispatch fixes via herdr to claude sessions here in the same repo; best cheapest models". "daemons" appears nowhere in this repo; user declined the clarifying question (twice interrupted). Need: which program/menu, and which sessions (herdr 0.8.2 at ~/.local/bin/herdr, many workspaces; none of the 14 peer Claude sessions is named for this repo). Do not guess-dispatch.
2. xterm pageerror `reading 'dimensions'` (stack: xterm Viewport.syncScrollArea -> renderService.dimensions; headless on pane mount). Not fixed, cause unconfirmed (suspect dispose/rAF race).
3. Not live-tested: RATE_LIMITED eviction path, FE replay-ack races (unit-tested only); QA steps 1a, 1d, broadcast/destructive modal, ack-timeout paths.
4. Plan 05-04; Phase 1 close (01-EVIDENCE.md); Phase 8 (auth); Phase 7.

## Push command
`GH_TOKEN=$(gh auth token --user bsommers) git push origin master` (active gh account nonont1010 has no write access). Ask first.
