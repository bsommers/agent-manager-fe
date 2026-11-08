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
Accepted, partially superseded by [ADR-007](#adr-007-explicit-demo-mode-replaces-automatic-mock-fallback) (the automatic mock fallback was removed)

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

---

## ADR-007: Explicit Demo Mode Replaces Automatic Mock Fallback

### Status
Accepted (partially supersedes ADR-005)

### Context
ADR-005 silently fell back to the mock generator whenever the WebSocket failed. A dropped connection therefore looked live while the user was typing into a simulation, and the client never tried to reconnect.

### Decision
- Live mode never simulates output.
- Demo mode is chosen explicitly by configuration (`VITE_DEMO_MODE=1` or `?demo=1`).
- The `Transport` reconnects with capped, jittered exponential backoff and a heartbeat.
- Connection state lives in `connectionStore` and is always shown in the header chip and the global banner.
- A single `VITE_BACKEND_URL` configures the backend; `VITE_WS_URL` remains as a deprecated alias.

### Consequences
- **Pros**: The UI is truthful about the connection, and the connection heals itself without a page reload.
- **Cons**: The empty live-mode start is resolved by [ADR-008](#adr-008-server-authoritative-roster-in-live-mode-phase-10-slice), and tests rely on the `VITE_DEMO_MODE` stub in `src/setupTests.ts`.

---

## ADR-008: Server-Authoritative Roster in Live Mode (Phase 10 slice)

### Status
Accepted, delivered ahead of Phases 6 and 8 on 2026-11-07, completed by their typed-lifecycle work.

### Context
Add Agent only built a local agent and never sent `agent:create`, so QA step 1 showed panes with no shell prompt.

### Decision
- The live roster starts empty and is replaced by `agent:init_list` snapshots from the gateway.
- Add Agent sends `agent:create` and shows a Starting pane, reconciled to the server agent by name, mode and targetHost.
- Create and kill roll back (create) or stay listed with an error notice (kill) after 10 seconds without gateway confirmation.
- Status events update the badge in the store.
- Demo mode is unchanged.

### Consequences
- **Pros**: The roster is truthful and QA step 1 passes.
- **Cons**: Key-based matching can attach a pane to an identical agent created by another client; there are no typed errors; a failed driver spawn can leave a ghost agent in a later snapshot; there are no stale markers, rename, tags or group. All of these are addressed by Phase 6.

---

## ADR-009: One Z-Index Scale, Portalled Overlays, Bounded Pane Stacking (Phase 09.1)

### Status
Accepted on 2026-11-07 (QA-02, fixes QA step 5).

### Context
The destructive safety modal was `z-50` while floating panes carried an inline z-index of 100 or more, so panes were painted over its Cancel button. Other dialogs used `z-[500]`, which a pane overtakes after about 400 raises because `bringToFront` computed `max + 1` without bound; the toast stack was `z-50`, always below panes.

### Decision
- One scale module, `src/styles/zLayers.ts`: panes in [100, 8999], overlays 9000, destructive confirmations 9100, toasts 9200.
- Every modal, overlay and the toast stack renders through `OverlayPortal` into `document.body`, inside a zero-size fixed wrapper carrying the layer's inline z-index, so no ancestor stacking context can trap it below the panes.
- `bringToFront` re-ranks panes into the contiguous range starting at 100 (front pane highest, relative order kept) instead of counting up forever.
- `FloatingPane` clamps the stored z-index to the pane ceiling at render, so externally supplied values cannot exceed the overlays.
- Class-based z utilities are removed from overlay files; Tailwind cannot read the shared constants.

### Consequences
- **Pros**: Overlays can never be covered by a pane; the scale has one source of truth; the numeric ordering is asserted in `overlayLayering.test.tsx` after 10 000 raises.
- **Cons**: One extra wrapper element per overlay; jsdom does no layout, so hit-testing is not unit tested and QA step 5 in `qa/` remains the live check.
- **Rule for new overlays**: use `OverlayPortal` with a layer from `Z_LAYERS`; never add a z-index class to an overlay.

---

## ADR-010: Gateway Agent Service Layer (Phase 6)

### Status
Accepted on 2026-11-08 (GW-04, first half).

### Context
`SessionManager` mixed four jobs: the WebSocket client set, the agent registry, the driver lifecycle and the message switch, including the kill-session flow. An HTTP API and an MCP surface were coming, and each would have had to reach the same logic through a WebSocket-shaped class. A driver that failed to start also left a registered but unannounced agent.

### Decision
- A transport-agnostic `AgentService` owns the registry, the drivers and every agent operation. It imports no WebSocket, Express or HTTP type and publishes state changes through one injected callback.
- Expected failures are values: every operation returns a `ServiceResult` carrying a contract `ErrorCode`, a fixed message and a `retryable` flag. Handlers map the error to `agent:error` or the HTTP error envelope without inspecting exception text.
- The destructive confirm gate lives inside `AgentService.destroy` as its first statement and is tested by calling the service directly.
- `SessionManager` keeps the client set, the snapshot on connect, the fan-out and a legacy message mapping, and exposes the service.

### Consequences
- **Pros**: one implementation behind WS, HTTP and MCP; the confirm gate cannot be skipped by a new surface; a failed spawn leaves nothing behind; update, per-target broadcast results and an agent cap exist for the next plans.
- **Cons**: one more layer; two legacy shims in `SessionManager` (an unknown id on a kill answers an unchanged snapshot) are removed by plan 06-02.
- **Closing never kills tmux**: `close` and `destroy` are separate methods and only `destroy` touches tmux.

### Alternatives considered
- Leave the logic in `SessionManager` and add HTTP beside it: duplicates the confirm gate and the exit race per surface.
- An event-emitter service: hides the publish contract and makes ordering of snapshots and replies harder to test.
