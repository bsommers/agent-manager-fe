# Checkpoint 2026-11-08 (agent-manager-fe) - Phase 6 waves 7-8 merged

## Decisions (user)
- Per wave: plan (gsd-planner) -> check (gsd-plan-checker) -> parallel gsd-executor worktrees (ff-only to master sha first) -> merge --no-ff -> full gate -> push only on explicit user go-ahead.
- Subagents: Sonnet 5.5 default (planner too, overriding the workflow's opus), Opus only for hard tasks, haiku mechanical; always explicit model; terse output.
- Closing an agent must not kill tmux; gateway enforces destructive ops; port 8088 is the user's nginx (do not touch); no token in URL.
- Phase 6 was planned without CONTEXT.md or RESEARCH.md, as 2.1 and 10 were.

## State
- origin/master = 763dd01. Local master is ahead (Phase 6 plans, checkpoints, 06-01 merge) and NOT pushed.
- Phase 6 plans (7, waves 7-10) passed the plan-checker. Wave 7 / 06-01 (AgentService) merged and verified on master: root 80 files / 1394 tests, server 16 / 278, tsc, both builds, contract:check all green; tmuxKill count in SessionManager.ts is 0.
- Wave 8 (06-02 gateway acks/validation + 06-03 FE request layer) merged together and gate green on master: root 86 files / 1599 tests, server 20 / 400, tsc, both builds, contract:check, wave-collisions OK. NOT yet exercised against a live gateway+FE. Deviations: pinned assertions edited on purpose (listed in 06-02/06-03 SUMMARYs), AgentControlsKillSession.test.tsx got reqId matcher, SessionManager.test.ts spies repointed to service.* .
- Remaining: W9 06-04 events, 06-05 FE events, 06-06 HTTP. W10 06-07 destructive policy.
- 06-01 deviations: agent:broadcast in SessionManager still loops sendInput (existing test spies on it); AgentService.broadcast returns BroadcastResult[] for 06-02 to wire. Overlapping destroys share one result.
- reqId stays optional on the wire; FE always sends it.
- STATE.md / ROADMAP.md not yet updated for 06-01. Tick INT-03, GW-04, GW-05 only after all 7 plans are merged and green.
- Flaky: server hardening.test.ts "never terminates a responsive client" (re-run once, never edit).
- 19 merged worktrees under .claude/worktrees/ to clean up.

## Next
1. Wave 9: 06-04, 06-05, 06-06 in parallel worktrees from current master (baseline root 86/1599, server 20/400); optionally live-QA the 06-02+06-03 pair first.
2. Wave 10 (06-07).
4. Plan 05-04; Phase 1 close (01-EVIDENCE.md); worktree cleanup; push (needs user go-ahead).


## Update: wave 9 merged (06-04 events, 06-05 FE events, 06-06 HTTP)
- Merged --no-ff onto master, no conflicts. Gate green: root 90 files / 1765 tests, server 23 / 520, tsc, both builds, contract:check; tmuxKill count 0.
- Deviations: 06-04 edited index.test.ts (waits for agent:added, not post-create init_list); SessionManager.ts untouched. 06-06: error handler maps any 4xx to 400 USAGE (413 PAYLOAD_TOO_LARGE); index.ts +15 lines (router mount, BootstrapOptions.epoch). One unrecorded root flake seen once by 06-06 pre-change.
- Next: wave 10 (06-07 destructive policy); live QA of W8+W9 (QA step 1e, two tabs); then tick INT-03/GW-04/GW-05, STATE/ROADMAP; worktree cleanup (now ~25); push needs user go-ahead. Local master NOT pushed.

## Update: live QA of W8+W9 done (own ports 18090/13000, Playwright in scratchpad)
- PASS: 1e two-tab create/close live sync, no dups; HTTP POST/DELETE reflected live in open tab; 1b reload no dups; 1c gateway restart -> Reconnecting banner, reconnect to snapshot (agents come back as `Tmux: <session>`), banner clears; HTTP: 201, idempotent replay, 409 key reuse, 403 bad Origin, 400 ctype/body, 422 unsupported, 404.
- Close leaves tmux running (confirmed). Headless page logs xterm `reading 'dimensions'` pageerrors (not investigated; likely headless fit-addon, unverified).
- Not covered: 1a (gateway down + New Agent), 1d, broadcast/destructive modal, ack timeout paths. User's gateway :8089/vite :3000/nginx :8088 and tmux qa-agent-1/2 untouched.
- Next: wave 10 (06-07); close-out; worktree cleanup; push needs go-ahead.

## Update: Phase 6 COMPLETE (all 7 plans merged), pushed through d23d42f (06-07 merge + close-out NOT yet pushed)
- 06-07 merged. Gate: root 92 files / 1832 tests, server 25 / 587, tsc, builds, build:protocol, contract:check additive (agent.kill http binding). tmuxKill count 0.
- INT-03, GW-04 ticked; GW-05 left unticked (MCP surface = Phase 21). ROADMAP 06-0x ticked. Merged worktrees cleaned.
- Push: use `GH_TOKEN=$(gh auth token --user bsommers) git push origin master` (active gh account nonont1010 has no write access). Needs user go-ahead each time.
- Review findings (unverified, from sonnet reviewer, wave 8-9): (1) no Host-header check on /api (DNS rebinding read of roster) apiRouter.ts:94; (2) replayed create ack resurrects deleted agent agentStore.ts:172; (3) replayed update ack overwrites newer state agentStore.ts:423; (4) idempotency eviction by any client idempotency.ts:55; (5) dispatch.ts:67 swallows exceptions unlogged; (6) AgentService onError/onData act on removed agents :92-107; (7) untracked 500ms initialCmd timer; (8) HTTP DELETE ignores Idempotency-Key; (9) settleCreate drops pending pane layout. xterm 'dimensions' pageerror unexplained (TerminalView.tsx:67,131 fit() unguarded).
- Next: verify+fix review findings (follow-up pass), plan 05-04, Phase 1 close, Phase 8 (auth), Phase 7.
