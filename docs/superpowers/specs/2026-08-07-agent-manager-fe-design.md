# AI Agent Manager Frontend UI - Design Specification

**Date:** 2026-08-07  
**Status:** Approved  
**Scope:** Frontend UI for AI Agent Manager with Hybrid Docking/Floating Pane Windowing, Interactive Terminal (`xterm.js`), and Dual-Mode WebSocket Architecture (Mock Driver + Live Backend).

---

## 1. Executive Summary & Goals

The AI Agent Manager Frontend is a web interface designed for monitoring, organizing, and interacting with multiple AI agents running either locally (via `tmux` sessions) or on remote servers (via `ssh`).

### Key Features
* **Hybrid Workspace Layout**: Agents rendered as dockable tiles or un-dockable floating windows with auto-arrange layout presets (Grid, Focus Mode, Cascade).
* **Interactive Terminal Environment**: Full `xterm.js` canvas instances for each agent with ANSI stream rendering, auto-resizing, and terminal quick-action chips.
* **Dual-Mode WebSocket Architecture**: Included mock terminal stream generator for standalone UI preview and development, with seamless toggle to live `ws://` / `wss://` backend endpoints.
* **Modern HUD Aesthetic**: Sleek dark mode glassmorphism interface built with React, Vite, and TanStack tooling.

---

## 2. Tech Stack & Architecture

* **Build Tooling & Core**: React 18/19, TypeScript, Vite.
* **State & Routing**:
  * `TanStack Router` (SPA route navigation)
  * `TanStack Store` / `Zustand` (Central store for agent roster, active focus, layout states, and connection parameters)
* **Window & Docking System**:
  * `dockview` (or custom flex-dock manager) for tiling, splitting, and tabbed grouping.
  * Custom portal layer for absolute positioning, z-index layering, and drag-and-drop resizing of floating panes.
* **Terminal Engine**:
  * `@xterm/xterm` (Canvas terminal renderer)
  * `@xterm/addon-fit` (Dynamic element bounds auto-fitting)
  * `@xterm/addon-web-links` (Clickable links in terminal streams)
* **UI & Styling**:
  * `Tailwind CSS` + CSS Modules / Vanilla CSS Tokens (Dark Command-Center HUD design)
  * `lucide-react` (Iconography)

---

## 3. UI Component Architecture

```
src/
├── components/
│   ├── layout/
│   │   ├── Header.tsx            # Global counters (Active, Thinking, Idle, Error), connectivity indicator
│   │   ├── Toolbar.tsx           # Layout presets (Auto-Grid, Focus Mode, Cascade), search & filter bar, Add Agent trigger
│   │   ├── Workspace.tsx         # Hybrid viewport container managing dock tiles and floating overlay layer
│   │   └── FloatingPane.tsx      # Absolute position window frame with drag header & corner resizers
│   ├── agent/
│   │   ├── AgentPane.tsx         # Agent container wrapping header bar, xterm terminal, and footer chips
│   │   ├── TerminalView.tsx      # xterm.js instance lifecycle manager, fitAddon handling, resize observer
│   │   ├── AgentControls.tsx     # Quick terminal commands (Ctrl+C, clear, scroll, restart)
│   │   └── AddAgentModal.tsx     # Modal to add/register new tmux or SSH agent session
├── services/
│   ├── agentSocket.ts            # Unified WebSocket service (Mock Driver + Live WS connection)
│   ├── mockStreamGenerator.ts    # Realistic ANSI output generator for mock agents
│   └── wsProtocol.ts             # Message types & payload serialization
├── store/
│   └── agentStore.ts             # Central application store
├── styles/
│   └── globals.css               # Dark theme variables, glassmorphism, xterm styles
└── types/
    └── agent.ts                  # TypeScript interface definitions
```

---

## 4. Data Model & WebSocket Protocol Contract

### 4.1 Data Model (`types/agent.ts`)

```typescript
export type AgentMode = 'tmux' | 'ssh';
export type AgentStatus = 'idle' | 'running' | 'thinking' | 'error' | 'disconnected';

export interface AgentLayout {
  isFloating: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  isMinimized?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  mode: AgentMode;
  targetHost: string; // e.g. "localhost:tmux_session_1" or "root@192.168.1.50:22"
  status: AgentStatus;
  unreadOutput: boolean;
  layout: AgentLayout;
  createdAt: number;
  lastActivity: number;
}
```

### 4.2 WebSocket Protocol (`services/wsProtocol.ts`)

* **Client ➔ Backend**:
  * `agent:input`: `{ agentId: string, data: string }`
  * `agent:resize`: `{ agentId: string, cols: number, rows: number }`
  * `agent:create`: `{ name: string, mode: AgentMode, targetHost: string, initialCmd?: string }`
  * `agent:kill`: `{ agentId: string }`
* **Backend ➔ Client**:
  * `agent:output`: `{ agentId: string, data: string }`
  * `agent:status_change`: `{ agentId: string, status: AgentStatus }`
  * `agent:init_list`: `{ agents: Agent[] }`

---

## 5. Layout Modes & Interactions

1. **Docked View (Default Tile Dock)**:
   * Panes snap into split columns and rows with draggable splitter handles.
   * Panes can be tabbed together within the same panel box.
2. **Floating Panes (Pop-Out Mode)**:
   * Clicking "Undock" transforms a docked tile into a free-floating window over the workspace.
   * Floating panes can be moved anywhere via header drag, resized from edges/corners, and brought to top z-index on click.
3. **Layout Presets**:
   * **Auto-Grid**: Automatically computes optimal N-column x M-row split layout for all docked agents.
   * **Focus Mode**: Maximize selected agent pane into full workspace view while placing other active agents into a compact sidebar strip.
   * **Cascade / Spread**: Arranges floating windows in a staggered overlay across the canvas.

---

## 6. Implementation & Verification Plan

1. **Scaffold Project**: React + Vite + TypeScript, install dependencies (`@xterm/xterm`, `lucide-react`, `tailwindcss` / CSS setup).
2. **Setup State & Store**: Implement `agentStore.ts` with initial mock agents and layout state management.
3. **Build Core Components**:
   * `Header` & `Toolbar`
   * `TerminalView` with `xterm.js` and `fitAddon`
   * `AgentPane` and `FloatingPane` window wrappers
   * `Workspace` hybrid dock & floating manager
4. **Implement Mock Stream & WebSocket Layer**: Create realistic simulated terminal output generator for mock agents and interactive input response.
5. **Verification**: Verify pane drag/drop, docking/undocking, auto-grid layout, xterm rendering, resizing, and keyboard controls.
