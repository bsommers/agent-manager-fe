# AI Agent Manager Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a high-performance React + Vite frontend for managing AI agents with hybrid dockable/floating windows, interactive `xterm.js` terminals, auto-arrange presets, and dual-mode WebSocket streaming (Mock Driver + Live WS backend).

**Architecture:** A Vite + React + TypeScript application with a centralized state store for agents and window positions. Uses `@xterm/xterm` for canvas terminal rendering, an absolute/flex layout manager for hybrid grid-docking and freeform floating windows, and an abstract WebSocket driver that simulates terminal stdout/stdin for dev preview.

**Tech Stack:** React 18+, Vite, TypeScript, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `lucide-react`, Tailwind CSS, Vitest.

## Global Constraints

- **Framework**: React 18+ with Vite ESM setup.
- **Terminal**: Canvas `@xterm/xterm` with `@xterm/addon-fit`.
- **Styling**: Dark Mode Command Center HUD aesthetic with glassmorphism overlays and custom xterm dark theme.
- **Protocol**: Dual-mode WebSocket abstraction (`MockAgentSocketDriver` default, swappable to `ws://` / `wss://` backend).

---

### Task 1: Scaffold Vite + React + TypeScript Project & Install Dependencies

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles/globals.css`
- Create: `src/styles/xterm-theme.css`

**Interfaces:**
- Consumes: None
- Produces: Base Vite dev environment with `@xterm/xterm`, `lucide-react`, and CSS tokens loaded.

- [ ] **Step 1: Create package.json and vite configuration**

Create `package.json` with required scripts and dependencies:
```json
{
  "name": "agent-manager-fe",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",
    "@xterm/xterm": "^5.5.0",
    "lucide-react": "^0.344.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5",
    "vite": "^5.3.1",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create Vite configuration and TypeScript setup**

Create `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
});
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create base HTML, CSS tokens, and entry point**

Create `index.html`:
```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Agent Manager</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  </head>
  <body class="bg-[#090d16] text-slate-100 antialiased overflow-hidden select-none font-sans">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/styles/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    background-color: #090d16;
    color: #f1f5f9;
    font-family: 'Inter', sans-serif;
  }
}

/* Custom scrollbars */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: #0f172a;
}
::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #475569;
}
```

Create `src/styles/xterm-theme.css`:
```css
@import '@xterm/xterm/css/xterm.css';

.xterm {
  padding: 8px;
  height: 100%;
}
.xterm-viewport {
  background-color: #0d1322 !important;
}
```

Create `src/main.tsx` and `src/App.tsx`:
```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './styles/xterm-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

```tsx
// src/App.tsx
import React from 'react';

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100">
      <h1 className="p-4 text-xl font-bold border-b border-slate-800">AI Agent Manager</h1>
    </div>
  );
}
```

- [ ] **Step 4: Install dependencies and test build**

Run: `npm install`
Expected: Installation completes cleanly without errors.

- [ ] **Step 5: Commit scaffolding**

```bash
git add package.json vite.config.ts tsconfig.json index.html src/ styles/
git commit -m "feat: scaffold Vite + React + TypeScript project with xterm and tailwind"
```

---

### Task 2: Agent Types, State Store & Mock Terminal Stream Service

**Files:**
- Create: `src/types/agent.ts`
- Create: `src/services/wsProtocol.ts`
- Create: `src/services/mockStreamGenerator.ts`
- Create: `src/services/agentSocket.ts`
- Create: `src/store/agentStore.ts`
- Test: `src/store/__tests__/agentStore.test.ts`

**Interfaces:**
- Consumes: `@xterm/xterm` (ANSI text output rules)
- Produces: `useAgentStore` hook, `agentSocket` service for sending terminal input and receiving output.

- [ ] **Step 1: Write types and WS protocol definitions**

Create `src/types/agent.ts`:
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

export type LayoutMode = 'grid' | 'focus' | 'cascade';
```

Create `src/services/wsProtocol.ts`:
```typescript
import { AgentMode, AgentStatus } from '../types/agent';

export type WSMessageClient =
  | { type: 'agent:input'; agentId: string; data: string }
  | { type: 'agent:resize'; agentId: string; cols: number; rows: number }
  | { type: 'agent:create'; name: string; mode: AgentMode; targetHost: string; initialCmd?: string }
  | { type: 'agent:kill'; agentId: string };

