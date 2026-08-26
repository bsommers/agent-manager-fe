# Multi-Agent Command Fan-Out & Global Output Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement multi-agent command fan-out broadcasting with safety confirmation gating, global terminal output search over bounded ring buffers with jump-to-pane navigation, and real-time status change toast notifications.

**Architecture:** Extend the WebSocket JSON protocol with an `agent:broadcast` payload handled by `SessionManager.ts`, implement a bounded per-agent ring buffer store (`logBufferStore.ts`) in the frontend, add `BroadcastBar` & `DestructiveSafetyModal` UI in `Toolbar.tsx`, add `GlobalSearchModal` for cross-agent log queries, and add `NotificationToastManager` for status alerts.

**Tech Stack:** React 18, TypeScript, Zustand, xterm.js, Node.js, Express, WebSockets, Vitest, `@testing-library/react`.

## Global Constraints
- All existing 92 tests plus new tests must pass cleanly.
- Both frontend (`npm run build`) and backend (`npx tsc --project server/tsconfig.json`) must compile with 0 errors.
- Bounded ring buffers must enforce a hard cap of 10,000 lines per agent to prevent DOM or memory bloat.

---

### Task 1: Protocol Extension & Backend Broadcast Routing

**Files:**
- Modify: `server/src/protocol/wsProtocol.ts`
- Modify: `src/services/wsProtocol.ts`
- Modify: `server/src/services/SessionManager.ts`
- Test: `server/src/protocol/__tests__/wsProtocol.test.ts`
- Test: `server/src/services/__tests__/SessionManager.test.ts`

**Interfaces:**
- Consumes: `{ type: 'agent:broadcast'; targetAgentIds: string[]; data: string }`
- Produces: Multicast input distribution in `SessionManager`

- [ ] **Step 1: Write failing protocol and SessionManager unit test**

In `server/src/services/__tests__/SessionManager.test.ts`, write a test verifying that receiving `agent:broadcast` calls `driver.write(data)` for all specified `targetAgentIds`.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run server/src/services/__tests__/SessionManager.test.ts`
Expected: FAIL (`agent:broadcast` unhandled type error)

- [ ] **Step 3: Update `server/src/protocol/wsProtocol.ts` with `agent:broadcast` message type**

```typescript
export type WSMessageClient =
  | { type: 'agent:input'; agentId: string; data: string }
  | { type: 'agent:resize'; agentId: string; cols: number; rows: number }
  | { type: 'agent:create'; name: string; mode: AgentMode; targetHost: string; initialCmd?: string }
  | { type: 'agent:kill'; agentId: string }
  | { type: 'agent:broadcast'; targetAgentIds: string[]; data: string };
```

- [ ] **Step 4: Update `SessionManager.ts` to handle `agent:broadcast`**

```typescript
case 'agent:broadcast':
  msg.targetAgentIds.forEach((id) => this.sendInput(id, msg.data));
  break;
```

- [ ] **Step 5: Run tests and typecheck to verify pass**

Run: `npx vitest run server/src/services/__tests__/SessionManager.test.ts && npx tsc --project server/tsconfig.json`
Expected: PASS with 0 errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/protocol/wsProtocol.ts src/services/wsProtocol.ts server/src/services/SessionManager.ts server/src/services/__tests__/SessionManager.test.ts
git commit -m "feat(protocol): add agent:broadcast payload support in WebSocket server and SessionManager"
```

---

### Task 2: Log Buffer Store (`logBufferStore.ts`) & Output Ingestion

**Files:**
- Create: `src/store/logBufferStore.ts`
- Modify: `src/services/agentSocket.ts`
- Test: `src/store/__tests__/logBufferStore.test.ts`

**Interfaces:**
- Consumes: `agentSocket.subscribe(msg)` where `msg.type === 'agent:output'`
- Produces: `useLogBufferStore` hook with `appendOutput`, `searchLogs`, `clearBuffer`, `getAgentLogs`

- [ ] **Step 1: Write failing unit test for `logBufferStore`**

In `src/store/__tests__/logBufferStore.test.ts`, test output appending, 10,000 line capacity ring buffer trimming, cross-agent search query execution, and log clearing.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/store/__tests__/logBufferStore.test.ts`
Expected: FAIL (store missing)

- [ ] **Step 3: Implement `logBufferStore.ts` and subscribe to `agentSocket`**

```typescript
import { create } from 'zustand';
import { agentSocket } from '../services/agentSocket';

export interface LogLine {
  id: string;
  agentId: string;
  timestamp: number;
  text: string;
}

export interface LogSearchResult {
  line: LogLine;
  matchIndex: number;
}

