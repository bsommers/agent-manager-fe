---
phase: 06-agent-lifecycle-api
plan: FIX-gateway
status: complete
commits: 2
plan_head_before: e45b27b
---

# Phase 6 Fix: gateway review findings 4 and 5

## Finding 4: idempotency eviction (real, fixed)

Before: at the 1024-entry cap the oldest entry was evicted whether or not its call was still in flight. A client could send 1024 cheap successful frames with distinct reqIds, evict a pending create's key, and a retry of that reqId then ran a second create.

Fix in `server/src/gateway/idempotency.ts`:
- Entries carry a `settled` flag, set when the outcome resolves or rejects.
- A full cache evicts the oldest settled entry only. If every entry is in flight, the new request is refused with `RATE_LIMITED` (`retryable: true`, fixed message), exec is not called, and the cache does not grow.
- The TTL purge skips in-flight entries, so a slow create is not expired mid-flight.
- Bounds (1024 entries, 5 min) and at-most-once semantics are unchanged. Failed outcomes are still removed.

Tests (written first, failed before the fix): oldest completed is evicted while a pending one is kept and its retry replays; full-of-in-flight gives RATE_LIMITED, no exec, no growth, and admits again after one settles; an in-flight entry survives the TTL.

## Finding 5: swallowed exceptions (real, fixed)

Before: `AgentApi.execute()` returned INTERNAL on a thrown or rejected route/service call with no log.

Fix in `server/src/gateway/dispatch.ts`: `internalFailure()` logs one `console.error` line, `dispatch: <message type> failed with an internal error: <err.message sliced to 200, newlines folded>`, and returns the fixed `internal error` outcome. The client reply never echoes the error.

Tests (written first, failed before the fix): a service that throws synchronously and one that rejects asynchronously; each checks one bounded log line containing the operation and the message, and that the reply is fixed and omits the secret text.

## Deviations

- Logging uses `console.error`, matching the rest of the server, as the repo has no logger abstraction. The "operation name" in the log is the wire message type (for example `agent:create`).
- The new idempotency tests sit inside the existing last `describe` block (`fingerprintOf`) in the test file. This is cosmetic.

## Verification

tsc clean, server tests 592 passed (25 files), root tests 1837 passed (92 files), root and server builds clean, `contract:check` OK. Files touched: only `server/src/gateway/idempotency.ts`, `server/src/gateway/dispatch.ts` and their two test files.
