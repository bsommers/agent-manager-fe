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
