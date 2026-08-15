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

export const agentStore = {
  get agents() {
    return agentsState;
  },
  get activeAgentId() {
    return activeAgentIdState;
  },
  get layoutMode() {
    return layoutModeState;
  },
  get searchQuery() {
    return searchQueryState;
  },

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

  updateFloatingBounds: (id: string, x: number, y: number, width: number, height: number) => {
    agentsState = agentsState.map((a) => {
      if (a.id === id) {
        return {
          ...a,
          layout: { ...a.layout, x, y, width, height },
        };
      }
      return a;
    });
    notifyStore();
  },

  arrangeGrid: (containerWidth: number = 1200, containerHeight: number = 750) => {
    const total = agentsState.length;
    if (total === 0) return;

    let cols = 1;
    let rows = 1;
    if (total === 2) { cols = 2; rows = 1; }
    else if (total <= 4) { cols = 2; rows = 2; }
    else if (total <= 6) { cols = 3; rows = 2; }
    else { cols = 3; rows = Math.ceil(total / 3); }

    const gap = 12;
    const padding = 16;
    const availW = containerWidth - (padding * 2) - (gap * (cols - 1));
    const availH = containerHeight - (padding * 2) - (gap * (rows - 1));
    const itemW = Math.max(320, Math.floor(availW / cols));
    const itemH = Math.max(240, Math.floor(availH / rows));

    agentsState = agentsState.map((agent, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = padding + c * (itemW + gap);
      const y = padding + r * (itemH + gap);
      return {
        ...agent,
        layout: {
          ...agent.layout,
          isFloating: true,
          x,
          y,
          width: itemW,
          height: itemH,
        },
      };
    });
    layoutModeState = 'grid';
    notifyStore();
  },

  arrangeCascade: (containerWidth: number = 1200, containerHeight: number = 750) => {
    const defaultW = Math.min(680, Math.max(360, containerWidth - 80));
    const defaultH = Math.min(440, Math.max(260, containerHeight - 80));
    const step = 35;

    agentsState = agentsState.map((agent, i) => {
      const maxX = Math.max(20, containerWidth - defaultW - 20);
      const maxY = Math.max(20, containerHeight - defaultH - 20);
      const x = 20 + ((i * step) % maxX);
      const y = 20 + ((i * step) % maxY);
      return {
        ...agent,
        layout: {
          ...agent.layout,
          isFloating: true,
          x,
          y,
          width: defaultW,
          height: defaultH,
          zIndex: 10 + i,
        },
      };
    });
    layoutModeState = 'cascade';
    notifyStore();
  },

  arrangeFocus: (activeId?: string, containerWidth: number = 1200, containerHeight: number = 750) => {
    const focusId = activeId || activeAgentIdState || agentsState[0]?.id;
    const gap = 12;
    const padding = 16;
    const sideW = Math.min(320, Math.floor(containerWidth * 0.28));
    const mainW = containerWidth - (padding * 2) - sideW - gap;
    const mainH = containerHeight - (padding * 2);

    let sideIdx = 0;
    agentsState = agentsState.map((agent) => {
      if (agent.id === focusId) {
        return {
          ...agent,
          layout: {
            ...agent.layout,
            isFloating: true,
            x: padding,
            y: padding,
            width: mainW,
            height: mainH,
            zIndex: 100,
          },
        };
      } else {
        const x = padding + mainW + gap;
        const itemH = 200;
        const y = padding + sideIdx * (itemH + gap);
        sideIdx++;
        return {
          ...agent,
          layout: {
            ...agent.layout,
            isFloating: true,
            x,
            y,
            width: sideW,
            height: itemH,
            zIndex: 50 + sideIdx,
          },
        };
      }
    });
    layoutModeState = 'focus';
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

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useAgentStore() {
  const [, setTick] = useState(0);

  useEffect(() => {
    return agentStore.subscribe(() => setTick((t) => t + 1));
  }, []);

  return agentStore;
}
