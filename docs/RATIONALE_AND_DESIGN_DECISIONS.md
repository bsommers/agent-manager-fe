# Architectural Rationale & Design Decision Records (ADRs)

This document records the key architectural choices, technical trade-offs, design patterns, and rationale behind the **AI Agent Manager** implementation.

---

## ADR-001: Modular Event-Driven Session Driver Architecture

### Status
Accepted

### Context
The application needs to control two distinct execution environments:
1. **Local sessions**: Running local agent processes inside `tmux` sessions.
2. **Remote sessions**: Streaming interactive terminal sessions across network hosts via SSH.

### Decision
We designed a decoupled **Session Driver abstraction interface**. The backend `SessionManager` interacts with terminal sessions exclusively through a uniform driver contract providing:
- `write(data: string): void`
- `resize(cols: number, rows: number): void`
- `close(): void`
- Callback hooks: `onData`, `onExit`, `onError`

We implemented two concrete driver classes:
- **`TmuxDriver`**: Spawns `node-pty` instances executing `tmux new-session -A -s <session_name>`.
- **`SshDriver`**: Connects via `ssh2`, resolves authentication via SSH Agent socket or local SSH keyfiles, and allocates interactive PTY streams.

### Consequences
- **Pros**: Adding new driver types (e.g. Docker containers, Kubernetes pod exec, WebSockets proxy) requires zero changes to the `SessionManager` routing engine or frontend protocol.
- **Cons**: Requires mapping distinct lifecycle events (e.g., SSH connection timeouts vs. PTY process exit codes) into standardized status changes.

---

## ADR-002: Startup Tmux Session Auto-Discovery & Reattachment Strategy

### Status
Accepted

### Context
Engineers frequently leave agent processes running in persistent `tmux` background sessions. When restarting or launching the AI Agent Manager backend, existing running agent sessions should not be lost or killed.

### Decision
We built a startup auto-discovery engine (`TmuxDiscovery.ts`) that executes `tmux list-sessions -F '#{session_name}'` upon server bootstrap.
- Discovered sessions are rehydrated into the `SessionManager` agent roster immediately.
- When creating local tmux drivers, we use `tmux new-session -A -s <session_name>`. The `-A` flag instructs `tmux` to attach to an existing session if present, or create it if absent.
- Driver attachment is initialized lazily upon the first client input or resize event, avoiding unnecessary PTY allocation for idle sessions.

### Consequences
- **Pros**: Persistent, crash-resilient agent management. Users can restart the manager backend without interrupting running background agent tasks.
- **Cons**: Process discovery depends on `tmux` binary availability in the host system PATH. Gracefully degrades to an empty roster if `tmux` is absent.

---

## ADR-003: Canvas-Rendered xterm.js Terminal Engine with WebSockets

### Status
Accepted

### Context
Terminal interfaces in web browsers often suffer from high DOM element bloat, poor performance with rapid stdout logs, and text wrap distortion when resized.

### Decision
We selected `@xterm/xterm` canvas renderer integrated with `@xterm/addon-fit` and `@xterm/addon-web-links`.
- High-performance canvas-based ANSI rendering handling dense output streams smoothly.
- Bidirectional stream binding: Keypress events are formatted into UTF-8 ANSI escape strings and sent over WebSocket `agent:input` messages; incoming `agent:output` payloads are written directly to the terminal canvas via `term.write()`.
- Responsive resize integration: `ResizeObserver` detects container boundary changes and dispatches `fitAddon.fit()`, updating `agent:resize` columns and rows to the PTY backend.

### Consequences
- **Pros**: Crisp visual typography, smooth scrolling, hardware-accelerated canvas rendering, full ANSI color palette support.
- **Cons**: Requires standard canvas context setup in headless testing environments (handled via Vitest canvas mocks).

---

## ADR-004: Hybrid Window Management System (Freeform Drag + Auto-Snap Presets)

### Status
Accepted

### Context
Users managing multiple terminal streams need both structured grid views for simultaneous monitoring and freeform placement for focused side-by-side comparison.

### Decision
We implemented a **Hybrid Window Manager**:
1. **Freeform Canvas**: Every agent window pane (`FloatingPane.tsx`) is rendered with absolute positioning (`left`, `top`, `width`, `height`, `zIndex`).
2. **Draggable & Resizable**: Panes can be dragged by their header handle across the canvas, and resized via bottom-right drag grips.
3. **Auto-Arrange Presets**: Toolbar buttons (`Grid`, `Cascade`, `Focus`) calculate exact mathematical coordinates and snap all active windows into structured layouts on demand, while preserving their ability to be moved freely afterwards.

### Consequences
- **Pros**: Gives users total layout control—instant clean arrangement via preset buttons, plus granular manual positioning when needed.
- **Cons**: Requires z-index elevation tracking to keep active window panes on top.

---

## ADR-005: Dual-Mode Socket Service with Offline Mock Emulator

### Status
Accepted

### Context
Frontend developers and UI test runners need to inspect, build, and verify component behavior without requiring a running backend process or active SSH keys.

### Decision
We built `AgentSocketService` with a dual-mode strategy:
1. **Live Mode**: Connects to `ws://localhost:8088/ws` over WebSockets.
2. **Offline Mock Fallback**: If the WebSocket connection is refused or lost, `AgentSocketService` automatically falls back to `MockStreamGenerator`.
3. **Mock Generator**: Simulates terminal ANSI output, interactive command echo (e.g. `help`, `status`, `ls`), and periodic heartbeat logs.

### Consequences
- **Pros**: Unblocks frontend UI development, offline testing, and Vitest component suite execution without external server dependencies.
- **Cons**: Requires maintaining mock stream command handlers aligned with live terminal output expectations.

---

## ADR-006: Port Allocation Strategy (Defaulting to Port 8088)

### Status
Accepted

### Context
Port `8080` is frequently occupied on developer workstations by existing web services (e.g., Python HTTP servers, Jenkins, proxy daemons), leading to `EADDRINUSE` errors on backend startup.

### Decision
- Default backend server port changed to `8088` (configurable via `PORT` environment variable).
- Frontend socket service defaults to `ws://localhost:8088/ws` (configurable via `VITE_WS_URL`).
- Executable startup scripts (`start-backend.sh`, `start-all.sh`) export `PORT=${PORT:-8088}` cleanly.

### Consequences
- **Pros**: Avoids port collisions on standard developer setups while keeping backend port selection fully configurable.
