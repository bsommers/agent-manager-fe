# AI Agent Manager HUD Command Center

> A state-of-the-art, real-time command center interface and event-driven backend for orchestrating, monitoring, and interacting with local `tmux` sessions and remote `ssh` agent processes.

![AI Agent Manager Command Center](docs/assets/banner_preview.png)

## ⚡ Executive Overview

**AI Agent Manager** is a full-stack, enterprise-grade developer dashboard designed for engineers and AI researchers running complex multi-agent workflows. It provides a real-time command center interface with canvas-rendered terminal windows (`xterm.js`), local `tmux` session auto-discovery, remote SSH PTY streaming, and a hybrid window management system supporting freeform drag-and-drop as well as automatic Grid and Cascade snapping layout presets.

---

## ✨ Key Features

- **📺 Real-time Canvas Terminal Stream**: Powered by `@xterm/xterm` canvas rendering with `@xterm/addon-fit` auto-resizing and `@xterm/addon-web-links`.
- **🔄 Local Tmux Auto-Discovery & Reattachment**: Backend automatically inspects running `tmux` sessions (`tmux list-sessions`) on startup and seamlessly attaches using `tmux new-session -A -s <name>`.
- **🌐 Remote SSH PTY Session Streaming**: Direct SSH PTY terminal integration using `ssh2`, with native support for SSH Agent (`SSH_AUTH_SOCK`) and local keyfiles (`~/.ssh/id_rsa`, `~/.ssh/id_ed25519`).
- **🪟 Freeform Window Manager**: Drag any window pane by its header to position it anywhere on the canvas; resize windows via bottom-right drag handles; elevate z-index on interaction.
- **📐 Dynamic Layout Presets**:
  - **Grid**: Automatically snaps all active agent windows into a balanced tiling grid layout.
  - **Cascade**: Staggers windows diagonally across the workspace canvas.
  - **Focus**: Expands the selected agent to primary viewport height while docking secondary agents in a right sidebar strip.
- **🔌 Live Transport and Explicit Demo Mode**: The app connects to the backend at the configured `VITE_BACKEND_URL` (default `http://localhost:8088`), reconnects by itself, and shows the connection state in the header. Terminal output is simulated only when Demo mode is selected explicitly (`VITE_DEMO_MODE=1`). See [`docs/RUNNING.md`](docs/RUNNING.md) for connection configuration.
- **📡 Multi-Agent Command Broadcast**: Send one command to all, filtered, or selected agents at once from the broadcast bar. Commands matching destructive patterns (e.g. `rm`, `sudo`, `kill`, `shutdown`) require explicit confirmation in a safety modal before they are sent.
- **🔎 Global Log Search**: Search ANSI-stripped terminal output buffered across all agents, with a plain-text or regular-expression toggle (`Ctrl+Shift+F`), and jump straight to the matching agent pane.
- **⌨️ Keyboard-First Operation**: A `Ctrl+K` command palette reaches every agent, layout, the broadcast bar and search, and `Ctrl+/` lists every shortcut, even from inside a terminal. See [`docs/KEYBOARD.md`](docs/KEYBOARD.md).
- **🔔 Status Toast Alerts**: An in-app toast appears when an agent enters an error or disconnected state; click it to jump to that agent.
- **🔍 Agent Roster Search & Quick Actions**: Search agents by name or host, clear terminal outputs, send interrupt signals (`Ctrl+C`), and manage agent lifecycles.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **tmux**: Installed locally (optional, for local tmux agent driver)

### Starting the Application

Use the bundled executable scripts in the `scripts/` directory:

#### Option A: Start Both Frontend & Backend Concurrently (Recommended)
```bash
npm run start:all
# or
./scripts/start-all.sh
```
*App will open on `http://localhost:3000` connected to backend server on `ws://localhost:8088/ws`.*

#### Option B: Start Backend and Frontend Separately

```bash
# Terminal 1: Backend Server (Port 8088)
npm run start:backend
# or ./scripts/start-backend.sh

# Terminal 2: Frontend Dev Server (Port 3000)
npm run start:frontend
# or ./scripts/start-frontend.sh
```

---

## 🏗️ Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                   React 18 + Vite Frontend                      │
 │                                                                 │
 │   ┌──────────────────────┐        ┌─────────────────────────┐   │
 │   │  Workspace & Toolbar │        │  Zustand Agent Store    │   │
 │   └──────────┬───────────┘        └────────────┬────────────┘   │
 │              │                                 │                │
 │              ▼                                 ▼                │
 │   ┌──────────────────────┐        ┌─────────────────────────┐   │
 │   │   xterm.js Canvas    │◄───────┤   AgentSocketService    │   │
 │   └──────────────────────┘        └────────────┬────────────┘   │
 └────────────────────────────────────────────────┼────────────────┘
                                                  │  WebSocket (JSON)
                                                  │  ws://localhost:8088/ws
 ┌────────────────────────────────────────────────┼────────────────┐
 │   Node.js + Express + WebSocket Backend        │                │
 │                                                ▼                │
 │                         ┌─────────────────────────────┐         │
 │                         │       SessionManager        │         │
 │                         └──────┬───────────────┬──────┘         │
 │                                │               │                │
 │                                ▼               ▼                │
 │                       ┌───────────┐     ┌───────────┐           │
 │                       │TmuxDriver │     │ SshDriver │           │
 │                       └─────┬─────┘     └─────┬─────┘           │
 └─────────────────────────────┼─────────────────┼─────────────────┘
                               ▼                 ▼
                        Local tmux PTY     Remote SSH Host
