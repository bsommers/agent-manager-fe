# State

## Current Position
Milestone: v1.1 Fan-out Close-out (active, open only for a human QA checkpoint); v2.0 Live-Connected Command Center and v2.1 Multi-Backend and Fleet defined in ROADMAP.md
Phase: waves 1 and 2 executed and merged (wave 2 at master d17af86: 02-02, 03-02, 05-01); next is wave 3 (02-03, plus 05-02/05-03 still to be planned)
Status: Wave 2 merged and green. Phase 3 (transport + connection UI) is complete pending manual QA. Phase 1 stays open for the human QA checkpoint only.
Last activity: 2026-11-07 - wave 2 executed in parallel worktrees, merged, merge gate passed

## Wave 1 results (merged, green)

| Plan | Result | Summary |
|------|--------|---------|
| 01-01 | Partial: VER-01 PASS, DOC-01 docs reconciled; manual tmux/browser QA PENDING-HUMAN | `.planning/phases/01-*/01-01-SUMMARY.md`, `01-EVIDENCE.md` |
| 02-01 | Complete: `packages/protocol` (`@agent-manager/protocol`) with hand-written table-driven validators for the 8 existing messages; FE (alias) and server (`file:` link to built dist) consume it | `02-01-SUMMARY.md` |
| 03-01 | Complete: Transport (500 ms x2 / 15 s full-jitter reconnect, 15 s ping / 10 s timeout heartbeat, 4401 auth_failed), WsAdapter, MockAdapter (explicit Demo mode), `connectionStore`, truthful `agentSocket` shim | `03-01-SUMMARY.md` |
| 04-01 | Complete: loopback-only bind (non-loopback HOST refused), Origin allowlist (403), 1 MiB frame cap (1009), app `pong`, hostile-frame guard, liveness reaping, `server/README.md` | `04-01-SUMMARY.md` |

Merged baseline (master 3beb488): root `npm test` 32 files / 311 tests, `npm --prefix server test` 8 files / 98 tests, `npx tsc --noEmit` clean, `npm run build` and `npm --prefix server run build` pass.

Not verified end to end: the FE heartbeat (03-01) and the gateway `pong` (04-01) are each covered by unit tests but have never run against each other; the first real check is manual QA or the Phase 7 e2e suite.

## Wave 2 results (merged, green)

| Plan | Result |
|------|--------|
| 02-02 | Complete: hello/hello_ack, capabilities, error codes, ping/update/history/approve client messages, reqId; protocol tests 70 -> 145; fixtures incl. 16 invalid cases |
| 03-02 | Complete: ConnectionStatusChip in Header, ConnectionBanner in App, RUNNING/ADR-007/ARCHITECTURE/README updated |
| 05-01 | Complete: `useModalFocus` focus trap/restore; DestructiveSafetyModal as alertdialog (initial focus Cancel), AddAgentModal and GlobalSearchModal dialog semantics |

Merged gate (master d17af86): root 39 files / 439 tests, server 8 files / 98 tests, tsc clean, build:protocol, root build and server build pass.

## Wave 2 plan set (execute in parallel worktrees; file ownership is disjoint, checked by `node .planning/tools/check-wave-collisions.mjs --pending`)

| Plan | Phase | Wave | Depends on | Owns |
|------|-------|------|------------|------|
| 02-02 | 2 Shared Protocol Package | 2 | 02-01 (done) | `packages/protocol/src/{fieldspec,validate,capabilities,errors,messages,index}.ts`, `packages/protocol/src/__tests__/{conformance,validate-v2,errors}.test.ts`, `packages/protocol/fixtures/{client,server,invalid}.json`, the contract spec doc (corrections only) |
| 03-02 | 3 Transport and Connection State | 2 | 03-01 (done) | `ConnectionStatusChip.tsx`, `ConnectionBanner.tsx` (+ tests), `Header.tsx`, `Header.test.tsx`, `App.tsx`, `App.test.tsx`, `docs/RUNNING.md`, `docs/RATIONALE_AND_DESIGN_DECISIONS.md`, `docs/ARCHITECTURE.md`, `README.md` |
| 05-01 | 5 Keyboard-First and Accessibility | 2 | - (no functional dependency; shares no file with 03-02 or the package.json owners) | `src/hooks/useModalFocus.ts` (+ test), `DestructiveSafetyModal.tsx`, `AddAgentModal.tsx`, `GlobalSearchModal.tsx` and their tests |

Owned by nobody in wave 2 (do not touch): `package.json`, lockfiles, `vite.config.ts`, `tsconfig.json`, `src/setupTests.ts`, `server/**`, `.github/**`, `Toolbar.tsx`.

