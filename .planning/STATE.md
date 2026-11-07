# State

## Current Position
Milestone: v1.1 Fan-out Close-out (active); v2.0 Live-Connected Command Center and v2.1 Multi-Backend and Fleet defined in ROADMAP.md
Phase: 1-4 planned (wave 1); phases 5-26 defined but not yet planned
Status: Wave 1 plans written and ready for `/gsd-execute-phase` (parallel worktrees)
Last activity: 2026-11-07 - reconciled FE/BE contract, roadmap and requirements; wave-1 plans created

## Wave 1 plan set (execute in parallel worktrees; file ownership is disjoint)

| Plan | Phase | Wave | Depends on | Owns (summary) |
|------|-------|------|------------|----------------|
| 01-01 | 1 Verify and reconcile fan-out and search | 1 | - | `.planning/phases/01-*/01-EVIDENCE.md`, fan-out plan doc, `README.md`, `docs/ARCHITECTURE.md`, `docs/qa-test-plan.md` |
| 02-01 | 2 Shared Protocol Package | 1 | - | `packages/protocol/**` (skeleton, validators), `vite.config.ts`, `tsconfig.json`, `package.json`, `server/package.json`, `server/package-lock.json`, `server/vitest.config.ts`, `server/src/protocol/wsProtocol.ts`, `src/services/wsProtocol.ts`, `src/types/agent.ts` |
| 03-01 | 3 Transport Reconnect and Connection State | 1 | - | `src/services/{agentSocket,backend}.ts`, `src/services/{transport,adapters}/**`, `src/store/connectionStore.ts`, `src/setupTests.ts`, `src/vite-env.d.ts` + their tests |
| 04-01 | 4 Gateway Baseline Hardening | 1 | - | `server/src/{index,config}.ts`, `server/__tests__/{index,hardening}.test.ts`, `server/README.md` |
| 02-02 | 2 | 2 | 02-01 | `packages/protocol/**` (full v2 message set, fixtures) |
| 03-02 | 3 | 2 | 03-01 | `ConnectionStatusChip`, `ConnectionBanner`, `Header.tsx`, `App.tsx`, `docs/RUNNING.md`, `docs/RATIONALE_AND_DESIGN_DECISIONS.md` |
| 02-03 | 2 | 3 | 02-01, 02-02 | `packages/protocol/**` (surface snapshot, contract check), root `package.json`, `.github/workflows/ci.yml` |

Merge gate after wave 1: run `npm run build:protocol && npm test && npx tsc --noEmit && npm run build && npm --prefix server test && npm --prefix server run build`. The FE heartbeat (03-01) expects the gateway `pong` (04-01); they are only verified together after merge.

## Decisions
- Contract: `docs/superpowers/specs/2026-11-07-fe-be-contract.md` reconciles the backend integration plan and the UI/integration milestones (log in its section 15).
- Port 8088 is canonical (code + ADR-006); `VITE_BACKEND_URL` is the FE setting, `VITE_WS_URL` stays as deprecated alias.
- Shared schema lives in `packages/protocol` (`@agent-manager/protocol`); FE resolves it by Vite alias + tsconfig paths, server by `file:` dependency to the built `dist`.
- Auth is first-message `hello` (token never in a URL). Non-loopback bind is refused until Phase 8.
- Requirement keys: `UX-nn` for UI milestones (the UI plan's `UI-nn` collides with shipped `UI-01`), `INT-nn`, `GW-nn`, `ADP-nn`.
- UI-8 (a11y) moved to wave 2 (shares `Header.tsx`/`App.tsx` with Phase 3 and `package.json` with Phase 2); INT-10 follows INT-7; connection chip/banner delivered in Phase 3, pane states/error boundary in Phase 9.
- No registry packages are added in wave 1 (validators are hand-written); Phases 5 and 7 add devDependencies and need a Package Legitimacy Audit in their RESEARCH.md.
- External repos (cvm, climah, mads, mad) are read-only inputs; adapters use recorded fixtures committed here.

## Open questions (from the backend plan, to resolve in Phases 24-26)
1. Does climah expose an approve/deny command for gates, or must one be added upstream?
2. Is a climah `Agent` per run, per level or per agent name within a run (proposed: per agent name)?
3. cvm interactive attach (WS PTY) is out of scope; track as upstream feature.
4. mads has no remote; it needs one before becoming a hard dependency (Phase 26 is optional).

## Interim behavior to remember
- After Phase 3 and before Phase 10, live mode still starts with the seed agents in the roster and their panes stay empty; Demo mode (`VITE_DEMO_MODE=1`) keeps the old demo experience.

## Notes
- Onboarded 2026-11-07. Fan-out/search code merged on master; docs plan checkboxes unticked (closed by plan 01-01).
- Other agents write new files in docs/superpowers/plans/; do not commit them from GSD.
- Baseline at 05b3782: root 23 files / 132 tests, server 7 files / 51 tests, tsc and build green.
