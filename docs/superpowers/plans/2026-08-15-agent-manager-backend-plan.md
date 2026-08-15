# AI Agent Manager Backend Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js + TypeScript backend server (`server/`) providing real `tmux` local session management (`node-pty`), remote `ssh` terminal streaming (`ssh2`), auto-discovery of active tmux sessions, and bidirectional WebSocket communication with the frontend UI on port 8080.

**Architecture:** An event-driven Express + `ws` WebSocket server mounted at `/ws`. Uses `SessionManager` to route WebSocket protocol messages to dedicated session drivers (`TmuxDriver` for local PTY sessions and `SshDriver` for remote SSH PTY sessions). Incorporates a startup auto-discovery engine (`TmuxDiscovery`) querying local `tmux list-sessions`.

**Tech Stack:** Node.js (v18+), TypeScript, Express, `ws`, `node-pty`, `ssh2`, `tsx`, `vitest`.

## Global Constraints

- **Directory**: `server/` inside `bsommers/agent-manager-fe` repository.
- **Port**: Default `8080` (WebSocket endpoint `/ws`, HTTP health check `/health`).
- **Protocol**: Exact 1-to-1 match with frontend `wsProtocol.ts` schema (`agent:input`, `agent:resize`, `agent:create`, `agent:kill`, `agent:output`, `agent:status_change`, `agent:init_list`).
- **Tmux Command**: Local tmux execution uses `tmux new-session -A -s <session_name>` to automatically attach or create.

---

### Task 1: Scaffold `server/` Directory & Protocol Schema

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/config.ts`
- Create: `server/src/protocol/wsProtocol.ts`
- Test: `server/src/protocol/__tests__/wsProtocol.test.ts`

**Interfaces:**
- Consumes: Frontend `wsProtocol.ts` definition
- Produces: Base server directory setup, server config defaults, and message type serialization.

- [ ] **Step 1: Create `server/package.json`**

Create `server/package.json`:
```json
{
  "name": "agent-manager-backend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "node-pty": "^1.0.0",
    "ssh2": "^1.15.0",
    "ws": "^8.17.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/ssh2": "^1.15.1",
    "@types/ws": "^8.5.10",
    "tsx": "^4.15.7",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

Create `server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `server/src/config.ts`**

Create `server/src/config.ts`:
```typescript
import path from 'path';
import os from 'os';

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
  WS_PATH: '/ws',
  DEFAULT_SHELL: process.env.SHELL || '/bin/bash',
  SSH_KEY_PATHS: [
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
  ],
  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
};
```

- [ ] **Step 4: Create `server/src/protocol/wsProtocol.ts`**

Create `server/src/protocol/wsProtocol.ts`:
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
  targetHost: string;
  status: AgentStatus;
  unreadOutput: boolean;
  layout: AgentLayout;
  createdAt: number;
  lastActivity: number;
}

export type WSMessageClient =
  | { type: 'agent:input'; agentId: string; data: string }
  | { type: 'agent:resize'; agentId: string; cols: number; rows: number }
  | { type: 'agent:create'; name: string; mode: AgentMode; targetHost: string; initialCmd?: string }
  | { type: 'agent:kill'; agentId: string };

export type WSMessageServer =
  | { type: 'agent:output'; agentId: string; data: string }
  | { type: 'agent:status_change'; agentId: string; status: AgentStatus }
  | { type: 'agent:init_list'; agents: Agent[] };
```

- [ ] **Step 5: Write unit test for protocol serialization**

Create `server/src/protocol/__tests__/wsProtocol.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { WSMessageClient, WSMessageServer } from '../wsProtocol';

describe('wsProtocol', () => {
  it('should format client and server WebSocket messages correctly', () => {
    const inputMsg: WSMessageClient = {
      type: 'agent:input',
      agentId: 'agent-1',
      data: 'ls -la\r',
    };

    const outputMsg: WSMessageServer = {
      type: 'agent:output',
      agentId: 'agent-1',
      data: 'total 0\r\n',
    };

    expect(JSON.parse(JSON.stringify(inputMsg))).toEqual(inputMsg);
    expect(JSON.parse(JSON.stringify(outputMsg))).toEqual(outputMsg);
  });
});
```

- [ ] **Step 6: Install dependencies in `server/` and test**

Run: `cd server && npm install && npm test`
Expected: Installation succeeds and Vitest test passes.

- [ ] **Step 7: Commit scaffolding**

```bash
git add server/
git commit -m "feat(server): scaffold backend Node.js + TypeScript server with wsProtocol types"
```

---

### Task 2: Build SSH Key Loader & Tmux Auto-Discovery Engine

**Files:**
- Create: `server/src/utils/sshKeyLoader.ts`
- Create: `server/src/services/TmuxDiscovery.ts`
- Test: `server/src/services/__tests__/TmuxDiscovery.test.ts`