export type WSMessageServer =
  | { type: 'agent:output'; agentId: string; data: string }
  | { type: 'agent:status_change'; agentId: string; status: AgentStatus }
  | { type: 'agent:init_list'; agents: any[] };
```

- [ ] **Step 2: Create Mock Terminal Stream Generator**

Create `src/services/mockStreamGenerator.ts`:
```typescript
// Generates realistic ANSI formatted terminal output for simulated agents
export class MockStreamGenerator {
  private static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
  };

  static getInitialBanner(name: string, mode: string, targetHost: string): string {
    const c = this.colors;
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    return (
      `${c.bright}${c.cyan}=== AI Agent Terminal [${name}] ===${c.reset}\r\n` +
      `${c.dim}Mode: ${mode.toUpperCase()} | Target: ${targetHost} | Session Started: ${time}${c.reset}\r\n` +
      `${c.green}System online. Type 'help' for mock commands.${c.reset}\r\n\r\n` +
      `${c.bright}${c.magenta}agent@${name.toLowerCase().replace(/\s+/g, '-')}:~$ ${c.reset}`
    );
  }

  static handleMockCommand(input: string, name: string): string {
    const c = this.colors;
    const cmd = input.trim().toLowerCase();
    const prompt = `\r\n${c.bright}${c.magenta}agent@${name.toLowerCase().replace(/\s+/g, '-')}:~$ ${c.reset}`;

    if (cmd === 'help') {
      return (
        `\r\nAvailable mock commands:\r\n` +
        `  ${c.yellow}status${c.reset}    - Display agent runtime metrics\r\n` +
        `  ${c.yellow}run${c.reset}       - Simulate AI agent execution task\r\n` +
        `  ${c.yellow}clear${c.reset}     - Clear terminal window\r\n` +
        `  ${c.yellow}htop${c.reset}      - Simulate process monitor\r\n` +
        prompt
      );
    }

    if (cmd === 'status') {
      return (
        `\r\n${c.cyan}[AGENT METRICS]${c.reset}\r\n` +
        `  CPU Usage: ${Math.floor(Math.random() * 40 + 5)}%\r\n` +
        `  Memory: 412MB / 2048MB\r\n` +
        `  Active Threads: 4\r\n` +
        `  SSH Status: CONNECTED (0ms latency)\r\n` +
        prompt
      );
    }

    if (cmd === 'run') {
      return (
        `\r\n${c.yellow}[AI AGENT EXECUTION]${c.reset}\r\n` +
        `> Analyzing code repository context...\r\n` +
        `> Generating patch for component layout optimization...\r\n` +
        `${c.green}✓ Step 1/3: Parsing TypeScript AST... Complete.${c.reset}\r\n` +
        `${c.green}✓ Step 2/3: Running test suites... 14 passed.${c.reset}\r\n` +
        `${c.green}✓ Step 3/3: Committing git patch.${c.reset}\r\n` +
        prompt
      );
    }

    return `\r\n${c.red}bash: ${input.trim()}: command not found${c.reset}${prompt}`;
  }
}
```

- [ ] **Step 3: Create WebSocket Service with Mock Driver**

Create `src/services/agentSocket.ts`:
```typescript
import { MockStreamGenerator } from './mockStreamGenerator';
import { WSMessageClient, WSMessageServer } from './wsProtocol';

type Listener = (msg: WSMessageServer) => void;

export class AgentSocketService {
  private listeners: Set<Listener> = new Set();
  private isMockMode: boolean = true;
  private ws: WebSocket | null = null;
  private mockIntervals: Map<string, number> = new Map();

  constructor() {
    const wsUrl = import.meta.env.VITE_WS_URL;
    if (wsUrl) {
      this.connectLive(wsUrl);
    }
  }

