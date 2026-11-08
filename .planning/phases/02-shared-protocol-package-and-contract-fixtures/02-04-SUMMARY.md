---
phase: 02-shared-protocol-package-and-contract-fixtures
plan: 04
subsystem: protocol
tags: [protocol, contract-gate, snapshot, ci, github-actions]
requires: ["02-02", "02-03"]
provides: ["describeSurface", "contract.snapshot.json", "contract:check gate", "ci workflow"]
affects: [frontend, server, ci]
key-files:
  created:
    - packages/protocol/src/surface.ts
    - packages/protocol/contract.snapshot.json
    - packages/protocol/scripts/contract-check.ts
    - packages/protocol/README.md
    - .github/workflows/ci.yml
    - packages/protocol/src/__tests__/surface.test.ts
    - packages/protocol/src/__tests__/surface-diff.test.ts
    - packages/protocol/src/__tests__/contract-check.test.ts
    - packages/protocol/src/__tests__/ci-workflow.test.ts
  modified:
    - packages/protocol/src/index.ts
    - packages/protocol/tsconfig.json
    - packages/protocol/tsconfig.build.json
    - package.json
decisions:
  - "stringArray and objectArray both surface as kind array (item or fields), matching the plan's kind vocabulary"
  - "Diff attributes the plan did not list (literal value, tag field, trim, dropUnknown, status of an error code) are classified breaking, the conservative choice"
  - "contract-check compares the live surface (equal to the committed snapshot after the staleness check) with the snapshot at the base ref"
  - "actions pinned to 40-hex SHAs resolved with gh api: actions/checkout v4.4.0 11d5960a..., actions/setup-node v4.4.0 49933ea5...; README pinning caveat dropped"
status: complete
commits: 3
plan_head_before: 32f051d56a24c70b98bbbbf9d93aef4254d5c4f6
plan_head_after: f1851e79444e3a6f3c84ff6cecaebb0334c52c4b
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
---

# Phase 2 Plan 04: Contract surface snapshot, drift gate and CI Summary

Deterministic `describeSurface()` pinned in `contract.snapshot.json`, a `contract:check` CLI that fails a breaking surface change unless `CONTRACT_VERSION` was raised, and a SHA-pinned, read-only CI workflow that runs the full suite plus the gate (INT-08).

## Commits

| Task | Commit | Description |
|---|---|---|
| 1 | 8ad1f75 | describeSurface, serializeSurface, snapshot, surface tests |
| 2 | bedbf1f | diffSurface, evaluate, isSafeGitRef, contract-check CLI, root scripts, tsconfig changes |
| 3 | f1851e7 | ci.yml, protocol README, ci-workflow policy test |

## Failure conditions (each covered by an automated test)

- `contract:check` exit 2: `--base --evil`, `--base=--evil`, `--base` with no value, empty or shell-metacharacter ref, unknown or stray argument, ref git cannot resolve. Git is not run for a rejected ref (`contract-check.test.ts`, `surface-diff.test.ts`).
- Exit 1: snapshot file differs from the live surface (stale), or a breaking change relative to the base with `CONTRACT_VERSION` not raised. Tested with a removed required field and a removed message type, using throwaway git repos as the base.
- Exit 0: base equals live; base has no snapshot (new package); an additive change; the same breaking change when the base contract number is lower (version raised, prints a notice).
- `surface.test.ts` fails when any validator field changes without regenerating the snapshot (checked once by hand by changing `agent:resize.cols.max`, then reverted), and fails on an unknown field-spec kind.
- `ci-workflow.test.ts` fails unless: exactly one `permissions:` block, top-level, equal to `contents: read`; no `secrets` reference; every `uses:` is `owner/repo@<40-hex>` with a `# vX.Y.Z` comment and only checkout and setup-node are used; `github.base_ref` appears only directly under `env:`; no `${{ }}` inside any `run:`. Mutation-checked by hand (unpinned action and inlined base_ref both fail).

## Amendments applied

1. Actions pinned to commit SHAs (resolved via `gh api`), README caveat removed.
2. `surface.test.ts` asserts the 9.1 `agent:kill` fields (agentId required; killSession, confirm, reqId optional) and `errorCodes.USAGE === 400`; the spec section 4.1/4.2 message lists and section 8 constants are read from the spec file and compared against the live tables and `LIMITS`, not typed from memory.
3. `ci-workflow.test.ts` written first (RED: ci.yml missing) and then ci.yml.
4. Negative CLI tests added (see above).
5. `tsconfig.json` include is now `["src", "scripts"]` and `tsconfig.build.json` pins `"include": ["src"]` in the same commit (dist still emits only src, no scripts).
6. Precondition verified: `agent:kill` is in CLIENT_TABLE and `fixtures/client.json` has 5 agent:kill entries (invalid.json 3).

## Deviations from Plan

- **[Process]** Task 1's `surface.ts` was written before its test was run, so the RED run for Task 1 was not observed. Compensated by the hand mutation check described above. Task 3 followed RED then GREEN.
- **[Scope]** Extra test files beyond the plan's list: `surface-diff.test.ts`, `contract-check.test.ts`, `ci-workflow.test.ts` (the last required by the amendments).
- Node used locally is v26; CI pins Node 22. `vite-node` is the transitive one from vitest 1.6.1 (no new packages installed).
- STATE.md, ROADMAP.md and REQUIREMENTS.md were not updated from this worktree; the orchestrator owns those after merge.

## Verification

Root `npm test` 72 files / 1123 tests, server `npm test` 13 files / 208 tests, `npx tsc --noEmit`, `npm run build`, `npm --prefix server run build`, `npm run build:protocol` (emits dist/index.js and dist/index.d.ts), protocol typecheck including scripts, `npm run contract:check -- --base HEAD` exit 0. A hand edit removing `ping.t` with the snapshot regenerated made `contract:check` exit 1 (reverted).

## Known Stubs

None.

## Threat Flags

None. T-02-12..T-02-15 mitigated: base ref via env only; read-only permissions, no secrets, SHA-pinned official actions; argv-only git with validated ref; stale snapshot fails the check.

## Self-Check: PASSED

Files exist (surface.ts, snapshot, CLI, README, ci.yml, four tests); commits 8ad1f75, bedbf1f, f1851e7 are on the branch.
