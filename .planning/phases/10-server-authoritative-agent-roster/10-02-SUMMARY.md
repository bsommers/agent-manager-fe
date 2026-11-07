---
phase: 10-server-authoritative-agent-roster
plan: 02
subsystem: gateway-contract-tests-and-docs
tags: [websocket, characterization-tests, docs, qa]
requires: []
provides:
  - executable pin of the gateway roster snapshot contract
  - live-mode roster documentation and ADR-008
affects: [phase-6-typed-lifecycle]
tech-stack:
  added: []
  patterns: [vi.hoisted driver capture, ordered-sentinel assertions instead of timing windows]
key-files:
  created:
    - server/__tests__/rosterContract.test.ts
  modified:
    - docs/RUNNING.md
    - docs/ARCHITECTURE.md
    - docs/RATIONALE_AND_DESIGN_DECISIONS.md
    - docs/qa-test-plan.md
key-decisions:
  - "agent:update ignore is pinned with update, unknown-id kill sentinel, then ping; no timing window"
metrics:
  duration: ~15m
  completed: 2026-11-07
status: complete
requirements: [UX-02]
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: b5cb6c1
plan_head_after: d2d109b24e17eeb53cbd80e96ce9d420699791ae
---

# Phase 10 Plan 02: Gateway roster contract tests and docs Summary

Nine characterization tests pin the gateway's snapshot-based roster behavior over a real WebSocket against the unmodified gateway, and the live-mode roster is documented (RUNNING, ARCHITECTURE, ADR-008, QA plan sub-steps 1a to 1c).

## Tasks

1. Roster contract tests: `server/__tests__/rosterContract.test.ts` (commit 814ef28). Covers snapshot on connect, create and kill broadcast to all clients, initialCmd write, identical creates, unknown-id kill, reconnect resync, driver exit persistence, and agent:update ignored.
2. Docs: RUNNING.md "Agent roster", ARCHITECTURE.md sequence arrows plus "Roster reconciliation" and init_list idempotency sentence, ADR-008 and ADR-007 bullet, QA plan step 1 Expected, sub-steps 1a to 1c and step 12 addition (commit d2d109b).

## Reviewer fixes folded in

- agent:update test uses no timing window: it sends the update, an unknown-id `agent:kill` sentinel, then a `ping`. Because the gateway handles one socket's frames in order and replies synchronously, the pong proves everything caused by the first two has arrived; the test asserts the frames in between are exactly one `agent:init_list` (from the kill, name unchanged) followed by the pong.
- docs/qa-test-plan.md notes that cancelling a pending create after the gateway received it leaves an ordinary pane, and that the create timeout starts at send time so a create just before a disconnect may roll back and later appear.

## Verification

- `npm --prefix server test`: 9 files / 107 tests (baseline 8 / 98), run twice for the new file with no leaks.
- `npm --prefix server run build`: exit 0.
- Docs gate from Task 2 passes. Nothing changed under server/src, src, packages/protocol, package files, vite.config.ts or .github.

## Deviations from Plan

None - plan executed exactly as written. The plan text says "section headed Agent roster" for RUNNING.md while its verify gate greps `^### Agent roster`; a level-3 heading was used, matching the neighboring "Connection states" section.

## Known Stubs

None.

## Self-Check: PASSED
