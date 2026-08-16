# Codebase Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement architectural improvements outlined in `CODEBASE_STRUCTURE_AND_COUPLING_REPORT.md` (Protocol consolidation, direct PTY keystroke forwarding, Zustand store migration, proactive session streaming).

**Architecture:** Consolidate WebSocket protocol schemas into a single source of truth, update TerminalView to forward raw PTY stream data on keypress, convert custom agentStore state module to standard Zustand store, and eagerly instantiate drivers in SessionManager for auto-discovered sessions.

**Tech Stack:** React 18, TypeScript, Zustand, xterm.js, Node.js, Express, WebSockets, Vitest.

## Global Constraints
- All 69 existing unit/integration tests must pass or be updated to match the improved signatures.
- Both frontend (`npm run build`) and backend (`npx tsc --project server/tsconfig.json`) must build with zero TypeScript errors.
- Do not introduce breaking API changes between frontend and backend WebSocket contracts.

---

### Task 1: Protocol Schema Consolidation (Single Source of Truth)

**Files:**
- Modify: `src/services/wsProtocol.ts`
- Modify: `server/src/protocol/wsProtocol.ts`
- Test: `server/src/protocol/__tests__/wsProtocol.test.ts`

**Interfaces:**
- Consumes: `AgentMode`, `AgentStatus`, `AgentLayout`, `Agent`, `WSMessageClient`, `WSMessageServer`
- Produces: Unified protocol definitions shared by both client and server

- [ ] **Step 1: Write/Update protocol test for canonical export**

Ensure `server/src/protocol/__tests__/wsProtocol.test.ts` validates client and server payload types against the canonical schema.

- [ ] **Step 2: Update `src/services/wsProtocol.ts` to re-export canonical definitions**

```typescript
export * from '../../server/src/protocol/wsProtocol.js';
```

- [ ] **Step 3: Run tests and type check to verify protocol consolidation**

Run: `npm test` and `npm run build`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/wsProtocol.ts server/src/protocol/wsProtocol.ts
git commit -m "refactor(protocol): consolidate WebSocket protocol schema to single source of truth"
```

---

### Task 2: Install Zustand and Migrate `agentStore` to Standard Zustand Store

**Files:**
- Modify: `package.json`
- Create/Modify: `src/store/agentStore.ts`
- Test: `src/store/__tests__/agentStore.test.ts`

**Interfaces:**
- Consumes: `Agent`, `LayoutMode`, `agentSocket`
- Produces: `useAgentStore` hook and `agentStore` state store API

- [ ] **Step 1: Install `zustand` dependency**

Run: `npm install zustand`

- [ ] **Step 2: Update `src/store/__tests__/agentStore.test.ts` for store reset and operations**

Verify unit tests for grid, focus, cascade layout algorithms, agent add/remove, and floating window state.

- [ ] **Step 3: Refactor `src/store/agentStore.ts` using `create<AgentStore>()`**

Implement standard Zustand store with actions for `setActiveAgentId`, `setLayoutMode`, `setSearchQuery`, `addAgent`, `removeAgent`, `toggleUndock`, `updateFloatingPosition`, `updateFloatingBounds`, `arrangeGrid`, `arrangeCascade`, `arrangeFocus`, `bringToFront`.

- [ ] **Step 4: Run test suite to verify store migration**

Run: `npm test`
Expected: All 69 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/store/agentStore.ts src/store/__tests__/agentStore.test.ts
git commit -m "refactor(store): migrate custom store to standard Zustand store"
```

---

### Task 3: Direct Keystroke Forwarding in `TerminalView.tsx` and Mock Handling

**Files:**
- Modify: `src/components/agent/TerminalView.tsx`
- Modify: `src/services/mockStreamGenerator.ts`
- Test: `src/components/agent/__tests__/TerminalView.test.tsx`
- Test: `src/services/__tests__/mockStreamGenerator.test.ts`

**Interfaces:**
- Consumes: `term.onData`, `agentSocket.send({ type: 'agent:input', agentId, data })`
- Produces: Real-time raw PTY keystroke streaming for terminal interactive features (vim, htop, arrow keys)

- [ ] **Step 1: Update `TerminalView.tsx` for direct keystroke forwarding**

In `TerminalView.tsx`, forward raw data events from `term.onData((data) => agentSocket.send({ type: 'agent:input', agentId, data }))`. In mock mode or local terminal echo, write input character or buffer lines as needed for mock command execution.

- [ ] **Step 2: Update `MockStreamGenerator.ts` line-buffer for mock mode**

Enhance `MockStreamGenerator` to handle character-by-character inputs during offline/mock fallback, buffering until Enter (`\r`) while echoing characters.

- [ ] **Step 3: Run terminal tests**

Run: `npm test`
Expected: Terminal tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/agent/TerminalView.tsx src/services/mockStreamGenerator.ts src/services/__tests__/mockStreamGenerator.test.ts
git commit -m "feat(terminal): enable direct raw PTY keystroke streaming for interactive CLI sessions"
```

---

### Task 4: Proactive Session Driver Attachment in `SessionManager`

**Files:**
- Modify: `server/src/services/SessionManager.ts`
- Test: `server/src/services/__tests__/SessionManager.test.ts`

**Interfaces:**
- Consumes: `discoverTmuxSessions()`
- Produces: Immediate `TmuxDriver` instantiation on `initialize()` for discovered sessions

- [ ] **Step 1: Update `server/src/services/__tests__/SessionManager.test.ts`**

Add test case verifying that `SessionManager.initialize()` eagerly sets up drivers for discovered sessions so stdout output streams immediately upon connection.

- [ ] **Step 2: Update `SessionManager.initialize()` to eagerly attach drivers**

In `SessionManager.ts`:
```typescript
async initialize(): Promise<void> {
  const discovered = await discoverTmuxSessions();
  for (const agent of discovered) {
    this.agents.set(agent.id, agent);
    // Eagerly instantiate driver for discovered session so output streaming is active
    this.getOrCreateDriver(agent.id);
  }
}
```

- [ ] **Step 3: Run server tests and typecheck**

Run: `npm test` and `npx tsc --project server/tsconfig.json`
Expected: All tests pass cleanly with 0 TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/SessionManager.ts server/src/services/__tests__/SessionManager.test.ts
git commit -m "feat(server): eagerly instantiate session drivers for auto-discovered tmux sessions"
```
