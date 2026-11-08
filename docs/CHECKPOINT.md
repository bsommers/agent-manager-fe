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