  private connectLive(url: string) {
    try {
      this.ws = new WebSocket(url);
      this.isMockMode = false;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as WSMessageServer;
        this.notify(msg);
      };
    } catch (e) {
      console.warn('Live WS failed, falling back to mock driver', e);
      this.isMockMode = true;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(msg: WSMessageServer) {
    this.listeners.forEach((fn) => fn(msg));
  }

  send(msg: WSMessageClient) {
    if (!this.isMockMode && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }

    // Mock mode handling
    if (msg.type === 'agent:input') {
      const output = MockStreamGenerator.handleMockCommand(msg.data, msg.agentId);
      this.notify({
        type: 'agent:output',
        agentId: msg.agentId,
        data: output,
      });
    }
  }

  startMockStream(agentId: string, name: string, mode: string, targetHost: string) {
    // Send initial banner
    const banner = MockStreamGenerator.getInitialBanner(name, mode, targetHost);
    this.notify({ type: 'agent:output', agentId, data: banner });

    // Periodic heartbeat log simulation
    const intervalId = window.setInterval(() => {
      const logs = [
        `\x1b[36m[info]\x1b[0m agent heartbeat ok (${new Date().toLocaleTimeString()})\r\n`,
        `\x1b[32m[task]\x1b[0m context sync completed.\r\n`,
      ];
      const randomLog = logs[Math.floor(Math.random() * logs.length)];
      this.notify({ type: 'agent:output', agentId, data: randomLog });
    }, 15000);

    this.mockIntervals.set(agentId, intervalId);
  }

  stopMockStream(agentId: string) {
    const id = this.mockIntervals.get(agentId);
    if (id) {
      clearInterval(id);
      this.mockIntervals.delete(agentId);
    }
  }
}

export const agentSocket = new AgentSocketService();
```

- [ ] **Step 4: Create Central Agent Store**

Create `src/store/agentStore.ts`:
```typescript
import { useState, useEffect } from 'react';
import { Agent, LayoutMode } from '../types/agent';
import { agentSocket } from '../services/agentSocket';

const INITIAL_AGENTS: Agent[] = [
  {
    id: 'agent-1',
    name: 'Code Refactor Agent',
    mode: 'tmux',
    targetHost: 'localhost:tmux_dev_1',
    status: 'running',
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: Date.now() - 3600000,
    lastActivity: Date.now(),
  },
  {
    id: 'agent-2',
    name: 'Remote Prod Monitor',
    mode: 'ssh',
    targetHost: 'admin@192.168.1.100:22',
    status: 'thinking',
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: Date.now() - 7200000,
    lastActivity: Date.now(),
  },
  {
    id: 'agent-3',
    name: 'DB Migration Worker',
    mode: 'tmux',
    targetHost: 'localhost:tmux_db_sync',
    status: 'idle',
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: Date.now() - 1800000,
    lastActivity: Date.now(),
  },
];

let agentsState: Agent[] = INITIAL_AGENTS;
let activeAgentIdState: string | null = 'agent-1';
let layoutModeState: LayoutMode = 'grid';
let searchQueryState: string = '';
const listeners = new Set<() => void>();

function notifyStore() {
  listeners.forEach((l) => l());
}

export function useAgentStore() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    agents: agentsState,
    activeAgentId: activeAgentIdState,
    layoutMode: layoutModeState,
    searchQuery: searchQueryState,
    
    setActiveAgentId: (id: string | null) => {
      activeAgentIdState = id;
      notifyStore();
    },

    setLayoutMode: (mode: LayoutMode) => {
      layoutModeState = mode;
      notifyStore();
    },

    setSearchQuery: (query: string) => {
      searchQueryState = query;
      notifyStore();
    },

    addAgent: (name: string, mode: 'tmux' | 'ssh', targetHost: string) => {
      const newAgent: Agent = {
        id: `agent-${Date.now()}`,
        name,
        mode,
        targetHost,
        status: 'running',
        unreadOutput: false,
        layout: { isFloating: false },
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      agentsState = [...agentsState, newAgent];
      activeAgentIdState = newAgent.id;
      agentSocket.startMockStream(newAgent.id, newAgent.name, newAgent.mode, newAgent.targetHost);
      notifyStore();
    },

    removeAgent: (id: string) => {
      agentsState = agentsState.filter((a) => a.id !== id);
      agentSocket.stopMockStream(id);
      if (activeAgentIdState === id) {
        activeAgentIdState = agentsState[0]?.id || null;
      }
      notifyStore();
    },

    toggleUndock: (id: string) => {
      agentsState = agentsState.map((a) => {
        if (a.id === id) {
          const isFloating = !a.layout.isFloating;
          return {
            ...a,
            layout: {
              ...a.layout,
              isFloating,
              x: isFloating ? Math.random() * 200 + 100 : undefined,
              y: isFloating ? Math.random() * 100 + 100 : undefined,
              width: isFloating ? 650 : undefined,
              height: isFloating ? 400 : undefined,
              zIndex: isFloating ? 100 : undefined,
            },
          };
        }
        return a;
      });
      notifyStore();
    },

    updateFloatingPosition: (id: string, x: number, y: number) => {
      agentsState = agentsState.map((a) => {
        if (a.id === id) {
          return {
            ...a,
            layout: { ...a.layout, x, y },
          };
        }
        return a;
      });
      notifyStore();
    },

    bringToFront: (id: string) => {
      const maxZ = Math.max(...agentsState.map((a) => a.layout.zIndex || 1), 100);
      agentsState = agentsState.map((a) => {
        if (a.id === id) {
          return {
            ...a,
            layout: { ...a.layout, zIndex: maxZ + 1 },
          };
        }
        return a;
      });
      activeAgentIdState = id;
      notifyStore();
    },
  };
}
```

- [ ] **Step 5: Write Store unit test**

Create `src/store/__tests__/agentStore.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { useAgentStore } from '../agentStore';