// Bounded ring buffer implementation per agent
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/store/__tests__/logBufferStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/logBufferStore.ts src/services/agentSocket.ts src/store/__tests__/logBufferStore.test.ts
git commit -m "feat(store): add bounded ring buffer logBufferStore and output subscription"
```

---

### Task 3: Broadcast Bar Component & Destructive Safety Modal

**Files:**
- Create: `src/components/layout/BroadcastBar.tsx`
- Create: `src/components/layout/DestructiveSafetyModal.tsx`
- Modify: `src/components/layout/Toolbar.tsx`
- Test: `src/components/layout/__tests__/BroadcastBar.test.tsx`

**Interfaces:**
- Consumes: `agentStore.agents`, `agentSocket.send({ type: 'agent:broadcast', ... })`
- Produces: Targeted command fan-out toolbar UI with destructive command confirmation modal

- [ ] **Step 1: Write failing component test for `BroadcastBar` and safety modal**

In `src/components/layout/__tests__/BroadcastBar.test.tsx`, test target selection (`All`, `Filtered`, `Selected`), normal command dispatch, and destructive command (`rm -rf`) modal interception requiring user confirmation.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/components/layout/__tests__/BroadcastBar.test.tsx`
Expected: FAIL (components missing)

- [ ] **Step 3: Implement `DestructiveSafetyModal.tsx` and `BroadcastBar.tsx`**

Build modal and bar controls integrated into `Toolbar.tsx`. Include target checkboxes, target count pill, and input field with Enter key handling.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/components/layout/__tests__/BroadcastBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/BroadcastBar.tsx src/components/layout/DestructiveSafetyModal.tsx src/components/layout/Toolbar.tsx src/components/layout/__tests__/BroadcastBar.test.tsx
git commit -m "feat(ui): add BroadcastBar and DestructiveSafetyModal for multi-agent command fan-out"
```

---

### Task 4: Global Log Search Modal & Jump-to-Pane Navigation

**Files:**
- Create: `src/components/layout/GlobalSearchModal.tsx`
- Modify: `src/components/layout/Header.tsx`
- Test: `src/components/layout/__tests__/GlobalSearchModal.test.tsx`

**Interfaces:**
- Consumes: `logBufferStore.searchLogs`, `agentStore.bringToFront`
- Produces: Overlay modal for querying logs across all agents with jump-to-pane click handling

- [ ] **Step 1: Write failing component test for `GlobalSearchModal`**

In `src/components/layout/__tests__/GlobalSearchModal.test.tsx`, test opening modal via shortcut/button, entering search query, rendering matching lines grouped by agent name, and clicking a result to invoke `bringToFront(agentId)` and close modal.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/components/layout/__tests__/GlobalSearchModal.test.tsx`
Expected: FAIL (component missing)

- [ ] **Step 3: Implement `GlobalSearchModal.tsx` and integrate trigger in `Header.tsx`**

Build search UI with input, keyboard shortcut listener (`Ctrl+Shift+F`), regex/substring toggle, result count badge, and jump-to-pane click event.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/components/layout/__tests__/GlobalSearchModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/GlobalSearchModal.tsx src/components/layout/Header.tsx src/components/layout/__tests__/GlobalSearchModal.test.tsx
git commit -m "feat(ui): add GlobalSearchModal for cross-agent log search and jump-to-pane navigation"
```

---

### Task 5: Real-Time Notification Toast Manager

**Files:**
- Create: `src/components/layout/NotificationToastManager.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/layout/__tests__/NotificationToastManager.test.tsx`

**Interfaces:**
- Consumes: `agentSocket.subscribe(msg)` where `msg.type === 'agent:status_change'`
- Produces: Floating status toast notifications for `error` or `disconnected` status transitions

- [ ] **Step 1: Write failing component test for `NotificationToastManager`**

In `src/components/layout/__tests__/NotificationToastManager.test.tsx`, test receiving `agent:status_change` with status `'error'` rendering a red toast with agent name, auto-dismissing after 5 seconds, or manual dismiss click.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/components/layout/__tests__/NotificationToastManager.test.tsx`
Expected: FAIL (component missing)

- [ ] **Step 3: Implement `NotificationToastManager.tsx` and mount in `App.tsx`**

Build toast container rendering active notifications with icon badges and auto-close timers.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/components/layout/__tests__/NotificationToastManager.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full verification suite**

Run: `npm test && npm run build && npx tsc --project server/tsconfig.json`
Expected: ALL tests pass with 0 TypeScript compilation errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/NotificationToastManager.tsx src/App.tsx src/components/layout/__tests__/NotificationToastManager.test.tsx
git commit -m "feat(ui): add NotificationToastManager for real-time status transition alerts"
```
