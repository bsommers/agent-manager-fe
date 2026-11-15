# QA Test Plan & Skeptical Codebase Audit

**Date:** 2026-08-09  
**Role:** Senior Quality Assurance & Reliability Engineer  
**Scope:** AI Agent Manager Frontend UI (`agent-manager-fe`)

---

## 1. Executive Summary & Skeptical Audit Findings

While the application compiles cleanly (`vite build`) and initial test runs showed `7/7 passing`, a rigorous QA audit reveals significant testing gaps and latent runtime vulnerabilities:

### 🚨 Critical Testing Gaps ("False Sense of Security")
1. **Placeholder Assertions**: `App.test.tsx` literally asserts `expect(true).toBe(true)`. Zero DOM mounting or rendering tests exist for the main application shell.
2. **Shallow Component Checks**: `TerminalView.test.tsx` and `AgentComponents.test.tsx` only assert `expect(Component).toBeDefined()`. Components are never rendered, props are never exercised, and user interactions are completely unverified.
3. **Zero Test Coverage for Core Services**:
   - `src/services/agentSocket.ts` (WebSocket lifecycle, subscriptions, message routing) has zero test files.
   - `src/services/mockStreamGenerator.ts` (ANSI terminal string formatting, mock commands) has zero test files.
4. **Incomplete Store Test Coverage**: `src/store/agentStore.ts` only tests basic initial count and `addAgent`/`removeAgent`. Store methods like `toggleUndock`, `updateFloatingPosition`, `bringToFront`, `setLayoutMode`, and `setSearchQuery` are untested.

### 🐛 Latent Runtime & Memory Leak Risks
1. **Unmount Event Listener Leak in `FloatingPane.tsx`**: `handleMouseDown` attaches `mousemove` and `mouseup` to `window` without unmounting cleanup if the pane unmounts during active drag.
2. **WebSocket Connection Failover Flaw in `agentSocket.ts`**: `connectLive()` initializes `new WebSocket(url)` inside a synchronous `try...catch`, but async connection failures (`onerror`, `onclose`) do not reset `isMockMode = true` or clear `ws`, causing dropped messages on live connection failure.
3. **Uncleared `setTimeout` in `TerminalView.tsx`**: The `isActive` effect schedules a 50ms `fit()` delay without capturing or clearing the timer handle on component unmount.
4. **Clear Command Format in `AgentControls.tsx`**: `handleClear` sends raw `'clear'` without trailing `\n` or `\r`, leaving the command text in the prompt buffer without executing it.

---

## 2. QA Remediation Strategy

1. **Environment Upgrade**:
   - Add `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom` for true DOM component testing in Vitest.
2. **Implementation Hardening**:
   - Fix window event listener leaks in `FloatingPane.tsx`.
   - Fix async WebSocket error/close failover handlers in `agentSocket.ts`.
   - Fix `setTimeout` cleanup in `TerminalView.tsx`.
   - Add trailing `\r` to `handleClear` in `AgentControls.tsx`.
   - Fix focus mode filtering logic in `Workspace.tsx`.
3. **Comprehensive Test Suite Expansion**:
   - **`src/services/__tests__/mockStreamGenerator.test.ts`**: Unit test ANSI banner generation, `help`, `status`, `run`, and unknown command outputs.
   - **`src/services/__tests__/agentSocket.test.ts`**: Test WebSocket subscription dispatch, mock message routing, and listener unsubscription.
   - **`src/store/__tests__/agentStore.test.ts`**: Deep unit tests for all store actions (`toggleUndock`, `bringToFront`, `setLayoutMode`, floating coordinate updates).
   - **`src/components/__tests__/Header.test.tsx`**: Test status metrics counter rendering (Active, Thinking, SSH, Tmux).
   - **`src/components/__tests__/Toolbar.test.tsx`**: Test search input triggers and layout mode button clicks.
   - **`src/components/__tests__/AddAgentModal.test.tsx`**: Test form input, validation, mode toggling, submission, and cancel actions.
   - **`src/App.test.tsx`**: Full DOM integration test rendering the complete application layout.

---

## 5. Manual QA: Fan-out, Search, Toasts

Covers multi-agent broadcast, the destructive-command gate, global log search, and status toasts against a live stack. Use only throwaway sessions created by this procedure.

**Environment:** run `npm run start:all` and open http://localhost:3000.

### Setup
1. Create two tmux agents with "Add Agent": `qa-a` with target host `localhost:qa_a`, and `qa-b` with target host `localhost:qa_b`. Expected: each pane first shows Starting and then the shell prompt once the gateway confirms.
   - 1a. Stop the gateway, then click Add Agent for a throwaway name. Expected: no pane appears and an error notice says the backend is not connected. Restart the gateway afterwards.
   - 1b. Reload the page while `qa-a` and `qa-b` exist. Expected: both panes are back without clicking Add Agent, and there are no duplicates.
   - 1c. Restart only the gateway with the page open. Expected: after the reconnect the pane list equals the gateway's connect snapshot, replacing whatever events had built (agents whose tmux session still exists come back under the discovered name `Tmux: <session>`), with no duplicate panes.
   - 1d. Look at the prompts of `qa-a` and `qa-b` right after they appear. Expected: no stray characters such as `1;2c` or `0;276;0c` at the prompt, and the first command you type is not altered.
   - 1e. Open a second browser tab on the same page. Create an agent in the first tab and check that it appears in the second without a reload; then close it from the second tab and check that it disappears from the first.
   - Note: a cancelled create still produces one ordinary agent when the gateway had already received it. A create sent just before a disconnect is re-sent after the reconnect and appears once.

