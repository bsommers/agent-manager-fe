---
phase: 08-auth-and-secure-transport
plan: 05
subsystem: docs-and-verification
tags: [auth, smoke, docs, nginx, adr, qa]
requires: ["08-02", "08-04"]
provides: ["real-process auth smoke test", "operator docs for token, bind policy, trust-proxy and nginx TLS", "ADR-013", "contract-spec prose matching the implementation", "Phase 8 browser QA checklist and evidence"]
affects: [server/scripts/smoke-auth.mjs, docs, README.md, server/README.md]
key-files:
  created:
    - server/scripts/smoke-auth.mjs
    - .planning/phases/08-auth-and-secure-transport/08-EVIDENCE.md
  modified:
    - docs/RUNNING.md
    - README.md
    - server/README.md
    - docs/ARCHITECTURE.md
    - docs/RATIONALE_AND_DESIGN_DECISIONS.md
    - docs/superpowers/specs/2026-11-07-fe-be-contract.md
    - docs/qa-test-plan.md
key-decisions:
  - "The smoke gives children an empty TMUX_TMPDIR so the real gateway cannot see or touch any real tmux session"
  - "Throttle check runs in its own child on its own port, after the HTTP checks, so it cannot lock the source used by checks 3 to 7"
  - "Spec prose updated in section 1 rows as well (stale 'until token auth ships'); the 4.x, 7 and 8 tables are untouched"
requirements: [INT-02]
status: complete
commits: 4
plan_head_before: 13baf366c42db5fe6817201ac356fb09240e53f7
plan_head_after: 83b96db6c336a695ce851d68a95de65f7cbd0a38
actuals:
  tokens: 36000
  tasks: 3
  commits: 4
duration: 45min
completed: 2026-11-15
---

# Phase 8 Plan 5: Smoke test, operator docs, ADR-013 and QA checklist Summary

A committed smoke script drives the built gateway as a real process (env-var token, refusal exits, WS 4401/4429, hello_ack before the roster, Bearer on /api, health forms, no token in output), and the docs now describe the shipped behavior: token and bind rules, trust-proxy, an nginx TLS example, troubleshooting, ADR-013, corrected contract-spec prose and a 12-step browser QA checklist recorded PENDING-HUMAN.

## Commits
- 30dc9e3 feat(08-05): tracer - real-process auth smoke test and evidence
- e116465 docs(08-05): operator documentation for token auth, bind policy and nginx TLS
- d41b673 docs(08-05): ADR-013, architecture notes, contract-spec prose corrections, auth QA checklist
- 83b96db docs(08-05): record gate results in 08-EVIDENCE.md

## Results
- Smoke: 9 PASS, 0 FAIL, exit 0; no child left running; no fixed port used.
- Gate: root `npm test` 113 files / 2281 passed (2 todo); server `npm test` 33 / 845; root and server `tsc --noEmit`, root build, server build, `build:protocol`, `contract:check` (OK, zero surface diff) all green; `check-wave-collisions --pending` OK. The known hardening flake did not occur.
- Stale-sentence gate prints nothing (baseline 6 lines in 3 files). `proxy_add_x_forwarded_for` appears nowhere in docs.
- No file under `src/`, `server/src`, `packages/`, package.json, lockfiles or `.github/` changed.
- Hand-offs recorded in ARCHITECTURE.md and the QA plan: Phase 21 diagnostics export must use `src/services/redact.ts`; Phase 13 persistence keys must be named `agent-manager.*` so logout's prefix sweep covers them.

## Deviations from Plan

**1. [Rule 1 - Bug] Smoke hello needed `contract`.** The first draft sent `{type:'hello', token}`; the gateway correctly rejected it as invalid (uncounted 4401), which failed checks 5 and 8 and let check 4 pass for the wrong reason. The script now sends `contract: 1`. Documented in 08-EVIDENCE.md.

**2. [Rule 2 - Isolation] Empty `TMUX_TMPDIR` for smoke children.** The real gateway runs tmux discovery at start-up; pointing tmux at a fresh temp directory guarantees the smoke cannot see, attach to or affect real sessions (e.g. QA sessions). Not in the plan; the temp directory is removed afterwards.

**3. [Scope] Contract spec section 1 table rows.** Two "Decisions at a glance" rows (Canonical host, Server configuration) still said auth ships later; edited as prose. They begin with a pipe, which the plan's acceptance wording would flag, but they are not among the tables the tests parse (4.1, 4.2, 4.3, 7, 8). Also edited prose at lines 39 and 290 and the ADR-012 residual-risk sentence.

**4. [Process] Plan commit ledger not written** (shared `.git/worktrees` path is outside the isolated worktree scope, same as 08-04); `plan_head_before` is the known base and `commits` is measured with `git rev-list --count`.

**5. [Environment] `node_modules` and `server/node_modules` symlinked** from the main checkout (git-ignored); no package installed.

**6. [Verification note]** An unanchored `pgrep -f 'server/dist/index.js'` always reports 1 (the invoking shell); the evidence uses the anchored form and records 0 before and after.

## Known Stubs
None.

## Threat Flags
None. T-08-23 mitigated (nginx example overwrites X-Forwarded-For, sets Host, explains both; append form absent), T-08-24 mitigated (token only in child env, searched in all child output, docs use env/curl config file), T-08-25 mitigated (stale gate empty).

## Pending human work
Browser QA (docs/qa-test-plan.md section 6, 12 steps) is PENDING-HUMAN in 08-EVIDENCE.md section B; steps 7 and 11 pass via the smoke, steps 2 and 5 pass on the server side only.

## Self-Check: PASSED
smoke-auth.mjs, 08-EVIDENCE.md and all edited docs exist; commits 30dc9e3, e116465, d41b673, 83b96db are ancestors of HEAD.
