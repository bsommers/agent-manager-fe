# Comprehensive Test Suite Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand test suite scope, breadth, depth, and statement/branch/function coverage across frontend and backend components from ~81% to >95%.

**Architecture:** Add integration test suites for the HTTP/WS server entrypoint (`server/src/index.ts`), expand component tests for `FloatingPane`, `AgentControls`, `Workspace`, and `TerminalView`, and add edge-case unit tests for `AgentSocketService`, `MockStreamGenerator`, and `agentStore`.

**Tech Stack:** Vitest, React Testing Library, `@testing-library/user-event`, `supertest` / WebSocket mock client, JSDOM.

## Global Constraints
- Target test coverage: >95% statements, >90% functions, >90% branches.
- All 69 existing tests plus new tests must pass reliably without race conditions or flaky timers.
- Must clean up all event listeners, timers, and DOM nodes after each test run.

---

### Task 1: Server Entrypoint & WebSocket Server Integration Tests

**Files:**
- Create: `server/__tests__/index.test.ts`
- Modify: `server/src/index.ts` (export app/bootstrap handle for testing if needed)

**Interfaces:**
- Consumes: Express `/health` endpoint, WebSocketServer connection events (`message`, `close`, `error`)
- Produces: Comprehensive HTTP and WebSocket server integration coverage

- [ ] **Step 1: Write failing server integration test (`server/__tests__/index.test.ts`)**

Test HTTP GET `/health` returning `{ status: 'ok', agents: N, timestamp: ... }`, WebSocket client connection handling, client message parsing, invalid JSON message resilience, socket `close` event, and socket `error` event handling.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run server/__tests__/index.test.ts`
Expected: FAIL (file or exported server handle missing)

- [ ] **Step 3: Update `server/src/index.ts` to export bootstrap/app/server for testability**

Export `bootstrap` and `app` / `server` handles cleanly without auto-executing when imported in tests.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run server/__tests__/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/__tests__/index.test.ts
git commit -m "test(server): add integration tests for HTTP health endpoint and WebSocket connection lifecycle"
```

---

### Task 2: Drag & Resize Window Interactions Test for `FloatingPane.tsx`

**Files:**
- Create: `src/components/layout/__tests__/FloatingPane.test.tsx`
- Modify: `src/components/layout/FloatingPane.tsx`

**Interfaces:**
- Consumes: `agentStore.updateFloatingPosition`, `agentStore.updateFloatingBounds`, `agentStore.bringToFront`
- Produces: 100% interactive mouse drag and resize handle test coverage

- [ ] **Step 1: Write failing `FloatingPane` interaction test**

Test mousedown + mousemove + mouseup header dragging updating position (`x`, `y`), and mousedown + mousemove + mouseup bottom-right handle drag updating window dimensions (`width`, `height`).

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/components/layout/__tests__/FloatingPane.test.tsx`
Expected: FAIL (file does not exist)

- [ ] **Step 3: Implement clean test setup and DOM mouse event dispatchers**

Simulate `mousedown` on header drag handle, dispatch `mousemove` on `window` with delta `(dx, dy)`, and verify `updateFloatingPosition` was called. Simulate resize handle `mousedown`, dispatch `mousemove`, verify `updateFloatingBounds`.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/components/layout/__tests__/FloatingPane.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/__tests__/FloatingPane.test.tsx
git commit -m "test(ui): add comprehensive mouse drag and resize interaction tests for FloatingPane"
```

---

### Task 3: Agent Controls & Workspace Edge Cases Tests

**Files:**
- Create: `src/components/agent/__tests__/AgentControls.test.tsx`
- Create: `src/components/layout/__tests__/Workspace.test.tsx`

**Interfaces:**
- Consumes: `AgentControls` buttons (`Ctrl+C`, `Clear`, `Undock`, `Close`), `Workspace` filtering empty state
- Produces: 100% coverage for `AgentControls.tsx` and `Workspace.tsx`

- [ ] **Step 1: Write failing `AgentControls` & `Workspace` test cases**

Test `Ctrl+C` sending `\x03`, `Clear` sending `clear\r`, `Undock` calling `toggleUndock`, `Close` calling `removeAgent`. Test `Workspace` rendering empty state when `searchQuery` matches no active agents.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/components/agent/__tests__/AgentControls.test.tsx`
Expected: FAIL (files missing)

- [ ] **Step 3: Implement `AgentControls` and `Workspace` test suites**

Add complete fireEvent / userEvent tests for all action buttons and search filter empty state rendering.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/components/agent/__tests__/AgentControls.test.tsx src/components/layout/__tests__/Workspace.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/__tests__/AgentControls.test.tsx src/components/layout/__tests__/Workspace.test.tsx
git commit -m "test(ui): add test coverage for AgentControls quick actions and Workspace search empty state"
```

---

### Task 4: Stream Generator & Socket Service Deep Edge-Case Testing

**Files:**
- Modify: `src/services/__tests__/mockStreamGenerator.test.ts`
- Modify: `src/services/__tests__/agentSocket.test.ts`

**Interfaces:**
- Consumes: `MockStreamGenerator.processInput`, `MockStreamGenerator.handleMockCommand`, `AgentSocketService` error/close callbacks
- Produces: 100% test coverage for stream mock generation and socket client failover logic

- [ ] **Step 1: Write failing edge-case tests in `mockStreamGenerator.test.ts` and `agentSocket.test.ts`**

Test `htop` command simulation output, unrecognized command response, backspace deletion handling (`\u007F`), Ctrl+C clearing (`\x03`), WebSocket error callback switching to mock mode, and WebSocket close event.

- [ ] **Step 2: Run tests to verify failure/coverage gap**

Run: `npx vitest run src/services/__tests__/mockStreamGenerator.test.ts src/services/__tests__/agentSocket.test.ts`
Expected: FAIL (missing cases)

- [ ] **Step 3: Implement test cases covering all ANSI command paths and socket error hooks**

Fill out tests for all mock commands (`status`, `run`, `clear`, `htop`, unknown command), backspace stream deletion, Ctrl+C interrupt handling, and WS connection error/close fallback.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/services/__tests__/mockStreamGenerator.test.ts src/services/__tests__/agentSocket.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/__tests__/mockStreamGenerator.test.ts src/services/__tests__/agentSocket.test.ts
git commit -m "test(services): expand mock stream generator ANSI commands and socket error failover tests"
```
