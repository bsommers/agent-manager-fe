import { create } from 'zustand';
import { Agent, LayoutMode } from '../types/agent';
import { agentSocket } from '../services/agentSocket';
import { parseAgent, type WSMessageClient } from '../services/wsProtocol';
import type { BackendMode } from '../services/adapters/types';
import { useConnectionStore } from './connectionStore';
import { reconcileSnapshot, type PendingMap } from './rosterReconcile';

const SEED_AGENTS = (): Agent[] => [
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

/** Demo shows the three seed agents; live starts empty and follows the gateway. */
export function initialAgentsFor(mode: BackendMode): Agent[] {
  return mode === 'demo' ? SEED_AGENTS() : [];
}

let pendingCounter = 0;
const isLive = () => useConnectionStore.getState().mode === 'live';

export interface AgentStoreState {
  agents: Agent[];
  pending: PendingMap;
  activeAgentId: string | null;
  layoutMode: LayoutMode;
  searchQuery: string;

  setActiveAgentId: (id: string | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setSearchQuery: (query: string) => void;
  addAgent: (name: string, mode: 'tmux' | 'ssh', targetHost: string, initialCmd?: string) => void;
  removeAgent: (id: string) => void;
  applyRosterSnapshot: (agents: unknown) => void;
  toggleUndock: (id: string) => void;
  updateFloatingPosition: (id: string, x: number, y: number) => void;
  updateFloatingBounds: (id: string, x: number, y: number, width: number, height: number) => void;
  arrangeGrid: (containerWidth?: number, containerHeight?: number) => void;
  arrangeCascade: (containerWidth?: number, containerHeight?: number) => void;
  arrangeFocus: (activeId?: string, containerWidth?: number, containerHeight?: number) => void;
  bringToFront: (id: string) => void;
  setAgents: (agents: Agent[]) => void;
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agents: initialAgentsFor(useConnectionStore.getState().mode),
  pending: {},
  activeAgentId: useConnectionStore.getState().mode === 'demo' ? 'agent-1' : null,
  layoutMode: 'grid',
  searchQuery: '',

  setActiveAgentId: (id) => set({ activeAgentId: id }),
  setLayoutMode: (mode) => set({ layoutMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setAgents: (agents) => set({ agents }),

  addAgent: (name, mode, targetHost, initialCmd) => {
    if (isLive()) {
      const msg: WSMessageClient = { type: 'agent:create', name, mode, targetHost };
      if (typeof initialCmd === 'string' && initialCmd.length > 0) msg.initialCmd = initialCmd;
      if (!agentSocket.send(msg)) return;
      const now = Date.now();
      const id = `pending-${++pendingCounter}`;
      const pendingAgent: Agent = {
        id,
        name,
        mode,
        targetHost,
        status: 'idle',
        unreadOutput: false,
        layout: { isFloating: false },
        createdAt: now,
        lastActivity: now,
      };
      set((state) => ({
        agents: [...state.agents, pendingAgent],
        activeAgentId: id,
        pending: { ...state.pending, [id]: { name, mode, targetHost, startedAt: now } },
      }));
      return;
    }
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
    set((state) => ({
      agents: [...state.agents, newAgent],
      activeAgentId: newAgent.id,
    }));
    agentSocket.startMockStream(newAgent.id, newAgent.name, newAgent.mode, newAgent.targetHost);
  },

  removeAgent: (id) => {
    const currentActive = get().activeAgentId;
    const nextAgents = get().agents.filter((a) => a.id !== id);
    agentSocket.stopMockStream(id);
    set({
      agents: nextAgents,
      activeAgentId: currentActive === id ? nextAgents[0]?.id || null : currentActive,
    });
  },

  applyRosterSnapshot: (raw) => {
    if (!isLive()) return;
    if (!Array.isArray(raw)) {
      console.warn('agentStore: ignoring agent:init_list with a non-array agents field');
      return;
    }
    const valid: Agent[] = [];
    for (const entry of raw) {
      const parsed = parseAgent(entry);
      if (parsed.ok) valid.push(parsed.msg);
    }
    const dropped = raw.length - valid.length;
    if (dropped > 0) console.warn(`agentStore: dropped ${dropped} invalid agent entries from snapshot`);

    const state = get();
    const result = reconcileSnapshot(state.agents, state.pending, valid);
    const currentActive = state.activeAgentId;
    let nextActive: string | null;
    if (currentActive !== null && result.claimed[currentActive] !== undefined) {
      nextActive = result.claimed[currentActive];
    } else if (currentActive !== null && result.agents.some((a) => a.id === currentActive)) {
      nextActive = currentActive;
    } else {
      nextActive = result.agents[0]?.id ?? null;
    }
    set({ agents: result.agents, pending: result.pending, activeAgentId: nextActive });
  },

  toggleUndock: (id) => {
    set((state) => ({
      agents: state.agents.map((a) => {
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
      }),
    }));
  },

  updateFloatingPosition: (id, x, y) => {
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, layout: { ...a.layout, x, y } } : a)),
    }));
  },

  updateFloatingBounds: (id, x, y, width, height) => {
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, layout: { ...a.layout, x, y, width, height } } : a)),
    }));
  },

  arrangeGrid: (containerWidth = 1200, containerHeight = 750) => {
    const currentAgents = get().agents;
    const total = currentAgents.length;
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

    const nextAgents = currentAgents.map((agent, i) => {
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

    set({ agents: nextAgents, layoutMode: 'grid' });
  },

  arrangeCascade: (containerWidth = 1200, containerHeight = 750) => {
    const currentAgents = get().agents;
    const defaultW = Math.min(680, Math.max(360, containerWidth - 80));
    const defaultH = Math.min(440, Math.max(260, containerHeight - 80));
    const step = 35;

    const nextAgents = currentAgents.map((agent, i) => {
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

    set({ agents: nextAgents, layoutMode: 'cascade' });
  },

  arrangeFocus: (activeId, containerWidth = 1200, containerHeight = 750) => {
    const currentAgents = get().agents;
    const focusId = activeId || get().activeAgentId || currentAgents[0]?.id;
    const gap = 12;
    const padding = 16;
    const sideW = Math.min(320, Math.floor(containerWidth * 0.28));
    const mainW = containerWidth - (padding * 2) - sideW - gap;
    const mainH = containerHeight - (padding * 2);

    let sideIdx = 0;
    const nextAgents = currentAgents.map((agent) => {
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

    set({ agents: nextAgents, layoutMode: 'focus' });
  },

  bringToFront: (id) => {
    const currentAgents = get().agents;
    const maxZ = Math.max(...currentAgents.map((a) => a.layout.zIndex || 1), 100);
    const nextAgents = currentAgents.map((a) => {
      if (a.id === id) {
        return {
          ...a,
          layout: { ...a.layout, zIndex: maxZ + 1 },
        };
      }
      return a;
    });

    set({ agents: nextAgents, activeAgentId: id });
  },
}));

// Compatibility proxy for direct store references (agentStore.agents, agentStore.addAgent, etc.)
export const agentStore = new Proxy({} as AgentStoreState & { subscribe: (listener: () => void) => () => void }, {
  get(_target, prop: string | symbol) {
    const state = useAgentStore.getState();
    if (prop === 'subscribe') {
      return (listener: (state: AgentStoreState) => void) => useAgentStore.subscribe(listener);
    }
    if (prop in state) {
      return (state as any)[prop];
    }
    return undefined;
  },
});

agentSocket.subscribe((msg) => {
  if (msg.type === 'agent:init_list') {
    useAgentStore.getState().applyRosterSnapshot(msg.agents);
  }
});
