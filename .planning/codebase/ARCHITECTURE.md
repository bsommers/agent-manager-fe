<!-- refreshed: 2026-11-07 -->
# Architecture

**Analysis Date:** 2026-11-07

## System Overview
```text
Browser (React)                              Node server (Express+ws)
┌───────────────────────────┐   WebSocket   ┌──────────────────────────┐
│ Header/Toolbar/Workspace  │ <-----------> │ index.ts  /ws, /health   │
│ FloatingPane > AgentPane  │  JSON msgs    │ SessionManager           │
│   > TerminalView(xterm)   │               │  ├ TmuxDriver (node-pty) │
├───────────────────────────┤               │  └ SshDriver (ssh2)      │
│ zustand: agentStore,      │               └──────────┬───────────────┘
│ logBufferStore            │                          ▼ tmux / sshd
│ services/agentSocket.ts   │
└───────────────────────────┘
```

## Component Responsibilities
| Component | Responsibility | File |
|---|---|---|
| App | Composition root | `src/App.tsx` |
| Workspace | Filters agents, triggers layout arrange, renders panes | `src/components/layout/Workspace.tsx` |
| FloatingPane | Draggable/resizable window per agent | `src/components/layout/FloatingPane.tsx` |
| TerminalView | xterm instance, input/resize, output subscription | `src/components/agent/TerminalView.tsx` |
| BroadcastBar / DestructiveSafetyModal | Fan-out input to many agents with confirmation | `src/components/layout/BroadcastBar.tsx` |
| GlobalSearchModal | Cross-agent log search, jump to pane | `src/components/layout/GlobalSearchModal.tsx` |
| NotificationToastManager | Toasts on status transitions | `src/components/layout/NotificationToastManager.tsx` |
| agentStore | Agents, layout mode, arrangement, socket wiring | `src/store/agentStore.ts` |
| logBufferStore | Bounded per-agent output ring buffer + search | `src/store/logBufferStore.ts` |
| AgentSocketService | WS client with mock fallback, pub/sub | `src/services/agentSocket.ts` |
| SessionManager | Agent registry, drivers, client fan-out | `server/src/services/SessionManager.ts` |

## Pattern Overview
**Overall:** Thin React SPA with zustand stores + event-driven WebSocket relay server.
- Shared protocol types live in the server and are imported by the frontend via relative re-export.
- Server broadcasts all output to all clients (no per-agent subscription).
- Drivers are interchangeable (`write/resize/close`) with callbacks onData/onExit(/onError).

## Layers
- UI components: `src/components/{layout,agent}` - depend on stores
- State: `src/store` - depends on `src/services/agentSocket.ts`
- Services: `src/services` - WS + mock stream
- Backend transport: `server/src/index.ts`; domain `server/src/services`; protocol `server/src/protocol`; utils `server/src/utils`

## Data Flow
### Output path
1. Driver `onData` (`SessionManager.createAgent`) -> `broadcast({type:'agent:output'})`
2. `agentSocket.onmessage` -> `notify` listeners (`src/services/agentSocket.ts`)
3. Stores/TerminalView consume: log buffer append, xterm write, status/unread updates

### Input path
1. xterm onData / BroadcastBar -> `agentSocket.send` (`agent:input` / `agent:broadcast`)
2. `SessionManager.handleClientMessage` -> `driver.write`

### Lifecycle
- On connect server sends `agent:init_list`; create/kill re-broadcast the full list; frontend `setAgents` replaces state.

**State:** zustand stores (also exported as `agentStore`/`logBufferStore` Proxy accessors for non-React use).

## Entry Points
- `src/main.tsx` -> `src/App.tsx`; `server/src/index.ts` (`bootstrap()`, auto-runs unless NODE_ENV=test).

## Architectural Constraints
- **Threading:** single-threaded Node event loop; browser main thread.
- **Global state:** `agentSocket` singleton (`src/services/agentSocket.ts`); store singletons; `SessionManager` instance per `bootstrap`.
- **Cross-boundary import:** frontend imports `../../server/src/protocol/wsProtocol.js` (`src/services/wsProtocol.ts`, `src/types/agent.ts`).

## Anti-Patterns
### Seed agents in store
**What happens:** `INITIAL_AGENTS` mock agents hardcoded in `src/store/agentStore.ts`.
**Why it's wrong:** Appear alongside real agents until `init_list` replaces them.
**Do this instead:** Keep demo data confined to mock mode.

### Duplicate driver setup
**What happens:** `createAgent` and `getOrCreateDriver` in `SessionManager.ts` each build callbacks.
**Do this instead:** Extract one shared callback factory.

## Error Handling
- Server: try/catch with console logging, ignore send/close errors; SSH errors surfaced as red terminal text and `error` status.
- Client: WS error/close silently flips to mock mode (no reconnect).

## Cross-Cutting Concerns
**Logging:** console. **Validation:** none on WS messages beyond JSON parse. **Authentication:** none.

---
*Architecture analysis: 2026-11-07*
