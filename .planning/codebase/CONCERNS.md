# Codebase Concerns

**Analysis Date:** 2026-11-07

## Tech Debt

**Hardcoded seed agents in production store:**
- Issue: `INITIAL_AGENTS` demo data is the store default.
- Files: `src/store/agentStore.ts`
- Impact: Fake agents appear in real use until `setAgents` overwrites them.
- Fix approach: Start empty; move seeds to mock mode only.

**Silent fallback to mock mode:**
- Issue: WS error/close permanently sets mock mode with no reconnect.
- Files: `src/services/agentSocket.ts`
- Impact: Users may see simulated output believing it is live; backend restart needs page reload.
- Fix approach: Add reconnect with backoff and a visible "mock/offline" indicator.

**Store Proxy compatibility layer with `any`:**
- Files: `src/store/agentStore.ts`, `src/store/logBufferStore.ts`
- Impact: Bypasses type safety and React subscriptions; duplicated access paths.
- Fix approach: Migrate callers to `useAgentStore` and delete the proxies.

**Committed build output in server:**
- Files: `server/dist/` is present on disk (root `.gitignore` ignores `dist`, so likely untracked; stale copies can mislead).

**No lint/format tooling:** no ESLint/Prettier; `noUnusedLocals` disabled (`tsconfig.json`).

## Security Considerations

**Unauthenticated WebSocket that spawns shells/SSH:**
- Risk: Any client reaching port 8088 can drive tmux/SSH sessions; no origin check or auth.
- Files: `server/src/index.ts`, `server/src/services/SessionManager.ts`
- Current mitigation: none detected; the destructive-command confirmation modal is UI-only (`src/components/layout/DestructiveSafetyModal.tsx`).
- Recommendations: Bind to localhost, verify `Origin`, add a token.

**Unvalidated client messages:**
- `JSON.parse(...) as WSMessageClient` is a cast with no schema validation (`server/src/index.ts`); `targetHost`/session names flow into `TmuxDriver` (`server/src/services/TmuxDriver.ts`) and SSH parsing. Spawn uses an args array (no shell injection), but validate names.

**SSH keys:** default key paths read from home (`server/src/config.ts`, `server/src/utils/sshKeyLoader.ts`); confirm host key verification is handled in `server/src/services/SshDriver.ts`.

**Frontend `JSON.parse` of server messages** is unguarded (`src/services/agentSocket.ts` onmessage) and can throw.

## Performance Bottlenecks

**Global log search:** regex run per line across all buffers on every keystroke (`src/components/layout/GlobalSearchModal.tsx`, `src/store/logBufferStore.ts`). User regex may cause catastrophic backtracking. Debounce and cap results.

## Fragile Areas

**Largest components:** `src/components/layout/GlobalSearchModal.tsx` (315 lines), `BroadcastBar.tsx` (214); mix of state, search, and UI.
**Test-mode branching in production code:** `process.env.NODE_ENV === 'test'` in `src/services/agentSocket.ts`; prefer dependency injection.

## Scaling Limits

Log ring buffer is bounded (`src/store/logBufferStore.ts`) but per-agent PTY sessions are all in-process in `SessionManager`; no limit on agent count.

## Missing Critical Features

No CI, no e2e tests, no authentication, no persistence of agents across reloads.

## Test Coverage Gaps

- `src/components/layout/Header.tsx` has only a render smoke test; `Toolbar`/`Workspace` thin.
- Live-WS path of `agentSocket.ts` (reconnect, malformed JSON) is untested because tests force mock mode.
- Server `index.ts` tested only via bootstrap; no malformed or hostile message tests. Priority: High for server input handling.

---

*Concerns audit: 2026-11-07*
