---
phase: 08-auth-and-secure-transport
plan: 04
subsystem: auth
tags: [token-dialog, logout, command-palette, sessionStorage, a11y]
status: complete

requires:
  - phase: 08-03
    provides: token store, transport auth_failed latch, WsAdapter epoch/authRequired
provides:
  - logout() ordered, guarded session teardown
  - submitToken() single restart path after auth_failed
  - TokenDialog (password, OverlayPortal + useModalFocus) opened by useAuthPrompt on auth_failed transitions
  - Header Log out button and palette auth.logout command (token-gated)
  - resetAgentStore() (only new agentStore export)
affects: [08-05 docs and QA, Phase 13 workspace persistence (keys must use agent-manager. prefix), Phase 21 diagnostics export]

actuals:
  tokens: 21000
  tasks: 3
  commits: 3
plan_head_before: 76c724248756ab8897e6ab9b81742659920674f0
plan_head_after: 762892d428d1c5b7a969909affcc8ac3b94f97e4
commits: 3

key-files:
  created:
    - src/services/session/logout.ts
    - src/services/session/submitToken.ts
    - src/components/layout/TokenDialog.tsx
    - src/hooks/useAuthPrompt.ts
    - src/services/session/__tests__/logout.test.ts
    - src/services/session/__tests__/submitToken.test.ts
    - src/store/__tests__/agentStoreReset.test.ts
    - src/components/layout/__tests__/TokenDialog.test.tsx
    - src/hooks/__tests__/useAuthPrompt.test.tsx
    - src/components/layout/__tests__/authScrubUi.test.tsx
  modified:
    - src/store/agentStore.ts
    - src/store/uiStore.ts
    - src/components/layout/Header.tsx
    - src/components/layout/ConnectionBanner.tsx
    - src/components/layout/CommandPalette.tsx
    - src/App.tsx
    - src/keyboard/commands.ts
    - docs/KEYBOARD.md
    - src/App.test.tsx
    - src/components/__tests__/Header.test.tsx
    - src/components/layout/__tests__/ConnectionBanner.test.tsx
    - src/components/layout/__tests__/CommandPalette.test.tsx
    - src/keyboard/__tests__/commands.test.ts
    - src/keyboard/__tests__/commandsOperations.test.ts
    - src/store/__tests__/uiStore.test.ts

key-decisions:
  - "useAuthPrompt subscribes to the connection store and reacts to state transitions (plus an on-mount check), so an Escape-dismissed dialog stays dismissed until the next real auth_failed"
  - "Logout leaves the connection store's mode alone and re-syncs epoch/authRequired from the adapter snapshot"

duration: 30min
completed: 2026-11-15
---

# Phase 8 Plan 04: Token dialog and logout Summary

A masked token dialog now opens when a live connection reaches `auth_failed`, each submit makes exactly one connection attempt, and Log out (header button or palette command, shown only with a token) tears the whole session down in a safe order.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 Tracer: logout, resetAgentStore, Header Log out | 2da79a1 | token, stores, storage prefix sweep, socket all cleared; mode kept; no reconnect; Workspace panes unmount (A3 confirmed) |
| 2 Token dialog, useAuthPrompt, submitToken, banner, App | 6a0cf0c | password input, focus trap, Escape/Cancel non-destructive; banner has only "Enter token" in auth_failed |
| 3 Palette command, memo dep, KEYBOARD.md, UI canary | 762892d | auth.logout appears/disappears live; canary absent from console, DOM, attributes, store JSON, storage beyond the one key |

## Verification

- Root `npm test`: 110 files, 2185 passed, 2 todo (Phase 21 hand-off in authScrubTransport and authScrubUi). Baseline before this plan: 2017 passed.
- `npx tsc --noEmit`, `npm run build`, `npm run build:protocol`, `npm --prefix server test` (749), `npm --prefix server run build`, `npm run contract:check`: all clean.
- No change to server/, packages/protocol, transport, adapters, backend.ts, package.json or lockfiles.

## Deviations from Plan

**1. [Environment] `server/node_modules` symlinked** from the main checkout (git-ignored) in addition to root `node_modules`: root vitest also collects `server/**` tests. No package installed.

**2. [Test design] resetAgentStore module-map clearing is not directly observable.** `goneSince` only matters for a create ack arriving after a removal that followed the send, which resetAgentStore also invalidates (pending is cleared). The test asserts the observable result (a snapshot after reset behaves as on a fresh store); the map clearing is by construction (`Map.clear()`, `snapshotAt = 0`, new Set).

**3. [Test design] TokenDialog "value in no attribute" check** excludes the password input's own `value` attribute (React reflects a controlled input's value into the attribute in jsdom). This matches the plan's "other than the input's own value" wording.

**4. [Test design] Timer-count claim for the UI "no storm" test** replaced by a connect/reconnectNow call count over a 10 minute fake-timer advance (jsdom focus/React timers made `getTimerCount() === 0` meaningless in a mounted tree). The logout test still asserts zero timers.

**5. [Process] Plan commit ledger file not written**: the shared `.git/worktrees` path is outside the isolated worktree write scope. `plan_head_before` is the known base 76c7242, `commits` measured with `git rev-list --count`.

**6. [Observation] `server/__tests__/hardening.test.ts` "never terminates a responsive client"** failed once under load in the first full root run (timing-based, server-owned, unrelated) and passed on rerun; not touched.

Edits to existing tests were confined to: the `ConnectionBanner.test.tsx` auth_failed case, the `commandsOperations.test.ts` allowlist line, and additive imports/`vi.mock` of the logout module (Header, commands, CommandPalette tests). Default-list assertions are untouched.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-08-19 to T-08-21 mitigated and test-asserted; T-08-22 accepted: toasts hold agent names only and expire in 5 s).

## Hand-offs

- 08-05: manual QA of the dialog against a gateway with `AGENT_MANAGER_TOKEN`; Phase 13 workspace persistence must name storage keys `agent-manager.*` so logout's prefix sweep covers them.
- Phase 21: replace the `it.todo('Copy diagnostics redacts the token (INT-10, Phase 21)')` entries.

## Self-Check: PASSED

- Files exist: logout.ts, submitToken.ts, TokenDialog.tsx, useAuthPrompt.ts and all new test files (verified by the passing suite).
- Commits 2da79a1, 6a0cf0c, 762892d are ancestors of HEAD.
