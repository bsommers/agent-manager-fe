# Checkpoint 2026-11-08 (agent-manager-fe) - Phase 2.1 complete

## Decisions (user)
- Per wave: plan (gsd-planner) -> check (gsd-plan-checker) -> parallel gsd-executor worktrees (ff-only to master sha first) -> merge --no-ff -> full gate -> push only on explicit user go-ahead.
- Subagents: Sonnet 5.5 default, Opus only for hard tasks, haiku mechanical; always explicit model; terse output.
- Closing an agent must not kill tmux; gateway enforces destructive ops; port 8088 is the user's nginx (do not touch); no token in URL.
- Phase 2.1: 02.1-02 Task 3 split to 02.1-03; DELETE /api/agents/:id bound to agent.close; HTTP form of agent.kill left to Phase 6.

## State
- master d451cd0 + docs commit (local, NOT pushed after 43b067d). Phase 2.1 merged: schema (contract.schema.json + drift gate), 12-op catalog (agent.kill only destructive), palette derivation, spec 4.3.
- Gate: root 77 files / 1324 tests, server 13 / 208, tsc, builds, contract:check green. Flaky: server hardening.test.ts "liveness > never terminates a responsive client" under load.
- start:all not running. tmux qa-agent-1/2 are mine.

## Next
1. Push local master (needs user go-ahead).
2. Plan Phase 6: service layer first (GW-04), reqId required, adopt agent:kill killSession; FE handling of agent:error; destructive policy plan uses Phase 2.1 catalog.
3. Plan 05-04 (must not edit src/keyboard/commands.ts without checking 02.1-03 is merged).
4. Phase 1 close: QA evidence into 01-EVIDENCE.md.
5. Cleanup merged worktrees under .claude/worktrees/.