describe('agentStore', () => {
  it('should initialize with default mock agents', () => {
    const store = useAgentStore();
    expect(store.agents.length).toBeGreaterThan(0);
    expect(store.activeAgentId).toBe('agent-1');
  });

  it('should support adding and removing agents', () => {
    const store = useAgentStore();
    const initialCount = store.agents.length;
    
    store.addAgent('Test Agent', 'tmux', 'localhost:test');
    expect(store.agents.length).toBe(initialCount + 1);

    const added = store.agents.find(a => a.name === 'Test Agent');
    expect(added).toBeDefined();

    if (added) {
      store.removeAgent(added.id);
      expect(store.agents.length).toBe(initialCount);
    }
  });
});
```

- [ ] **Step 6: Run tests to verify**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit store and socket services**

```bash
git add src/types/ src/services/ src/store/
git commit -m "feat: implement agent store, websocket service, and mock stream generator"
```

---

### Task 3: Build Interactive Terminal Component (`TerminalView.tsx`)

**Files:**
- Create: `src/components/agent/TerminalView.tsx`

**Interfaces:**
- Consumes: `@xterm/xterm`, `@xterm/addon-fit`, `agentSocket`
- Produces: `TerminalView` component rendering live ANSI terminal output and sending user input keyboard events.

- [ ] **Step 1: Write `TerminalView.tsx` with xterm lifecycle and fitAddon**

Create `src/components/agent/TerminalView.tsx`:
```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { agentSocket } from '../../services/agentSocket';

interface TerminalViewProps {
  agentId: string;
  agentName: string;
  mode: string;
  targetHost: string;
  isActive: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  agentId,
  agentName,
  mode,
  targetHost,
  isActive,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const currentInputRef = useRef<string>('');

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm terminal instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      theme: {
        background: '#0d1322',
        foreground: '#f1f5f9',
        cursor: '#00f2fe',
        selectionBackground: '#1e293b',
        black: '#0f172a',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f8fafc',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Start mock output stream or listen for WS output
    agentSocket.startMockStream(agentId, agentName, mode, targetHost);

    const unsubscribe = agentSocket.subscribe((msg) => {
      if (msg.type === 'agent:output' && msg.agentId === agentId) {
        term.write(msg.data);
      }
    });

    // Handle user keystrokes in xterm
    term.onData((data) => {
      if (data === '\r') {
        // Enter pressed: send line to socket
        term.write('\r\n');
        const inputToSend = currentInputRef.current;
        currentInputRef.current = '';
        agentSocket.send({
          type: 'agent:input',
          agentId,
          data: inputToSend,
        });
      } else if (data === '\u007F') {
        // Backspace pressed
        if (currentInputRef.current.length > 0) {
          currentInputRef.current = currentInputRef.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (data >= ' ' || data === '\t') {
        currentInputRef.current += data;
        term.write(data);
      }
    });

    // Handle container resize
    const handleResize = () => {
      try {
        fitAddon.fit();
        if (term.cols && term.rows) {
          agentSocket.send({
            type: 'agent:resize',
            agentId,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch (err) {
        // Ignore container zero height during layout transition
      }
    };

    const observer = new ResizeObserver(() => handleResize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      unsubscribe();
      agentSocket.stopMockStream(agentId);
      term.dispose();
    };
  }, [agentId, agentName, mode, targetHost]);

  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
      }, 50);
    }
  }, [isActive]);

