---
phase: 06-agent-lifecycle-api
plan: 07
subsystem: gateway
tags: [destructive-policy, operations-catalog, http, contract]
requires: ["02.1-02", "06-02", "06-06"]
provides: ["catalog-derived destructive policy stage", "POST /api/agents/:id/kill", "ADR-012"]
affects: [server/src/gateway, server/src/http, packages/protocol]
key-files:
  created:
    - server/src/gateway/policy.ts
    - server/src/gateway/__tests__/policy.test.ts
    - server/__tests__/destructivePolicy.test.ts
  modified:
    - server/src/gateway/dispatch.ts
    - server/src/http/apiRouter.ts
    - packages/protocol/src/operations.ts
    - packages/protocol/src/__tests__/operations.test.ts
    - packages/protocol/contract.snapshot.json
    - docs/superpowers/specs/2026-11-07-fe-be-contract.md
    - docs/ARCHITECTURE.md
    - docs/RATIONALE_AND_DESIGN_DECISIONS.md
    - server/README.md
key-decisions:
  - "Destructive rules derive from OPERATIONS (destructive + confirmParam); startup throws without a confirmParam"
  - "Policy stage is the first statement of AgentApi.route, before idempotency, lookup and service"
  - "Refusal message field is the ws discriminator when it selects the operation (killSession), else the operation name"
requirements: [GW-05]
status: complete
commits: 3
plan_head_before: d23d42f3074e072cd3048c227e47b95676326dbf
plan_head_after: 5f365b89e7edd6aaeaf1807b7af4ef5e7316b24d
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
---

# Phase 6 Plan 7: Catalog-driven destructive policy Summary

One policy stage derived from the operations catalog refuses any destructive operation lacking an exact `confirm: true` on WS and HTTP, and `agent.kill` gains the additive `POST /api/agents/:id/kill`.

## Commits
- fecf953 feat(06-07): catalog-derived destructive policy stage (policy.ts, dispatch.ts, policy.test.ts, WS walk)
- ebbc575 feat(06-07): POST /api/agents/:id/kill (catalog binding, snapshot, router, spec, HTTP walk)
- 5f365b8 docs(06-07): static bypass tests, completeness, spec 6.5, ARCHITECTURE, ADR-012, README

## Results
- Root suite 92 files / 1832 tests (baseline 90 / 1765); server 25 / 587 (baseline 23 / 520). tsc, root build, server build, build:protocol green.
- `contract:check --base d23d42f`: `additive: operations.agent.kill.http: binding added`, exit 0, no BREAKING.
- Snapshot diff: 12 insertions, 1 deletion, only `operations.agent.kill.http` (null -> binding object). Changed paths: `operations.agent.kill.http.{headerParams,input,method,path,pathParams,status}`.
- policy.test.ts 29 cases; destructivePolicy.test.ts 38 cases (WS walk, HTTP walk, pending-surface, static call-site, completeness).
- Existing kill-session suites (killSession, SessionManagerKillSession, tmuxKill) untouched and passing. hardening.test.ts did not flake.

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree dependencies.** No node_modules in the worktree: root symlinked to the main checkout; server/node_modules rebuilt as a real directory of per-entry symlinks with `@agent-manager/protocol` pointing at the worktree's own `packages/protocol` (a plain directory symlink would have resolved to the main checkout's protocol build). Untracked and git-ignored.

**2. [Rule 1 - Test fix] Warning-line id test.** The plan's 300-character id never reaches the policy over a real socket or HTTP (frame validation rejects ids over 128 characters first). The WS walk uses a 128-character id and asserts the line carries exactly 64 characters; the 300-character case is covered at unit level in policy.test.ts and dispatch via AgentApi. The service-level 300-char test remains in SessionManagerKillSession.test.ts.

**3. [Rule 3] operations.test.ts edit beyond the plan's two lines.** The generic "destructive and read-only invariants" case asserted `'none' in op.http` for every destructive operation; removed (an HTTP binding on a destructive operation is now legitimate).

**4. [Rule 3] Router refactor.** Extracted `requireJson` and `readReqId` helpers from the create route so both POST routes share the content-type and Idempotency-Key handling. Behaviour of POST /api/agents is unchanged (httpApi.test.ts unedited and passing).

**5. Test additions.** destructivePolicy.test.ts mocks SshDriver (for the 422 ssh case). The static and completeness cases passed on first run (Tasks 1-2 already satisfied them); kept as regression pins. `$START` for contract:check was d23d42f.

## Known Stubs
None.

## Threat Flags
None beyond the plan's register: the one new route is covered by T-06-28/T-06-32 tests (foreign Origin 403, text/plain 400, confirm only from body).

## Self-Check: PASSED
policy.ts, both test files and this summary exist; commits fecf953, ebbc575, 5f365b8 are ancestors of HEAD.
