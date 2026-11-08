---
phase: 06-agent-lifecycle-api
plan: 05
subsystem: frontend-store
tags: [roster, events, convergence, docs, adr-011]
requires: [06-03]
provides: [applyAgentAdded, applyAgentRemoved, applyAgentUpdated, ADR-011]
affects: [src/store/agentStore.ts, docs]
key-files:
  modified:
    - src/store/agentStore.ts
    - docs/RUNNING.md
    - docs/ARCHITECTURE.md
    - docs/RATIONALE_AND_DESIGN_DECISIONS.md
    - docs/qa-test-plan.md
  created:
    - src/store/__tests__/agentStoreEvents.test.ts
status: complete
commits: 3
plan_head_before: c2956fc71ceca1dc440fd027d836f77e003c7828
plan_head_after: d6743071afb609523d4c61ffbd97a2d3d8c168c8
actuals:
  tasks: 3
  commits: 3
requirements: [INT-03]
---

# Phase 6 Plan 05: Roster events, convergence, final docs Summary

Live roster applies the gateway's `agent:added/removed/updated` events (validated by `parseServerMessage`, capped at `LIMITS.MAX_AGENTS`, ignored in Demo), proven to converge with acks and connect snapshots in any order; Phase 6 docs and ADR-011 written in final state.

## Commits
- 1a1c4cc feat: agent:added tracer
- d402d08 feat: agent:removed, agent:updated, convergence tests
- d674307 docs: RUNNING, ARCHITECTURE, ADR-011 (ADR-008 pointer), QA step 1e

## Results
- `agentStoreEvents.test.ts`: 46 tests (11 added, 6 removed, 6 updated, convergence table of 10 sequences incl. both ack/added orders, replay-twice, reconnect, 24-permutation property).
- Root 87 files / 1645 tests (baseline 86 / 1599); server 20 / 400; tsc, both builds, contract:check green.
- Only `src/store/agentStore.ts` changed among sources; no component, keyboard, service, server, protocol change.

## Deviations from Plan
None of Rules 1-4. Minor notes:
- Test expectation: after "removed then a stale snapshot still listing the agent", the order is `[B, A]` (existing `reconcileSnapshot` keeps known panes in order and appends the returning one); the plan did not specify order.
- `agent:removed` activates the first remaining agent (per plan) rather than reusing `dropKilledAgent`'s neighbour rule, so it has its own removal code.
- Event warnings are emitted before the Demo check is skipped: Demo returns early with no warning (validation happens only in live mode).
- Worktree had no `node_modules`; symlinked from the main checkout (gitignored, not committed).

## Known Stubs
None.

## Threat Flags
None (T-06-19 and T-06-20 mitigated: validation first, payload-free warnings asserted by tests, cap enforced).

## Self-Check: PASSED
