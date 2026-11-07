---
phase: 04-gateway-baseline-hardening
plan: 01
subsystem: server
tags: [gateway, websocket, security, hardening]
requires: []
provides: [loopback-bind, origin-allowlist, frame-cap, app-pong, liveness]
affects: [server/src/config.ts, server/src/index.ts]
key-files:
  created: [server/__tests__/hardening.test.ts, server/README.md]
  modified: [server/src/config.ts, server/src/index.ts, server/__tests__/index.test.ts]
requirements: [GW-01]
status: complete
plan_head_before: ff4e6e9
commits: 3
---

# Phase 04 Plan 01: Gateway Baseline Hardening Summary

Gateway now binds loopback only (non-loopback HOST refused), enforces a WebSocket Origin allowlist (403), caps frames at 1 MiB (close 1009), answers application pings, ignores hostile frames and reaps unresponsive sockets.

## Commits
- b81a153 loopback bind + assertLoopbackBind, listen-error rejection
- dac46ec Origin allowlist (parseAllowedOrigins) + maxPayload
- 0d78c88 app pong, structural frame guard, liveness interval, server README

## Verification
- `npm --prefix server test`: 8 files, 98 tests passed (baseline 7 files / 51 tests)
- `npm --prefix server run build`: exit 0
- root `npm test`: 24 files, 179 tests passed

## Deviations from Plan
- Worktree was created at 95521d0 (pre-planning); fast-forwarded to ff4e6e9 (ff-only) to obtain the plan.
- Test-only: assertion regex made case-insensitive for the "Unset HOST or use 127.0.0.1" message.

## Known Stubs
None.
