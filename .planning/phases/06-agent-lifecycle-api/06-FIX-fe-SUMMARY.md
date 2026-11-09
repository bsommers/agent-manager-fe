---
phase: 06-agent-lifecycle-api
plan: FIX-fe
status: complete
---

# Phase 6 FE review fixes (findings 2, 3, 9)

All three findings were real; each was proven by a failing test first (6 of 10 new tests failed before the fix, the other 4 are controls).

## Changes (src/store/agentStore.ts)

- Roster ordering: a module-level sequence number is taken by every init_list snapshot, agent:added, agent:removed and agent:updated. A create or update request remembers the sequence current when it was sent.
- Finding 2: settleCreate drops the pending pane (no ghost, no notice, focus falls back to the first agent) when the ack's agent is absent from a snapshot received after the send, or was removed by agent:removed after the send, and has not been re-announced since (`goneSince`). The same guard covers the user-cancelled-pane branch.
- Finding 3: updateAgent does not apply ack.agent when an agent:updated for that agent arrived after the send.
- Finding 9: when the ack's agent is already listed, the listed agent takes the pending pane's layout (float, x/y, size, z-index) and the pane's index; the duplicate entry is removed.
- agentRequests.ts and rosterReconcile.ts needed no change.

## Tests

- New: src/store/__tests__/agentStoreReplay.test.ts (10 tests).
- Edited pinned assertion: src/store/__tests__/agentStoreRoster.test.ts "settles a pending create against the gateway-real server shape". It sent init_list (without the new agent) then the ack with no agent:added, which is exactly the finding-2 shape. The real gateway publishes agent:added before it answers a create (AgentService.create), so the test now sends agent:added between the snapshot and the ack; expected results unchanged.

## Gate

tsc clean; root vitest 93 files / 1842 tests pass (includes server tests); server vitest 25 files / 587 tests pass; root build and server build pass; contract:check OK.

## Deviations

- The roster-ordering assumption (agent:added precedes the create ack on the same connection) is relied on for finding 2; an ack for an agent absent from a post-send snapshot with no later agent:added is treated as removed.
- server/node_modules was symlinked from the main checkout (gitignored) to run server tests.
