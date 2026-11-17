# Checkpoint 2026-11-15 (agent-manager-fe) - Phase 8 all 3 waves merged (local, unpushed; gate green)

## Decisions (user, standing)
- Per wave: plan (gsd-planner) -> check (gsd-plan-checker) -> parallel gsd-executor worktrees (ff-only to master sha first) -> merge --no-ff -> full gate -> push only on explicit user go-ahead (each push needs a fresh "yes"; approvals expire).
- Subagents: Sonnet 5.5 default (planner too), Opus only for hard tasks, haiku mechanical; always pass explicit `model`; terse output. User wants parallel subagents as much as possible.
- Closing an agent must not kill tmux; gateway enforces destructive ops (confirm exactly true); port 8088 is the user's nginx, also do not touch :8089 gateway / :3000 vite or tmux qa-agent-1/qa-agent-2; no token in URL.
- Live QA runs on own ports (gateway 18090, vite 13000) with Playwright in the scratchpad (`.../scratchpad/qa/qa.mjs`, `qa2.mjs`); tear down only what I started.

## State (verified)
- Branch master, tree clean. origin/master = local master = 6c71bf7 (pushed). No worktrees besides main; no background jobs; my ports 18090/13000 free.
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
1. RESOLVED: daemons-menu request was for the bilterm session, not this repo (ignore).
2. xterm pageerror `reading 'dimensions'` (stack: xterm Viewport.syncScrollArea -> renderService.dimensions; headless on pane mount). Not fixed, cause unconfirmed (suspect dispose/rAF race).
3. Not live-tested: RATE_LIMITED eviction path, FE replay-ack races (unit-tested only); QA steps 1a, 1d, broadcast/destructive modal, ack-timeout paths.
4. Plan 05-04; Phase 1 close (01-EVIDENCE.md); Phase 8 (auth); Phase 7.

## Push command
`GH_TOKEN=$(gh auth token --user bsommers) git push origin master` (active gh account nonont1010 has no write access). Ask first.


## Phase 8 (auth) status 2026-11-12
- Pushed: origin/master = 84193b1 (d8a04ac checkpoint + xterm dimensions fix 1345b39 + Phase 8 CONTEXT).
- Local only (ahead of origin): D-13 lock (hello body), 08-RESEARCH, 5 plans (08-01..05) checked, wave 11 merged (08-01 server auth core, 08-03 FE token/transport). Gate green: root 104 files/2123 tests (+1 todo), server 30/749, tsc x2, builds, contract:check OK, tmuxKill 0.
- User confirmed the 8 default decisions (08-01 PLANS-NOTES). Token delivery = hello body.
- Next: wave 12 = 08-02 (server wiring, owns index.ts/apiRouter.ts) + 08-04 (FE dialog/logout) in parallel worktrees (ff-only to master sha), merge, gate; then wave 13 = 08-05 (smoke, docs, QA). Push only on fresh "yes".
- Executor worktrees symlink node_modules; old worktrees under .claude/worktrees/ can be removed after merge.

- Verified 2026-11-13: tree clean at d4a57f1, master 16 ahead of origin (84193b1), no extra worktrees. Resume: "start wave 12".

## Update 2026-11-15: wave 12 merged
- 08-02 (server wiring) and 08-04 (FE dialog/logout) merged --no-ff; master 27 ahead of origin (84193b1), unpushed.
- Gate: root 113 files / 2281 tests (+2 todo), server 33 / 845, tsc x2, builds, build:protocol, contract:check OK, tmuxKill 0.
- Next: wave 13 = 08-05 (smoke-auth.mjs, operator docs + nginx, ADR-013, QA checklist, 08-EVIDENCE.md). Must record: Phase 13 workspace storage keys must be named `agent-manager.*` (logout prefix sweep). Then review, verify, Phase 8 live QA (18090/13000). Push needs fresh "yes".

## Update 2026-11-15: wave 13 merged (Phase 8 code+docs complete)
- 08-05 merged; smoke-auth.mjs 9/9 PASS; gate: root 113/2281, server 33/845, tsc x2, builds, contract OK, tmuxKill 0. Master ~34 ahead of origin (84193b1), unpushed.
- 08-EVIDENCE.md: 12 browser QA steps PENDING-HUMAN (7, 11 pass via smoke; 2, 5 server-side only).
- Remaining for Phase 8: code review, verify, live QA on 18090/13000, STATE.md + REQUIREMENTS INT-02 tick. Hand-offs: Phase 13 keys `agent-manager.*`; Phase 21 Copy diagnostics via redact.ts.
- Push needs fresh "yes".

## Refresh (verified): tree clean, master 35 ahead of origin (84193b1), single worktree, no background jobs.
- Next step: "review and verify" for Phase 8 (code-review + verifier agents, sonnet, parallel), then live QA 18090/13000, then STATE.md + INT-02 tick. Push only on fresh "yes".

## Update 2026-11-15 (review + verify done)
- Verifier: 4/4 roadmap criteria, no code gaps, human_needed (browser QA in 08-EVIDENCE.md). Reviewer: 0 critical, 4 WR, 6 IN (08-REVIEW.md).
- Fixed and merged (9fc262b): WR-01 (auto-trust XFF only from loopback peer; TRUST_PROXY=0 disables), WR-02, WR-03, WR-04, IN-01, IN-06a/c. Not fixed: IN-02..05, IN-06b (listed in 08-FIXES.md).
- Gate green after merge: root 113/2307, server 33/858, tsc, builds, protocol, contract OK, tmuxKill 0, smoke-auth 9/9. Fix worktree removed.
- INT-02 deliberately left unticked until live browser QA. Master ahead of origin (unpushed; push needs fresh "yes").
- Next: Phase 8 live QA on 18090/13000, tick INT-02, then push.

## Refresh 2026-11-17 (verified)
- Tree clean, one worktree, no background jobs, ports 18090/13000 free. Master ahead of origin (unpushed; push needs fresh "yes").
- State unchanged from "Update 2026-11-15 (review + verify done)": review fixes merged, gate green, INT-02 unticked pending browser QA.
- Next: Phase 8 live QA on 18090/13000 (Playwright in scratchpad), tick INT-02, then ask about push.

## Refresh 2026-11-17 (pre-compact, verified)
- Tree clean, one worktree, no background jobs. Master ahead of origin, unpushed (push needs fresh "yes").
- Unchanged: Phase 8 review fixes merged (9fc262b), gate green, INT-02 unticked pending live browser QA.
- Next: Phase 8 live QA on 18090/13000, tick INT-02, ask about push.
