---
phase: 06-agent-lifecycle-api
plan: 04
subsystem: gateway
tags: [websocket, roster, events, contract]
requires: [06-01, 06-02]
provides: [agent:added/removed announcements, init_list on connect only]
affects: [06-05]
tech-stack:
  added: []
  patterns: [events replace post-mutation snapshots]
key-files:
  created: [server/__tests__/rosterEvents.test.ts]
  modified:
    - server/src/services/AgentService.ts
    - server/src/services/__tests__/AgentService.test.ts
    - server/src/services/__tests__/SessionManager.test.ts
    - server/src/services/__tests__/SessionManagerKillSession.test.ts
    - server/__tests__/rosterContract.test.ts
    - server/__tests__/killSession.test.ts
    - server/__tests__/lifecycle.test.ts
    - server/__tests__/index.test.ts
    - docs/superpowers/specs/2026-11-07-fe-be-contract.md
status: complete
requirements: [INT-03]
commits: 3
plan_head_before: c2956fc71ceca1dc440fd027d836f77e003c7828
plan_head_after: 099155d744b338ae0e24483fc3bdbb7a54b0e16e
actuals:
  tasks: 3
  commits: 3
---

# Phase 6 Plan 04: Roster events replace snapshots Summary

AgentService now publishes `agent:added` on create and `agent:removed` (reason `killed`) on close and session kill; the full `agent:init_list` is sent only on connect (`SessionManager.addClient`). Failed and refused operations publish nothing; the exit race and driver-exit persistence are unchanged.

## Commits
- a3bf71c Task 1: create announced as `agent:added`
- cc7535f Task 2: close/destroy announced as `agent:removed`, `publishSnapshot` removed
- 099155d Task 3: resync/ordering/exit tests, spec 4.2 rule + reconciliation row 19

## Verification
tsc clean; root 87 files / 1620 tests (baseline 86/1599; includes server); server 21 files / 421 tests (baseline 20/400); protocol 15/540; server build, root build, `contract:check` OK. `grep -c agent:init_list AgentService.ts` = 0; only production use in `server/src` is the connect snapshot in `SessionManager.addClient`. hardening.test.ts passed unedited.

## Edited pinned assertions (on purpose)
- rosterContract.test.ts: "announces a create ... as a full snapshot" -> one `agent:added` per client, no snapshot, fresh connection sees whole roster (snapshot-per-create is replaced by design); "creates two agents with different ids" -> counts `agent:added`; "answers a kill with a snapshot" -> one `agent:removed` (killed) per client, no snapshot; "resyncs a reconnecting client" -> waits on `agent:added`; unused `lastSnapshot` helper removed.
- killSession.test.ts: confirmed kill, plain close, confirm-without-killSession now read `agent:removed` (and assert no snapshot); the USAGE refusal case additionally asserts no `agent:removed`.
- lifecycle.test.ts: create-with-reqId case reads the other client's `agent:added` instead of the post-create snapshot; no-reqId case waits on `agent:added`.
- AgentService.test.ts: create/close/destroy/overlapping-destroy assert `agent:added`/`agent:removed` frames and zero snapshots.
- SessionManagerKillSession.test.ts: successful kill and plain-close cases count `agent:removed` instead of snapshots; unknown-id case also asserts no removed.
- SessionManager.test.ts: `killAgent` case expects one `agent:removed` frame instead of an init_list.
- index.test.ts: see deviation 1.

## Deviations from Plan

**1. [Rule 3 - Blocking] index.test.ts body edited**
- The plan says index.test.ts must pass untouched. Its "handle WebSocket client messages" case waited for an `agent:init_list` to obtain the created agent's id; it only worked because the post-create snapshot was the first one it observed (the empty connect snapshot is delivered before its listener attaches). With snapshots gone it hung/failed.
- Fix: wait for `agent:added` and take `agent.id` from it (3 lines). Commit a3bf71c.

**2. SessionManager.ts not modified** though listed in files_modified: it already only sends the snapshot on connect, so no change was needed.

**3. TDD ordering:** the production change for each task was made first and the failing pinned tests were then identified by running the suite (7 failed after Task 1, 17 after Task 2) rather than writing and running the new rosterEvents cases red first. All new rosterEvents cases were written and pass against the final behavior; no case was weakened.

**4. Environment:** the worktree had no node_modules; symlinked the main checkout's `node_modules` and `server/node_modules` (git-ignored, not committed). Task 3's reducer/reconnect cases passed immediately because Tasks 1 and 2 already delivered the behavior; kept as regression pins.

## Known Stubs
None.

## Threat Flags
None.

## Self-Check: PASSED
rosterEvents.test.ts exists (21 cases); commits a3bf71c, cc7535f, 099155d are ancestors of HEAD.