### Broadcast
2. In the broadcast bar select both `qa-a` and `qa-b` (target mode "Selected"). Expected: the bar shows 2 targets.
3. Send `echo qa-broadcast-ok`. Expected: `qa-broadcast-ok` is printed in both panes.

### Destructive gate (Cancel path only)
4. Type a command matching a destructive pattern (for example one beginning with `sudo `, without pressing any key that confirms) in the broadcast bar and send it. Expected: the safety modal appears.
5. Choose Cancel. Expected: the modal closes and nothing is sent to either pane. Never confirm a destructive command.

### Search
6. Press Ctrl+Shift+F. Expected: the global search modal opens.
7. Search `qa-broadcast-ok`. Expected: hits from both `qa-a` and `qa-b` (two hits expected, one per agent; if the shell echo of the typed command is also buffered, a pane may show an additional hit for it).
8. Enable the Regex toggle and search `qa-broadcast-.+`. Expected: results are shown.
9. With Regex still enabled, search the invalid pattern `qa-(`. Expected: an invalid-expression message and an empty result list, no crash.
10. Disable Regex, search `qa-broadcast-ok`, and choose a hit. Expected: the modal closes and the matching agent pane is focused.

### Toasts
11. In the `qa-b` pane type `exit` to end its shell. Expected: within a few seconds a disconnected or error toast naming `qa-b` appears.

### Cleanup
12. Remove only the `qa-a` and `qa-b` agents from the UI. Closing leaves the tmux sessions running by design. A pane disappears only after the gateway confirms the close. Do not kill any tmux session other than `qa_a` and `qa_b`.
   - 12b. Run `tmux list-sessions`. Expected: `qa_a` is still listed; `qa_b` ended in step 11 when its shell exited.

### Kill tmux session
13. Add Agent `qa-a` again with target host `localhost:qa_a`. Expected: the pane attaches to the surviving session. Click Kill tmux session on `qa-a`. Expected: a confirmation names `qa_a`. Choose Cancel: the modal closes and `qa_a` is still listed by `tmux list-sessions`. Click Kill tmux session again and choose Kill session. Expected: the pane disappears after the gateway confirms and `tmux list-sessions` no longer lists `qa_a`. Do not kill any tmux session other than `qa_a`.

---

## 6. Manual QA: Auth and secure transport (Phase 8)

Covers the browser-side behavior of token authentication. The server side of steps 2, 5, 7 and 11 is already automated by `server/scripts/smoke-auth.mjs` (run it first: `npm --prefix server run build && node server/scripts/smoke-auth.mjs`); everything else needs a browser. Use a free port for the gateway and a throwaway token, and do not touch gateways or tmux sessions that are not yours.

**Environment:** `export AGENT_MANAGER_TOKEN="$(openssl rand -base64 32)"`, start the gateway with `PORT=<free port> npm run start:backend`, and start the UI with `VITE_BACKEND_URL=http://localhost:<free port> npm run start:frontend` (add that UI origin to `ALLOWED_ORIGINS` if it is not a default one).

1. Open the UI configured for the token gateway. Expected: the masked token dialog appears and no roster or panes are shown.
2. Enter a wrong token. Expected (browser): the dialog reappears with the "Authentication failed" hint after exactly one attempt; the Network tab shows one WebSocket and no further reconnects. (Server side automated: smoke check 4.)
3. Enter the right token. Expected: the chip shows Connected and the roster arrives.
4. Inspect the Network and Application tabs. Expected: the WebSocket URL has no query string, no request URL contains the token, and the only storage entry is `agent-manager.token` in session storage.
5. Submit five wrong tokens, then a sixth. Expected (browser): the UI reports a connection problem and the gateway closes with 4429; after the lock lapses (about 60 seconds) a correct token connects. (Server side automated: smoke check 8.)
6. Reload the tab. Expected: the session persists and connects without the dialog. Close the tab and open the UI again. Expected: the dialog appears.
7. Run `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/api/agents` and again with `-K` a curl config file holding the Bearer header. Expected: `401` and `200`. (Automated: smoke check 7.)
8. Click Log out in the header. Expected: roster, panes and terminal output disappear, session storage is empty, and the dialog opens.
9. Open the command palette. Expected: "Log out" is listed only while signed in (not before a token is entered, not after logging out).
10. Configure the UI with an `http://` non-loopback backend URL (for example `VITE_BACKEND_URL=http://example.test`). Expected: the banner shows the plaintext refusal and the Network tab shows no WebSocket.
11. Start the gateway with `HOST` set to a non-loopback address and no token. Expected: it refuses to start with a message naming `AGENT_MANAGER_TOKEN`. (Automated: smoke check 1.)
12. Optional, with a TLS proxy set up per docs/RUNNING.md: open the UI over https. Expected: the wss connection works, and a client cannot influence the throttle by sending its own `X-Forwarded-For`.

Cleanup: unset `AGENT_MANAGER_TOKEN`, stop only the gateway and UI you started, and delete any curl config file you created.

### Persistence hand-off

Any future storage key (for example Phase 13 workspace persistence) must start with `agent-manager.`. Logout sweeps exactly that prefix from session and local storage, so a key outside it would survive a logout.
