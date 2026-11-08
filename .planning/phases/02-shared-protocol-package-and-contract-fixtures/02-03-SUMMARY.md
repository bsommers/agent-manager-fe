---
phase: 02-shared-protocol-package-and-contract-fixtures
plan: 03
subsystem: protocol
tags: [protocol, validation, fixtures, http, limits]
requires: ["02-02"]
provides: ["gateway-to-client messages", "additive Agent fields", "per-scope agent:meta", "HTTP body shapes", "contract limits", "drift guards"]
affects: [frontend, server]
key-files:
  created:
    - packages/protocol/src/http.ts
    - packages/protocol/src/__tests__/http.test.ts
    - packages/protocol/fixtures/http.json
    - src/services/transport/__tests__/contractConstants.test.ts
    - server/__tests__/contractConstants.test.ts
  modified:
    - packages/protocol/src/fieldspec.ts
    - packages/protocol/src/agent.ts
    - packages/protocol/src/messages.ts
    - packages/protocol/src/validate.ts
    - packages/protocol/src/limits.ts
    - packages/protocol/src/index.ts
    - packages/protocol/src/__tests__/validate-v2.test.ts
    - packages/protocol/fixtures/server.json
    - packages/protocol/fixtures/invalid.json
    - docs/superpowers/specs/2026-11-07-fe-be-contract.md
decisions:
  - "json kind reports the field path itself on failure, never a path built from attacker-chosen keys"
  - "JSON depth and size caps (8, 65536) are local constants in validate.ts, not LIMITS keys, so LIMITS holds exactly the section 8 constants"
  - "AGENT_SPEC is exported from validate.ts so http.ts reuses it rather than duplicating the Agent shape"
  - "agent:meta pipeline.state is optional, following contract spec section 6.4"
status: complete
commits: 5
plan_head_before: d5241bba064f8f200310f70ef11e7864f6423843
plan_head_after: f86374190eae6286c041ced24b3f4ad5b5a5017b
actuals:
  tokens: 45000
  tasks: 2
  commits: 5
---

# Phase 2 Plan 03: Gateway-to-client messages, HTTP shapes and contract limits Summary

The protocol package now validates the complete WebSocket surface of contract spec section 4.2 (pong, added, removed, updated, gap, history_chunk, ack, error, per-scope meta, gate), the additive `Agent` fields, `hello_ack.backends[].agentSpecs`, and the seven HTTP bodies of section 7 (`parseHttpBody`, `HTTP_TABLE`, `hitKey`), with every section 8 constant in `LIMITS` and drift-guard tests pinning the FE and gateway copies.

## Commits
- 6d7a209 test: RED cases and fixtures for gateway-to-client messages
- f3b66d8 feat: engine vocabulary (literal, json, byTag, enum dropUnknown, gte rule)
- 6d9f5a7 feat: server messages, additive Agent fields, per-scope meta, agentSpecs
- 2ba3451 test: RED http body, limits and drift-guard tests
- f863741 feat: HTTP shapes, contract limits, spec correction for /api/health agents

## Verification
- Full gate (`build:protocol`, package typecheck, `npm test`, `tsc --noEmit`, `npm run build`, `npm --prefix server test`, `server build`) exits 0
- root `npm test`: 47 files, 593 tests (baseline 44 / 498)
- server `npm test`: 10 files, 108 tests (baseline 9 / 107)
- packages/protocol: 5 files plus http.test.ts, 262 tests across protocol and transport specs in the targeted run
- invalid.json: 33 entries (22 existing + 11 new), all rejected with the stated reason
- every key of SERVER_TABLE has a fixture (coverage test); http.json has a valid body for each of the seven kinds and 10 malformed bodies; the over-cap cases (2001 lines, 1001 hits) are generated in http.test.ts to keep the fixture small
- Drift guard checked by hand: changing `DEFAULT_BACKOFF.capMs` made the FE guard fail; reverted
- `git diff` shows no change to `src/` or `server/src` runtime files; only the two new guard tests were added outside the package

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Spec] /api/health `agents` is an integer count**
- **Found during:** Task 2
- **Issue:** Spec section 7 listed `agents?` without a type
- **Fix:** Spec text now states it is an integer count of at least 0, matching legacy `/health`
- **Files modified:** docs/superpowers/specs/2026-11-07-fe-be-contract.md
- **Commit:** f863741

**2. [Process] Acceptance counts updated**
- Reviewer-supplied baselines (root 44 / 498, server 9 / 107) replace the stale numbers in the plan; the stale figures were not used.

**3. [Process] Task 1 commit split**
- Per reviewer instruction, Task 1 was committed as RED, engine vocabulary, then messages/Agent fields; Task 2 as RED then GREEN. RED commits intentionally leave their own tests failing.

**4. [Note] Server drift guard was green at RED**
- `CONFIG.MAX_PAYLOAD_BYTES` and `LIMITS.MAX_FRAME_BYTES` already matched, so that guard passed before any GREEN code; only the FE guard and http tests failed at RED.

**5. [Note] One transient root test failure**
- A single run of the root suite under load reported 1 failed test among pre-existing UI timing specs; a rerun was fully green (593 passed). Not related to this plan.

## Threat model
- T-02-09: json kind caps depth 8 and 65536 serialized characters, rejects `__proto__`, `constructor`, `prototype` at any depth, returns a deep copy; kind and capabilities filtered to known lists; unknown meta scope rejected with `unknown_type` on `scope`
- T-02-10: fixtures use only dummy values (`example/base:1`, `demo`, `localhost`); no tokens, hosts or credentials
- T-02-11: caps on lines 2000, hits 1000, chunks 1000, results 64, agents MAX_AGENTS, string lengths per spec

## Known Stubs
None.

## Threat Flags
None.

## Self-Check: PASSED
Created files exist (http.ts, http.test.ts, http.json, both contractConstants tests); commits 6d7a209, f3b66d8, 6d9f5a7, 2ba3451, f863741 are ancestors of HEAD.
