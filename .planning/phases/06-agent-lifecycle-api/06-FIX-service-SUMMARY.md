---
phase: 06-agent-lifecycle-api
plan: FIX-service
status: complete
plan_head_before: e45b27b
plan_head_after: a28c846
commits: 3
---

# Phase 6 Fix: AgentService review findings 6 and 7 Summary

Late driver callbacks of a removed agent are now dropped, and the 500 ms initialCmd timer is tracked, cancelled on removal and unref'd.

## Finding 6 (real, fixed) - 5febd82
`onData` and `onError` in `create()` mutated status and published `agent:output` / `agent:status_change` for an agent already removed by `close()` / `destroy()`. Both now return early unless `this.agents.get(id) === agent`. Failing tests written first (late error, late output); a live-agent test guards the unchanged path.

## Finding 7 (real, fixed) - d330021
The initialCmd `setTimeout` was untracked. Handle is stored per agent in `initialCmdTimers`, cleared in `remove()` (the single path for `close()` and `destroy()`), deleted on fire, and `unref()`'d. Failing tests first: no write after close, no write after destroy, `unref` called.

## Deviations
- [Rule 2] The `getOrCreateDriver` onData (discovered tmux agents) had the same unguarded publish; guarded identically (same file, same defect).
- Test harness: FakeDriver now captures `onData` / `onError` so tests can fire late callbacks. a28c846 fixes a tsc error in that harness.

## Gate
root tsc, server tsc (after build:protocol), server tests 593, root tests 1838, root and server builds, contract:check OK. No real tmux sessions touched.

## Self-Check: PASSED