Later plans already written (not wave 2): 02-03 (wave 3, needs 02-02: gateway-to-client messages, Agent fields, HTTP shapes, limits, drift guards), 02-04 (wave 4, needs 02-03: surface snapshot, `contract:check`, CI, owns root `package.json`). To plan after wave 2 merges: 05-02 and 05-03 (wave 3), Phase 6 (wave 4), 05-04 and Phase 8 (wave 5), Phase 7 (wave 6); see ROADMAP.md "Plan-level schedule".

Merge gate after each wave (run from the repo root after `npm ci` in the root and in `server/`): `npm run build:protocol && npm test && npx tsc --noEmit && npm run build && npm --prefix server test && npm --prefix server run build`, plus the collision script for the next wave. Expected counts only grow from 311 (root) and 98 (server).

## Decisions
- Contract: `docs/superpowers/specs/2026-11-07-fe-be-contract.md` reconciles the backend integration plan and the UI/integration milestones (log in its section 15).
- Port 8088 is canonical (code + ADR-006); `VITE_BACKEND_URL` is the FE setting, `VITE_WS_URL` stays as deprecated alias.
- Shared schema lives in `packages/protocol` (`@agent-manager/protocol`); FE resolves it by Vite alias + tsconfig paths, server by `file:` dependency to the built `dist`.
- Auth is first-message `hello` (token never in a URL). Non-loopback bind is refused until Phase 8.
- Requirement keys: `UX-nn` for UI milestones (the UI plan's `UI-nn` collides with shipped `UI-01`), `INT-nn`, `GW-nn`, `ADP-nn`.
- Plans are scheduled with one global wave counter (ROADMAP "Plan-level schedule"), not per phase, so later plans of a phase can overlap other phases' plans when files are disjoint.
- Phase 2 re-cut (2026-11-07): the unreviewed original 02-02 held ~25 messages, HTTP shapes and limits in 3 tasks of 8+ files, so it was split into 02-02 (engine, hello tracer, errors, client messages), 02-03 (server messages, Agent fields, HTTP, limits, drift guards) and 02-04 (the original 02-03: surface snapshot, `contract:check`, CI). Fixes made while re-verifying: the original had `agent:error` using an error list that was only created in a later task (reordered), omitted `BackendInfo.agentSpecs`, applied `reqId` to messages the spec does not give it, assumed the field-spec vocabulary (map, enum list, literal, JSON, tag-dispatched variants, cross-field rules) existed when it does not, and listed stale baselines.
- Phase 3 plan 03-02 gained README.md and docs/ARCHITECTURE.md updates (both still described the removed automatic mock fallback) and a precondition; CI in 02-04 uses Node 22 (Node 20 is past end of life).
- Phase 5 is split by file ownership: 05-01 (modal focus and labels) is the only part that shares nothing with Header.tsx, App.tsx or package.json, so it runs in wave 2; the palette, pane chrome and axe/theme work follow once 03-02 and 02-04 own those files.
- No registry packages are added in waves 1-2 (validators and the focus trap are hand-written); 05-04 and Phase 7 add devDependencies and need a Package Legitimacy Audit in their RESEARCH.md.
- Drift guards: 02-03 adds tests pinning `DEFAULT_BACKOFF`/`DEFAULT_HEARTBEAT` (FE) and `MAX_PAYLOAD_BYTES` (gateway) to the package's `LIMITS`.
- External repos (cvm, climah, mads, mad) are read-only inputs; adapters use recorded fixtures committed here.

## Open items for a human
1. Run the manual QA in `docs/qa-test-plan.md` section 5 (live tmux + browser) and record the per-step result in `.planning/phases/01-*/01-EVIDENCE.md`; this closes Phase 1.
2. When creating worktrees for wave 2, base them on current master: wave-1 executors started from the pre-planning commit 95521d0 and had to fast-forward before they could read their plans.

## Open questions (from the backend plan, to resolve in Phases 24-26)
1. Does climah expose an approve/deny command for gates, or must one be added upstream?
2. Is a climah `Agent` per run, per level or per agent name within a run (proposed: per agent name)?
3. cvm interactive attach (WS PTY) is out of scope; track as upstream feature.
4. mads has no remote; it needs one before becoming a hard dependency (Phase 26 is optional).

## Interim behavior to remember
- After Phase 3 and before Phase 10, live mode still starts with the seed agents in the roster and their panes stay empty; Demo mode (`VITE_DEMO_MODE=1`) keeps the old demo experience.
- Until 03-02 merges there is no visible connection indicator in the UI (the state exists in `connectionStore` only).

## Notes
- Onboarded 2026-11-07. Fan-out/search code merged on master; docs plan checkboxes ticked by plan 01-01.
- Other agents write new files in docs/superpowers/plans/; do not commit them from GSD.
- Original baseline at 05b3782: root 23 files / 132 tests, server 7 files / 51 tests.