  return <div ref={containerRef} className="w-full h-full min-h-[180px] bg-[#0d1322] rounded-b-lg" />;
};
```

- [ ] **Step 2: Commit TerminalView component**

```bash
git add src/components/agent/TerminalView.tsx
git commit -m "feat: build xterm.js TerminalView component with fitAddon and input stream integration"
```

---

### Task 4: Build Agent Window Pane & Floating Window Frame Components

**Files:**
- Create: `src/components/agent/AgentControls.tsx`
- Create: `src/components/agent/AgentPane.tsx`
- Create: `src/components/layout/FloatingPane.tsx`

**Interfaces:**
- Consumes: `Agent`, `useAgentStore`, `TerminalView`
- Produces: `AgentPane` (docked view card) and `FloatingPane` (absolute draggable window frame).

- [ ] **Step 1: Build `AgentControls.tsx`**

Create `src/components/agent/AgentControls.tsx`:
```tsx
import React from 'react';
import { Terminal, RefreshCw, Trash2, ArrowUpRight, Maximize2 } from 'lucide-react';
import { agentSocket } from '../../services/agentSocket';
import { useAgentStore } from '../../store/agentStore';

interface AgentControlsProps {
  agentId: string;
  isFloating: boolean;
}

export const AgentControls: React.FC<AgentControlsProps> = ({ agentId, isFloating }) => {
  const { toggleUndock, removeAgent } = useAgentStore();

  const handleCtrlC = () => {
    agentSocket.send({
      type: 'agent:input',
      agentId,
      data: '\x03', // SIGINT
    });
  };

  const handleClear = () => {
    agentSocket.send({
      type: 'agent:input',
      agentId,
      data: 'clear',
    });
  };

  return (
    <div className="flex items-center gap-1 bg-[#131b2e] border-t border-slate-800 px-3 py-1.5 text-xs text-slate-400">
      <button
        onClick={handleCtrlC}
        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 hover:text-white transition flex items-center gap-1 font-mono text-[11px]"
        title="Send SIGINT (Ctrl+C)"
      >
        Ctrl+C
      </button>
      <button
        onClick={handleClear}
        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 hover:text-white transition text-[11px]"
      >
        Clear
      </button>
      
      <div className="flex-1" />

      <button
        onClick={() => toggleUndock(agentId)}
        className="p-1 hover:text-cyan-400 transition rounded hover:bg-slate-800"
        title={isFloating ? 'Dock Window' : 'Pop out Floating Window'}
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => removeAgent(agentId)}
        className="p-1 hover:text-red-400 transition rounded hover:bg-slate-800"
        title="Close Agent"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Build `AgentPane.tsx`**

Create `src/components/agent/AgentPane.tsx`:
```tsx
import React from 'react';
import { Agent } from '../../types/agent';
import { TerminalView } from './TerminalView';
import { AgentControls } from './AgentControls';
import { useAgentStore } from '../../store/agentStore';

interface AgentPaneProps {
  agent: Agent;
}

export const AgentPane: React.FC<AgentPaneProps> = ({ agent }) => {
  const { activeAgentId, setActiveAgentId } = useAgentStore();
  const isActive = activeAgentId === agent.id;

  const statusColor = {
    running: 'bg-emerald-500 shadow-emerald-500/50',
    thinking: 'bg-amber-500 shadow-amber-500/50 animate-pulse',
    idle: 'bg-slate-500',
    error: 'bg-red-500 shadow-red-500/50',
    disconnected: 'bg-slate-600',
  }[agent.status];

  return (
    <div
      onClick={() => setActiveAgentId(agent.id)}
      className={`h-full w-full flex flex-col bg-[#0d1322] border rounded-lg overflow-hidden transition-all duration-150 ${
        isActive
          ? 'border-cyan-500/80 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Header bar */}
      <div className="flex items-center px-3 py-2 bg-[#131b2e] border-b border-slate-800/80 select-none">
        <span className={`w-2 h-2 rounded-full mr-2.5 shadow-sm ${statusColor}`} />
        <span className="font-semibold text-xs text-slate-200 truncate mr-2">
          {agent.name}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 uppercase">
          {agent.mode}
        </span>
        <span className="ml-auto text-[10px] font-mono text-slate-500 truncate max-w-[140px]">
          {agent.targetHost}
        </span>
      </div>

      {/* Terminal Container */}
      <div className="flex-1 min-h-[160px] relative">
        <TerminalView
          agentId={agent.id}
          agentName={agent.name}
          mode={agent.mode}
          targetHost={agent.targetHost}
          isActive={isActive}
        />
      </div>

      {/* Quick Action Footer */}
      <AgentControls agentId={agent.id} isFloating={agent.layout.isFloating} />
    </div>
  );
};
```

- [ ] **Step 3: Build `FloatingPane.tsx`**

Create `src/components/layout/FloatingPane.tsx`:
```tsx
import React, { useState, useRef } from 'react';
import { Agent } from '../../types/agent';
import { AgentPane } from '../agent/AgentPane';
import { useAgentStore } from '../../store/agentStore';

