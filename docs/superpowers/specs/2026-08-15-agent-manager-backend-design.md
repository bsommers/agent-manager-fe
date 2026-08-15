# AI Agent Manager Backend Server - Design Specification

**Date:** 2026-08-15  
**Status:** Approved  
**Scope:** Backend Node.js / TypeScript service (`server/`) managing real `tmux` local sessions and `ssh` remote terminal connections over WebSockets for the AI Agent Manager UI.

---

## 1. Executive Summary & Goals

The AI Agent Manager Backend is a server application that bridges web-based `xterm.js` terminals in the frontend UI (`agent-manager-fe`) with real terminal processes on the host machine (`tmux`) or remote servers (`ssh`).

### Key Features
* **Local Tmux Driver**: Spawns and attaches to local `tmux` sessions via `node-pty` using `tmux new-session -A -s <session_name>`.
* **Remote SSH Driver**: Connects to remote hosts via `ssh2`, allocates interactive PTY streams, and supports SSH Agent (`SSH_AUTH_SOCK`) and keyfile authentication.
* **Tmux Auto-Discovery**: Automatically inspects running local `tmux` sessions on startup (`tmux list-sessions`) to rehydrate existing agent sessions across server restarts.
* **Bidirectional WebSocket Protocol**: Shared WebSocket protocol contract (`wsProtocol.ts`) for real-time terminal stdout/stdin streaming and dynamic window resizing (`agent:resize`).
* **Clean Event-Driven Architecture**: Modular session management separating connection transport, PTY binding, SSH auth, and protocol serialization.

---

## 2. Tech Stack & Dependencies

* **Runtime**: Node.js (v18+) & TypeScript.
* **HTTP & WebSockets**:
  * `ws` (WebSocket server listening on port `8080` at path `/ws`).
  * `express` (Lightweight HTTP server for health checks & static file hosting).
* **Terminal & PTY Bindings**:
  * `node-pty` (Native C++ binding for pseudo-terminal allocation).
  * `ssh2` (Pure JS implementation of SSH2 client protocol).
* **Dev & Build Tooling**:
  * `tsx` (TypeScript executor & hot-reloading dev runner).
  * `typescript` (TS compiler targeting Node 20 ES2022).
  * `vitest` (Unit test framework).

---

## 3. Architecture & Directory Layout

```
server/
├── src/
│   ├── index.ts                 # Server entry point (Express + WebSocket server mount on port 8080)
│   ├── config.ts                # Configuration (PORT, SSH key search paths, default shell)
│   ├── services/
│   │   ├── SessionManager.ts    # Central agent registry, message router & lifecycle manager
│   │   ├── TmuxDriver.ts        # node-pty wrapper executing tmux sessions
│   │   ├── SshDriver.ts         # ssh2 stream wrapper for remote hosts
│   │   └── TmuxDiscovery.ts     # Startup auto-discovery of running local tmux sessions
│   ├── protocol/
│   │   └── wsProtocol.ts        # Shared WebSocket message contracts (matched to frontend)
│   └── utils/
│       └── sshKeyLoader.ts      # Helper for SSH agent socket & id_rsa key loading
├── package.json                 # Server dependencies (express, ws, node-pty, ssh2)
├── tsconfig.json                # Server TypeScript config
└── README.md                    # Server setup & usage documentation
```

---

## 4. Session Drivers & Lifecycle

### 4.1 Local Tmux Driver (`TmuxDriver.ts`)
* **Execution**: `node-pty.spawn('tmux', ['new-session', '-A', '-s', sessionName], { cols, rows, env: process.env })`.
* **Behavior**: Uses `-A` flag to attach to existing sessions if present or create new sessions.
* **Streams**:
  * `pty.onData((data) => ws.send({ type: 'agent:output', agentId, data }))`
  * `pty.onExit(() => ws.send({ type: 'agent:status_change', agentId, status: 'disconnected' }))`
* **Resizing**: `pty.resize(cols, rows)` on `agent:resize` client messages.

### 4.2 Remote SSH Driver (`SshDriver.ts`)
* **Parsing**: Extracts `user`, `host`, `port` from target string (e.g. `admin@192.168.1.50:22`).
* **Authentication Pipeline**:
  1. `process.env.SSH_AUTH_SOCK` (Active SSH Agent)
  2. `~/.ssh/id_rsa`, `~/.ssh/id_ed25519` private key files
  3. Optional password field in payload
* **PTY Request**: `client.shell({ term: 'xterm-256color', cols, rows })`
* **Disconnect Recovery**: Emits `agent:status_change` with `disconnected` or `error` status on network drop.

### 4.3 Auto-Discovery Engine (`TmuxDiscovery.ts`)
* At server startup, runs `execFile('tmux', ['list-sessions', '-F', '#{session_name}'])`.
* Automatically registers discovered local `tmux` sessions into the active agent roster.
* Sends `agent:init_list` message to newly connected frontend clients.

---

## 5. WebSocket Protocol Contract (`wsProtocol.ts`)

### Client ➔ Server Messages
* `agent:input`: `{ agentId: string, data: string }`
* `agent:resize`: `{ agentId: string, cols: number, rows: number }`
* `agent:create`: `{ name: string, mode: 'tmux' | 'ssh', targetHost: string, initialCmd?: string }`
* `agent:kill`: `{ agentId: string }`

### Server ➔ Client Messages
* `agent:output`: `{ agentId: string, data: string }`
* `agent:status_change`: `{ agentId: string, status: 'idle' | 'running' | 'thinking' | 'error' | 'disconnected' }`
* `agent:init_list`: `{ agents: Agent[] }`

---

## 6. Implementation & Verification Strategy

1. **Scaffold `server/` Directory**: Set up `package.json`, `tsconfig.json`, install dependencies (`express`, `ws`, `node-pty`, `ssh2`).
2. **Implement Protocol & Config**: Copy/sync `wsProtocol.ts` and set up configuration defaults.
3. **Build Core Drivers**:
   * `TmuxDriver.ts` with `node-pty`
   * `SshDriver.ts` with `ssh2`
   * `TmuxDiscovery.ts` with auto-discovery
   * `SessionManager.ts` routing dispatcher
4. **Mount Server**: Create `src/index.ts` mounting Express HTTP + WebSocket server.
5. **Unit & Integration Verification**: Test WebSocket routing, message parsing, driver lifecycle, and startup auto-discovery.