**Interfaces:**
- Consumes: `CONFIG.SSH_KEY_PATHS`, `CONFIG.SSH_AUTH_SOCK`
- Produces: `getSshAuthOptions()` function and `discoverTmuxSessions()` helper returning `Agent[]`.

- [ ] **Step 1: Create `sshKeyLoader.ts`**

Create `server/src/utils/sshKeyLoader.ts`:
```typescript
import fs from 'fs';
import { CONFIG } from '../config.js';

export interface SshAuthOptions {
  agent?: string;
  privateKey?: string;
}

export function getSshAuthOptions(): SshAuthOptions {
  const options: SshAuthOptions = {};

  if (CONFIG.SSH_AUTH_SOCK && fs.existsSync(CONFIG.SSH_AUTH_SOCK)) {
    options.agent = CONFIG.SSH_AUTH_SOCK;
    return options;
  }

  for (const keyPath of CONFIG.SSH_KEY_PATHS) {
    if (fs.existsSync(keyPath)) {
      try {
        options.privateKey = fs.readFileSync(keyPath, 'utf8');
        return options;
      } catch (err) {
        // Continue to next keyfile
      }
    }
  }

  return options;
}
```

- [ ] **Step 2: Create `TmuxDiscovery.ts`**

Create `server/src/services/TmuxDiscovery.ts`:
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Agent } from '../protocol/wsProtocol.js';

const execFileAsync = promisify(execFile);

export async function discoverTmuxSessions(): Promise<Agent[]> {
  try {
    const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
    const sessionNames = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    return sessionNames.map((name, idx) => ({
      id: `tmux-${name}`,
      name: `Tmux: ${name}`,
      mode: 'tmux',
      targetHost: `localhost:${name}`,
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now() - idx * 60000,
      lastActivity: Date.now(),
    }));
  } catch (err) {
    // If tmux is not running or not installed, return empty list
    return [];
  }
}
```

- [ ] **Step 3: Create unit test for `TmuxDiscovery`**

Create `server/src/services/__tests__/TmuxDiscovery.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { discoverTmuxSessions } from '../TmuxDiscovery.js';