interface FloatingPaneProps {
  agent: Agent;
}

export const FloatingPane: React.FC<FloatingPaneProps> = ({ agent }) => {
  const { bringToFront, updateFloatingPosition } = useAgentStore();
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number }>({
    x: 0,
    y: 0,
    posX: agent.layout.x || 120,
    posY: agent.layout.y || 120,
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    bringToFront(agent.id);
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: agent.layout.x || 120,
      posY: agent.layout.y || 120,
    };

    const handleMouseMove = (moveEvt: MouseEvent) => {
      const dx = moveEvt.clientX - dragStartRef.current.x;
      const dy = moveEvt.clientY - dragStartRef.current.y;
      updateFloatingPosition(
        agent.id,
        Math.max(10, dragStartRef.current.posX + dx),
        Math.max(50, dragStartRef.current.posY + dy)
      );
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${agent.layout.x || 120}px`,
        top: `${agent.layout.y || 120}px`,
        width: `${agent.layout.width || 650}px`,
        height: `${agent.layout.height || 400}px`,
        zIndex: agent.layout.zIndex || 100,
      }}
      className={`flex flex-col shadow-2xl rounded-lg overflow-hidden border border-cyan-500/40 backdrop-blur-md bg-[#0d1322]/95 ${
        isDragging ? 'opacity-90 cursor-grabbing' : ''
      }`}
    >
      {/* Draggable header drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="bg-slate-900/90 hover:bg-slate-800/90 cursor-grab px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-cyan-400 select-none"
      >
        <span>⚡ FLOATING PANE [{agent.name}]</span>
        <span className="text-[10px] text-slate-500">Drag to move</span>
      </div>

      <div className="flex-1 overflow-hidden">
        <AgentPane agent={agent} />
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Commit agent pane components**

```bash
git add src/components/agent/ src/components/layout/FloatingPane.tsx
git commit -m "feat: build AgentPane and FloatingPane draggable window wrapper components"
```

---

### Task 5: Build Main Workspace, Header, Toolbar & Add Agent Modal

**Files:**
- Create: `src/components/layout/Header.tsx`
- Create: `src/components/layout/Toolbar.tsx`
- Create: `src/components/layout/Workspace.tsx`
- Create: `src/components/agent/AddAgentModal.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAgentStore`, `AgentPane`, `FloatingPane`
- Produces: Complete interactive AI Agent Manager application view.

- [ ] **Step 1: Build `Header.tsx`**

Create `src/components/layout/Header.tsx`:
```tsx
import React from 'react';
import { Cpu, Terminal, Shield, Activity } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

export const Header: React.FC = () => {
  const { agents } = useAgentStore();

  const activeCount = agents.filter((a) => a.status === 'running').length;
  const thinkingCount = agents.filter((a) => a.status === 'thinking').length;
  const sshCount = agents.filter((a) => a.mode === 'ssh').length;
  const tmuxCount = agents.filter((a) => a.mode === 'tmux').length;

  return (
    <header className="h-14 bg-[#0d1322] border-b border-slate-800 flex items-center px-4 justify-between select-none">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
          <Cpu className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-sm text-slate-100 tracking-wide flex items-center gap-2">
            AI AGENT COMMAND CENTER
            <span className="text-[10px] px-1.5 py-0.2 font-mono bg-cyan-950 text-cyan-400 border border-cyan-800 rounded">
              v1.0
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">Multi-agent terminal operation dashboard</p>
        </div>
      </div>

      {/* Global Status Counters */}
      <div className="flex items-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="text-slate-400">Active:</span>
          <span className="font-mono font-semibold text-slate-200">{activeCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-slate-400">Thinking:</span>
          <span className="font-mono font-semibold text-slate-200">{thinkingCount}</span>
        </div>
        <div className="h-4 w-[1px] bg-slate-800" />
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/60">
            SSH: {sshCount}
          </span>
          <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
            TMUX: {tmuxCount}
          </span>
        </div>
      </div>
    </header>
  );
};
```

- [ ] **Step 2: Build `Toolbar.tsx`**

Create `src/components/layout/Toolbar.tsx`:
```tsx
import React from 'react';
import { LayoutGrid, Maximize2, Layers, Plus, Search } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { LayoutMode } from '../../types/agent';

interface ToolbarProps {
  onOpenAddModal: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenAddModal }) => {
  const { layoutMode, setLayoutMode, searchQuery, setSearchQuery } = useAgentStore();

  return (
    <div className="h-12 bg-[#090d16] border-b border-slate-800/80 flex items-center px-4 justify-between gap-4 select-none">
      {/* Search Input */}
      <div className="relative flex-1 max-w-xs">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search agents by name or host..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#0d1322] border border-slate-800 rounded-md pl-9 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
        />
      </div>

      {/* Layout Presets */}
      <div className="flex items-center gap-1 bg-[#0d1322] p-1 border border-slate-800 rounded-md">
        <button
          onClick={() => setLayoutMode('grid')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
            layoutMode === 'grid'
              ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Auto Grid Layout"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Grid
        </button>
        <button
          onClick={() => setLayoutMode('focus')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
            layoutMode === 'focus'
              ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Focus Mode"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Focus
        </button>
        <button
          onClick={() => setLayoutMode('cascade')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
            layoutMode === 'cascade'
              ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Floating Cascade"
        >
          <Layers className="w-3.5 h-3.5" />
          Cascade
        </button>
      </div>

      {/* Add Agent Button */}
      <button
        onClick={onOpenAddModal}
        className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-bold px-3 py-1.5 rounded-md text-xs shadow-md shadow-cyan-950/50 transition active:scale-95"
      >
        <Plus className="w-4 h-4 stroke-[3]" />
        New Agent
      </button>
    </div>
  );
};
```

- [ ] **Step 3: Build `AddAgentModal.tsx`**

Create `src/components/agent/AddAgentModal.tsx`:
```tsx
import React, { useState } from 'react';
import { X, Server, Terminal } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { AgentMode } from '../../types/agent';

interface AddAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddAgentModal: React.FC<AddAgentModalProps> = ({ isOpen, onClose }) => {
  const { addAgent } = useAgentStore();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<AgentMode>('tmux');
  const [targetHost, setTargetHost] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetHost.trim()) return;

    addAgent(name.trim(), mode, targetHost.trim());
    setName('');
    setTargetHost('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[500] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0d1322] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#131b2e]">
          <h3 className="font-bold text-sm text-slate-200">Register New AI Agent</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-medium">Agent Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Code Review Worker"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#090d16] border border-slate-800 rounded-md px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('tmux')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-md border text-xs font-semibold transition ${
                  mode === 'tmux'
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300'
                    : 'border-slate-800 bg-[#090d16] text-slate-400 hover:border-slate-700'
                }`}
              >
                <Terminal className="w-4 h-4" />
                Local Tmux
              </button>
              <button
                type="button"
                onClick={() => setMode('ssh')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-md border text-xs font-semibold transition ${
                  mode === 'ssh'
                    ? 'border-purple-500 bg-purple-950/40 text-purple-300'
                    : 'border-slate-800 bg-[#090d16] text-slate-400 hover:border-slate-700'
                }`}
              >
                <Server className="w-4 h-4" />
                Remote SSH
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">
              {mode === 'tmux' ? 'Tmux Session Name' : 'SSH Target (user@host:port)'}
            </label>
            <input
              type="text"
              required
              placeholder={mode === 'tmux' ? 'localhost:tmux_session_2' : 'root@10.0.0.45:22'}
              value={targetHost}
              onChange={(e) => setTargetHost(e.target.value)}
              className="w-full bg-[#090d16] border border-slate-800 rounded-md px-3 py-2 text-slate-100 placeholder-slate-600 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 font-semibold text-slate-950"
            >
              Start Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Build `Workspace.tsx`**

Create `src/components/layout/Workspace.tsx`:
```tsx
import React from 'react';
import { useAgentStore } from '../../store/agentStore';
import { AgentPane } from '../agent/AgentPane';
import { FloatingPane } from './FloatingPane';

export const Workspace: React.FC = () => {
  const { agents, layoutMode, searchQuery, activeAgentId } = useAgentStore();

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.targetHost.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const dockedAgents = filteredAgents.filter((a) => !a.layout.isFloating);
  const floatingAgents = filteredAgents.filter((a) => a.layout.isFloating);

  // Focus layout mode logic
  const activeFocusedAgent = agents.find((a) => a.id === activeAgentId) || dockedAgents[0];
  const sideStripAgents = dockedAgents.filter((a) => a.id !== activeFocusedAgent?.id);

  return (
    <div className="flex-1 relative overflow-hidden bg-[#090d16] p-3">
      {/* Docked Grid View Layer */}
      {layoutMode === 'grid' && (
        <div
          className={`h-full w-full grid gap-3 transition-all duration-200 ${
            dockedAgents.length <= 1
              ? 'grid-cols-1 grid-rows-1'
              : dockedAgents.length <= 2
              ? 'grid-cols-2 grid-rows-1'
              : dockedAgents.length <= 4
              ? 'grid-cols-2 grid-rows-2'
              : 'grid-cols-3 grid-rows-2'
          }`}
        >
          {dockedAgents.map((agent) => (
            <div key={agent.id} className="h-full w-full min-h-0 min-w-0">
              <AgentPane agent={agent} />
            </div>
          ))}
        </div>
      )}

      {/* Focus View Layer */}
      {layoutMode === 'focus' && (
        <div className="h-full w-full flex gap-3">
          <div className="flex-1 h-full min-w-0">
            {activeFocusedAgent ? (
              <AgentPane agent={activeFocusedAgent} />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                No agent selected for focus mode
              </div>
            )}
          </div>
          {sideStripAgents.length > 0 && (
            <div className="w-80 h-full flex flex-col gap-3 overflow-y-auto">
              {sideStripAgents.map((agent) => (
                <div key={agent.id} className="h-48 min-h-[190px]">
                  <AgentPane agent={agent} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cascade Layout Mode */}
      {layoutMode === 'cascade' && (
        <div className="h-full w-full relative">
          {dockedAgents.map((agent, idx) => (
            <div
              key={agent.id}
              style={{
                position: 'absolute',
                left: `${idx * 40 + 20}px`,
                top: `${idx * 40 + 20}px`,
                width: '640px',
                height: '380px',
                zIndex: idx + 10,
              }}
              className="shadow-2xl rounded-lg overflow-hidden border border-slate-700"
            >
              <AgentPane agent={agent} />
            </div>
          ))}
        </div>
      )}

      {/* Pop-Out Floating Windows Overlay Layer */}
      {floatingAgents.map((agent) => (
        <FloatingPane key={agent.id} agent={agent} />
      ))}
    </div>
  );
};
```

- [ ] **Step 5: Assemble full application in `App.tsx`**

Modify `src/App.tsx`:
```tsx
import React, { useState } from 'react';
import { Header } from './components/layout/Header';
import { Toolbar } from './components/layout/Toolbar';
import { Workspace } from './components/layout/Workspace';
import { AddAgentModal } from './components/agent/AddAgentModal';

export default function App() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 overflow-hidden">
      <Header />
      <Toolbar onOpenAddModal={() => setIsAddModalOpen(true)} />
      <Workspace />
      <AddAgentModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 6: Run build and tests to verify whole application**

Run: `npm run build`
Expected: TypeScript compilation succeeds cleanly, production bundle generated.

- [ ] **Step 7: Commit UI layout components**

```bash
git add src/components/ src/App.tsx
git commit -m "feat: assemble main HUD workspace, layout toolbar, modal, and header"
```

---

### Task 6: End-to-End Verification & Dev Server Test

**Files:**
- Execute runtime verification commands.

- [ ] **Step 1: Test unit tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Build bundle verification**

Run: `npm run build`
Expected: Output in `dist/` created cleanly without errors.

- [ ] **Step 3: Commit final plan deliverable**

```bash
git add .
git commit -m "chore: complete AI Agent Manager implementation verification"
```
