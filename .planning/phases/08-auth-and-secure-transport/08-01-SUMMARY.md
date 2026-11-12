---
phase: 08-auth-and-secure-transport
plan: 01
subsystem: gateway
tags: [auth, handshake, throttle, config, redaction]
requires: ["06-07"]
provides: ["constant-time token guard", "checkHello pre-auth verdict", "buildHelloAck", "bounded failure throttle", "clientKey with trust-proxy rule", "redactSecrets/safeLogError", "token validation, bind policy, trust-proxy parsing"]
affects: [server/src/config.ts, server/src/gateway]
key-files:
  created:
    - server/src/gateway/auth.ts
    - server/src/gateway/authThrottle.ts
    - server/src/gateway/handshake.ts
    - server/src/gateway/__tests__/auth.test.ts
    - server/src/gateway/__tests__/authThrottle.test.ts
    - server/src/gateway/__tests__/handshake.test.ts
    - server/__tests__/authConfig.test.ts
  modified:
    - server/src/config.ts
key-decisions:
  - "Guard keeps only a SHA-256 digest in its closure and compares with timingSafeEqual on equal-length buffers"
  - "Lock strikes survive a lapsed lock for one extra window so doubling works; entries are forgotten after that"
  - "Drift tests live in server/__tests__/authConfig.test.ts (outside tsc rootDir, so the spec file can be read); GATEWAY_CAPABILITIES is exported from handshake.ts"
requirements: [INT-02]
status: complete
commits: 4
plan_head_before: 154d7c8a50c8eb02224b13e72bc43fb8d85d2bb6
plan_head_after: 888673dc237a50abcf3bd064e1b3d53397da2116
actuals:
  tokens: 50000
  tasks: 3
  commits: 4
---

# Phase 8 Plan 1: Authentication core primitives Summary

Pure, individually tested auth modules for the gateway (constant-time token guard, single pre-auth `checkHello` verdict, validated `hello_ack` builder, bounded per-key failure throttle, trust-proxy-aware client key, redaction helpers, and token/bind/proxy startup validation); nothing is wired, so the running gateway behaves as before.

## Commits
- 4ae0e30 feat(08-01): tracer - checkHello verdict and hello_ack builder with constant-time token guard
- e7b73bc feat(08-01): bounded auth throttle, client key resolution, redaction helpers
- 34b7a57 feat(08-01): token validation, bind policy and trust-proxy parsing in config
- 888673d test(08-01): run auth config and handshake tests in the node environment

## Results
- Server suite: 30 files / 749 tests (baseline 28 / 668 before this plan). Root suite: 100 files / 2011 tests, green.
- New tests: auth 15, authThrottle 19, handshake 27, authConfig 45 (incl. drift cases). auth+handshake: 25 after Task 1, 42 after Task 2.
- `server/__tests__/hardening.test.ts` NOT edited and passes as written; the reworded `assertLoopbackBind` message keeps `/HOST/`, `/no authentication/i`, `/unset HOST or use 127\.0\.0\.1/i`.
- `npm run contract:check`: OK relative to HEAD, zero surface diff; `packages/protocol` untouched.
- server `tsc --noEmit`, root `tsc --noEmit`, server build, `build:protocol` green. `check-wave-collisions.mjs --pending` exits 0.
- `grep -c setInterval|setTimeout authThrottle.ts` is 0; `timingSafeEqual` appears twice outside comments in auth.ts.

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree dependencies.** No node_modules in the worktree: root `node_modules` and `server/node_modules` are git-ignored symlinks to the main checkout. `@agent-manager/protocol` therefore resolves to the main checkout's package for `tsc`/build (identical content at this base); vitest aliases to the worktree source.

**2. [Rule 1 - Test fix] Node environment for two test files.** The root vitest run uses jsdom, where `import.meta.url` is not a file URL; `authConfig.test.ts` and `handshake.test.ts` gained `// @vitest-environment node` (same as `serviceLayerBoundary.test.ts`). Commit 888673d.

**3. [Placement] Drift cases in `authConfig.test.ts`, not `handshake.test.ts`.** Tests under `server/src` are compiled by `tsc` with `rootDir: src`, so reading the contract spec and `server/package.json` fits `server/__tests__`. Both files are plan-owned. `GATEWAY_CAPABILITIES` is exported from `handshake.ts` for the capability drift check.

**4. [Test shape] `clientKey` takes a structural `KeyedRequest` type** (`socket.remoteAddress`, `headers`) so tests need no real sockets; `IncomingMessage` satisfies it.

## Known Stubs
None.

## Threat Flags
None. `checkHello`, throttle and config add no network surface until 08-02 wires them.

## Self-Check: PASSED
All 8 plan files exist; commits 4ae0e30, e7b73bc, 34b7a57, 888673d are ancestors of HEAD.