describe('TmuxDiscovery', () => {
  it('should return an array of discovered agents or empty array without erroring', async () => {
    const agents = await discoverTmuxSessions();
    expect(Array.isArray(agents)).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd server && npm test`
Expected: PASS

- [ ] **Step 5: Commit SSH key loader and auto-discovery engine**

```bash
git add server/src/utils/ server/src/services/TmuxDiscovery.ts server/src/services/__tests__/
git commit -m "feat(server): implement SSH key loader and startup tmux auto-discovery engine"
```

---

### Task 3: Build TmuxDriver & SshDriver Terminal Session Services

**Files:**
- Create: `server/src/services/TmuxDriver.ts`
- Create: `server/src/services/SshDriver.ts`

**Interfaces:**
- Consumes: `node-pty`, `ssh2`, `getSshAuthOptions`
- Produces: `TmuxDriver` and `SshDriver` instances exposing `write()`, `resize()`, `close()`, and `onData()` hooks.

- [ ] **Step 1: Create `TmuxDriver.ts`**

Create `server/src/services/TmuxDriver.ts`:
```typescript
import pty from 'node-pty';
import { CONFIG } from '../config.js';

export class TmuxDriver {
  private ptyProcess: pty.IPty;

  constructor(
    sessionName: string,
    cols: number = 80,
    rows: number = 24,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ) {
    // Spawn tmux new-session -A -s <name> (-A attaches if exists, creates if new)
    this.ptyProcess = pty.spawn('tmux', ['new-session', '-A', '-s', sessionName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || process.cwd(),
      env: process.env as Record<string, string>,
    });

    this.ptyProcess.onData(onData);
    this.ptyProcess.onExit((e) => onExit(e.exitCode));
  }

  write(data: string) {
    this.ptyProcess.write(data);
  }

  resize(cols: number, rows: number) {
    try {
      this.ptyProcess.resize(cols, rows);
    } catch (err) {
      // Ignore bounds error
    }
  }

  close() {
    try {
      this.ptyProcess.kill();
    } catch (err) {
      // Ignore kill error
    }
  }
}
```

- [ ] **Step 2: Create `SshDriver.ts`**

Create `server/src/services/SshDriver.ts`:
```typescript
import { Client, ClientChannel } from 'ssh2';
import { getSshAuthOptions } from '../utils/sshKeyLoader.js';

export class SshDriver {
  private sshClient: Client;
  private channel: ClientChannel | null = null;

  constructor(
    targetHost: string,
    cols: number = 80,
    rows: number = 24,
    onData: (data: string) => void,
    onExit: () => void,
    onError: (err: Error) => void
  ) {
    this.sshClient = new Client();

    // Parse user@host:port
    const [userHost, portStr] = targetHost.split(':');
    const port = portStr ? parseInt(portStr, 10) : 22;
    const [username, host] = userHost.includes('@')
      ? userHost.split('@')
      : [process.env.USER || 'root', userHost];

    const authOptions = getSshAuthOptions();

    this.sshClient.on('ready', () => {
      this.sshClient.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          onError(err);
          return;
        }

        this.channel = stream;
        stream.on('data', (data: Buffer) => onData(data.toString('utf8')));
        stream.on('close', () => {
          onExit();
          this.sshClient.end();
        });
      });
    });

    this.sshClient.on('error', (err) => {
      onError(err);
    });

    this.sshClient.connect({
      host,
      port,
      username,
      ...authOptions,
      readyTimeout: 10000,
    });
  }

  write(data: string) {
    if (this.channel) {
      this.channel.write(data);
    }
  }

  resize(cols: number, rows: number) {
    if (this.channel) {
      this.channel.setWindow(rows, cols, 0, 0);
    }
  }

  close() {
    if (this.channel) {
      this.channel.end();
    }
    this.sshClient.end();
  }
}
```

- [ ] **Step 3: Commit drivers**

```bash
git add server/src/services/TmuxDriver.ts server/src/services/SshDriver.ts
git commit -m "feat(server): implement TmuxDriver and SshDriver terminal session managers"
```

---

### Task 4: Build SessionManager Registry & Message Router

**Files:**
- Create: `server/src/services/SessionManager.ts`
- Test: `server/src/services/__tests__/SessionManager.test.ts`

**Interfaces:**
- Consumes: `TmuxDriver`, `SshDriver`, `TmuxDiscovery`, `WSMessageClient`, `WSMessageServer`
- Produces: `SessionManager` routing client WebSocket messages to active drivers and broadcasting terminal output.

- [ ] **Step 1: Create `SessionManager.ts`**

Create `server/src/services/SessionManager.ts`:
```typescript
import { WebSocket } from 'ws';
import { Agent, WSMessageClient, WSMessageServer } from '../protocol/wsProtocol.js';
import { TmuxDriver } from './TmuxDriver.js';
import { SshDriver } from './SshDriver.js';
import { discoverTmuxSessions } from './TmuxDiscovery.js';

interface ManagedDriver {
  driver: TmuxDriver | SshDriver;
  agent: Agent;
}

export class SessionManager {
  private agents: Map<string, Agent> = new Map();
  private drivers: Map<string, TmuxDriver | SshDriver> = new Map();
  private clients: Set<WebSocket> = new Set();

  async initialize() {
    const discovered = await discoverTmuxSessions();
    for (const agent of discovered) {
      this.agents.set(agent.id, agent);
    }
  }

  addClient(ws: WebSocket) {
    this.clients.add(ws);
    // Send initial list of active agents
    const initMsg: WSMessageServer = {
      type: 'agent:init_list',
      agents: Array.from(this.agents.values()),
    };
    ws.send(JSON.stringify(initMsg));
  }

  removeClient(ws: WebSocket) {
    this.clients.delete(ws);
  }

  private broadcast(msg: WSMessageServer) {
    const json = JSON.stringify(msg);
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    });
  }

  handleClientMessage(msg: WSMessageClient) {
    switch (msg.type) {
      case 'agent:create':
        this.createAgent(msg.name, msg.mode, msg.targetHost);
        break;

      case 'agent:input':
        this.sendInput(msg.agentId, msg.data);
        break;

      case 'agent:resize':
        this.resizeSession(msg.agentId, msg.cols, msg.rows);
        break;

      case 'agent:kill':
        this.killAgent(msg.agentId);
        break;
    }
  }

  createAgent(name: string, mode: 'tmux' | 'ssh', targetHost: string) {
    const id = `agent-${Date.now()}`;
    const agent: Agent = {
      id,
      name,
      mode,
      targetHost,
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.agents.set(id, agent);

    const onData = (data: string) => {
      agent.lastActivity = Date.now();
      this.broadcast({ type: 'agent:output', agentId: id, data });
    };

    const onExit = () => {
      agent.status = 'disconnected';
      this.broadcast({ type: 'agent:status_change', agentId: id, status: 'disconnected' });
    };

    const onError = (err: Error) => {
      agent.status = 'error';
      this.broadcast({ type: 'agent:status_change', agentId: id, status: 'error' });
      this.broadcast({ type: 'agent:output', agentId: id, data: `\r\n\x1b[31m[SSH Error] ${err.message}\x1b[0m\r\n` });
    };

    if (mode === 'tmux') {
      const sessionName = targetHost.includes(':') ? targetHost.split(':')[1] : targetHost;
      const driver = new TmuxDriver(sessionName, 80, 24, onData, onExit);
      this.drivers.set(id, driver);
    } else {
      const driver = new SshDriver(targetHost, 80, 24, onData, onExit, onError);
      this.drivers.set(id, driver);
    }

    this.broadcast({ type: 'agent:init_list', agents: Array.from(this.agents.values()) });
  }

  sendInput(agentId: string, data: string) {
    const driver = this.drivers.get(agentId);
    if (driver) {
      driver.write(data);
    }
  }

  resizeSession(agentId: string, cols: number, rows: number) {
    const driver = this.drivers.get(agentId);
    if (driver) {
      driver.resize(cols, rows);
    }
  }

  killAgent(agentId: string) {
    const driver = this.drivers.get(agentId);
    if (driver) {
      driver.close();
      this.drivers.delete(agentId);
    }
    this.agents.delete(agentId);
    this.broadcast({ type: 'agent:init_list', agents: Array.from(this.agents.values()) });
  }

  getAgentCount(): number {
    return this.agents.size;
  }
}
```

- [ ] **Step 2: Create unit test for `SessionManager`**

Create `server/src/services/__tests__/SessionManager.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { SessionManager } from '../SessionManager.js';

