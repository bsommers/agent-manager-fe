---
phase: 02-shared-protocol-package-and-contract-fixtures
plan: 01
subsystem: protocol
tags: [protocol, validation, monorepo]
requires: []
provides: ["@agent-manager/protocol package", "parseClientMessage/parseServerMessage/parseAgent", "LIMITS"]
affects: [frontend, server]
tech-stack:
  added: []
  patterns: ["table-driven validators", "re-export shims"]
key-files:
  created:
    - packages/protocol/package.json
    - packages/protocol/tsconfig.json
    - packages/protocol/tsconfig.build.json
    - packages/protocol/src/index.ts
    - packages/protocol/src/agent.ts
    - packages/protocol/src/messages.ts
    - packages/protocol/src/limits.ts
    - packages/protocol/src/validate.ts
    - packages/protocol/src/__tests__/exports.test.ts
    - packages/protocol/src/__tests__/validate.test.ts
    - server/vitest.config.ts
  modified:
    - server/src/protocol/wsProtocol.ts
    - src/services/wsProtocol.ts
    - src/types/agent.ts
    - vite.config.ts
    - tsconfig.json
    - package.json
    - server/package.json
    - server/package-lock.json
decisions:
  - "Validators hand-written, no registry dependency added"
  - "Both wsProtocol.ts files kept as re-exports of the package"
status: complete
commits: 3
plan_head_before: ff4e6e9
actuals:
  tasks: 2
  commits: 3
---

# Phase 2 Plan 01: Shared protocol package Summary

Wire types moved into `@agent-manager/protocol` (consumed by FE via vite/tsconfig alias and by server via `file:` link + built dist), with never-throwing, table-driven runtime validators for the eight existing messages.

## Commits
- cd0f572 feat: package skeleton, consumers rewired
- f13b355 test: failing validator tests (RED)
- eca1273 feat: validators (GREEN)

## Verification
- npx vitest run packages/protocol: 2 files, 70 tests passed
- root npm test: 25 files, 202 tests passed (Task 1 alone: 24 files / 135 tests; baseline 23 / 132)
- server npm test: 7 files, 51 tests passed
- npx tsc --noEmit, npm run build:protocol, server build: exit 0; dist/index.d.ts present
- no import into server source remains under src/
- removing a table row makes package typecheck fail (checked once, reverted)

## Deviations from Plan
- Worktree was based on 95521d0, not master ff4e6e9; fast-forwarded to master (no-force) before starting.
- Task 2 committed as RED then GREEN (TDD), 3 commits total.
- Validator `agent:create` returns the trimmed name.

## Known Stubs
None.

## Self-Check: PASSED
