---
phase: 02-shared-protocol-package-and-contract-fixtures
plan: 02
subsystem: protocol
tags: [protocol, validation, fixtures, errors]
requires: ["02-01"]
provides: ["fieldspec engine", "hello/hello_ack", "capability vocabularies", "error vocabulary", "client-to-gateway messages", "golden fixtures"]
affects: [frontend, server]
key-files:
  created:
    - packages/protocol/src/fieldspec.ts
    - packages/protocol/src/capabilities.ts
    - packages/protocol/src/errors.ts
    - packages/protocol/src/__tests__/conformance.test.ts
    - packages/protocol/src/__tests__/validate-v2.test.ts
    - packages/protocol/src/__tests__/errors.test.ts
    - packages/protocol/fixtures/client.json
    - packages/protocol/fixtures/server.json
    - packages/protocol/fixtures/invalid.json
  modified:
    - packages/protocol/src/validate.ts
    - packages/protocol/src/messages.ts
    - packages/protocol/src/index.ts
    - docs/superpowers/specs/2026-11-07-fe-be-contract.md
decisions:
  - "Barrel exports fieldspec types and validateObject only, not the engine internals"
  - "hello_ack.backends omits agentSpecs for now (stripped as unknown field)"
  - "Conformance test runs under the node vitest environment (jsdom breaks import.meta.url file paths)"
status: complete
commits: 5
plan_head_before: 57093ab
plan_head_after: dc524ce
actuals:
  tokens: 30000
  tasks: 2
  commits: 5
---

# Phase 2 Plan 02: Protocol v2 foundation and client half Summary

Field-spec engine extracted to `fieldspec.ts` (new map, enumList, scalar kinds and exactlyOne/atLeastOne rules), with `hello`/`hello_ack`, the error vocabulary and every client-to-gateway message validated and covered by golden fixtures.

## Commits
- d306765 refactor: extract fieldspec engine (70 pre-existing tests unchanged)
- ab29d7b test: conformance + hello tests (RED)
- 8447898 feat: hello/hello_ack, capabilities, map/enumList kinds (tracer GREEN)
- 4b2de89 test: errors + client message tests (RED)
- dc524ce feat: errors.ts, ping/update/history/approve, reqId, create backend/params, spec notes

## Verification
- npx vitest run packages/protocol: 5 files, 145 tests passed (baseline 2 files / 70)
- root npm test: 35 files, 386 tests passed (baseline 32 / 311)
- server npm test: 8 files, 98 tests passed (baseline unchanged)
- npx tsc --noEmit, package typecheck, build:protocol, npm run build, server build: exit 0
- git diff against the plan base shows no change under src/ or server/src
- invalid.json: 16 entries, all rejected with the stated reason

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Conformance test needs the node environment**
- **Found during:** Task 1 GREEN
- **Issue:** Root vitest uses jsdom, where `import.meta.url` does not resolve to a file path, so fixtures could not be read.
- **Fix:** `// @vitest-environment node` docblock in conformance.test.ts.
- **Commit:** 8447898

**2. [Spec correction] Validator-level rules written into the contract spec**
- Added a "Validator-level rules" bullet group under section 4.2 documenting caps the tables did not spell out (package wins, per spec header).
- **Commit:** dc524ce

Tracer gate: `<verify>` re-run end to end after Task 1 (protocol tests, typecheck, root tests, tsc) passed before expanding.

## Known Stubs
None.

## Threat Flags
None. T-02-05..08 mitigated: entry/length caps, token never in failure details (asserted), map kind rejects `__proto__`/`constructor`/`prototype`, params values limited to scalar.

## Self-Check: PASSED
All created files exist; commits d306765, ab29d7b, 8447898, 4b2de89, dc524ce are on the branch.