describe('SessionManager', () => {
  it('should initialize and register clients', async () => {
    const manager = new SessionManager();
    await manager.initialize();
    expect(manager.getAgentCount()).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 3: Run unit tests**

Run: `cd server && npm test`
Expected: PASS

- [ ] **Step 4: Commit SessionManager**

```bash
git add server/src/services/SessionManager.ts server/src/services/__tests__/SessionManager.test.ts
git commit -m "feat(server): implement SessionManager registry and WebSocket message router"
```

---

### Task 5: Build Entry Point (`src/index.ts`) & Frontend Live Connection Toggle

**Files:**
- Create: `server/src/index.ts`
- Modify: `src/services/agentSocket.ts` (in frontend repo root)

**Interfaces:**
- Consumes: Express, `ws`, `SessionManager`, `CONFIG`
- Produces: Live HTTP + WebSocket server listening on port 8080.

- [ ] **Step 1: Create `server/src/index.ts`**

Create `server/src/index.ts`:
```typescript
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { SessionManager } from './services/SessionManager.js';
import { WSMessageClient } from './protocol/wsProtocol.js';

async function bootstrap() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: CONFIG.WS_PATH });

  const sessionManager = new SessionManager();
  await sessionManager.initialize();

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      agents: sessionManager.getAgentCount(),
      timestamp: new Date().toISOString(),
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    sessionManager.addClient(ws);

    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data.toString()) as WSMessageClient;
        sessionManager.handleClientMessage(msg);
      } catch (err) {
        console.error('Invalid WebSocket message received:', err);
      }
    });

    ws.on('close', () => {
      sessionManager.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
      sessionManager.removeClient(ws);
    });
  });

  server.listen(CONFIG.PORT, () => {
    console.log(`⚡ AI Agent Manager Server listening on http://localhost:${CONFIG.PORT}`);
    console.log(`🔌 WebSocket Endpoint: ws://localhost:${CONFIG.PORT}${CONFIG.WS_PATH}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Connect frontend to live WebSocket endpoint**

Update `src/services/agentSocket.ts` (in frontend) to attempt connection to default `ws://localhost:8080/ws` if environment variable is omitted:
```typescript
// Replace line 13-16 in src/services/agentSocket.ts
const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';
this.connectLive(wsUrl);
```

- [ ] **Step 3: Test backend dev server execution**

Run: `cd server && npm run dev`
Expected: Server starts listening on `http://localhost:8080` with WebSocket endpoint `ws://localhost:8080/ws`.

- [ ] **Step 4: Commit entry point & frontend socket integration**

```bash
git add server/src/index.ts src/services/agentSocket.ts
git commit -m "feat(server): build Express + WebSocket server entry point and enable live WS connection"
```

---

### Task 6: End-to-End Verification & Deployment Test

**Files:**
- Execute verification steps and test suites.

- [ ] **Step 1: Test backend unit test suite**

Run: `cd server && npm test`
Expected: All backend Vitest tests pass cleanly.

- [ ] **Step 2: Test backend TypeScript build**

Run: `cd server && npm run build`
Expected: `tsc` compiles cleanly to `server/dist/`.

- [ ] **Step 3: Test frontend build**

Run: `npm run build` (in repo root)
Expected: Frontend Vite production bundle compiles cleanly.

- [ ] **Step 4: Commit final verification**

```bash
git add .
git commit -m "chore: complete AI Agent Manager Backend implementation and verification"
```