```

---

## 📁 Repository Directory Layout

```
.
├── docs/                                  # Project Documentation
│   ├── ARCHITECTURE.md                    # Detailed System Architecture & Diagrams
│   ├── RATIONALE_AND_DESIGN_DECISIONS.md # Architectural Decision Records (ADRs)
│   ├── RUNNING.md                         # Setup, Configuration & Troubleshooting Guide
│   ├── qa-test-plan.md                    # QA & Hardening Verification Plan
│   └── superpowers/                       # Specs & SDD Implementation Plans
├── scripts/                               # Executable Startup Scripts
│   ├── start-all.sh                       # Start Frontend + Backend concurrently
│   ├── start-backend.sh                   # Start Node.js Backend Server
│   └── start-frontend.sh                  # Start Vite React Frontend
├── server/                                # Node.js + TypeScript Backend Server
│   ├── src/
│   │   ├── config.ts                      # Server configuration defaults
│   │   ├── index.ts                       # Express + WS Server Entry Point
│   │   ├── protocol/                      # Bidirectional WebSocket Types
│   │   │   └── wsProtocol.ts
│   │   ├── services/                      # Drivers & Session Management
│   │   │   ├── SessionManager.ts          # Central agent registry & router
│   │   │   ├── TmuxDriver.ts              # Local node-pty tmux wrapper
│   │   │   ├── SshDriver.ts               # Remote ssh2 PTY stream manager
│   │   │   └── TmuxDiscovery.ts           # Startup tmux list-sessions engine
│   │   └── utils/
│   │       └── sshKeyLoader.ts            # SSH agent & keyfile loader
│   └── package.json
├── src/                                   # React 18 Frontend UI
│   ├── components/
│   │   ├── agent/                         # Terminal & Agent Controls
│   │   └── layout/                        # Workspace, FloatingPane, Header, Toolbar
│   ├── services/                          # Dual-mode Agent Socket Service
│   ├── store/                             # Central Zustand Agent Store
│   └── types/                             # TypeScript Models & Declarations
└── package.json
```

---

## 🛠️ Tech Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18 + Vite | ESM module loading, fast HMR |
| **Terminal Engine** | `@xterm/xterm` (v5.5) | Canvas-rendered ANSI terminal engine |
| **Terminal Addons** | `@xterm/addon-fit`, `@xterm/addon-web-links` | Dynamic grid auto-fitting and URL detection |
| **State Store** | Centralized Zustand Store | Immutable state updates, layout subscriber patterns |
| **Icons & Styling** | Lucide React + Tailwind CSS | Custom dark mode Command Center HUD aesthetic |
| **Backend Framework** | Node.js + Express | Lightweight HTTP server & `/health` endpoint |
| **Real-time Protocol** | `ws` WebSocket Server | Bi-directional JSON message streaming on `/ws` |
| **Local PTY Driver** | `node-pty` + `tmux` | Pseudo-terminal allocation attached to local tmux |
| **Remote PTY Driver** | `ssh2` | Interactive SSH shell stream with key authentication |
| **Testing Harness** | Vitest + `@testing-library/react` | 69 unit & integration tests passing cleanly |

---

## 🧪 Testing & Verification

Run the full-stack test suite across both frontend and backend repositories:

```bash
# Run root frontend unit & component tests
npm test

# Run backend server unit & integration tests
cd server && npm test
```

### Production Build Test
Verify both production build bundles compile cleanly:

```bash
npm run build && cd server && npm run build
```

---

## 📚 Documentation Sitemap

- 📐 **[System Architecture](docs/ARCHITECTURE.md)** — Detailed multi-layer architecture breakdown and Mermaid sequence diagrams.
- 💡 **[Rationale & Design Decisions](docs/RATIONALE_AND_DESIGN_DECISIONS.md)** — ADRs covering driver choices, auto-discovery, layout algorithms, and protocol design.
- 📖 **[Running & Troubleshooting Guide](docs/RUNNING.md)** — Complete execution, environment setup, and troubleshooting instructions.
- 📋 **[QA & Verification Test Plan](docs/qa-test-plan.md)** — Test plan covering terminal streaming, dynamic resizing, and socket failover edge cases.
