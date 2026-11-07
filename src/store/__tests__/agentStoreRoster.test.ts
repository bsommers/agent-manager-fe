import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { WSMessageClient } from '../../services/wsProtocol';
import { useAgentStore, initialAgentsFor, agentStore } from '../agentStore';
import { useConnectionStore } from '../connectionStore';
import { agentSocket } from '../../services/agentSocket';
import type { Agent } from '../../types/agent';

const notify = (msg: unknown) => (agentSocket as any).notify(msg);

function serverAgent(over: Partial<Agent> & { id: string }): Agent {
  return {
    name: 'Worker',
    mode: 'tmux',
    targetHost: 'localhost:w',
    status: 'running',
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: 1000,
    lastActivity: 2000,
    ...over,
  };
}

// Shapes copied from server/src/services/SessionManager.ts (createAgent) and
// server/src/services/TmuxDiscovery.ts (discoverTmuxSessions).
const GATEWAY_CREATED: Agent = {
  id: 'agent-1762500000000-a1b2',
  name: 'Build Runner',
  mode: 'tmux',
  targetHost: 'localhost:build',
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1762500000000,
  lastActivity: 1762500000000,
};
const GATEWAY_DISCOVERED: Agent = {
  id: 'tmux-foo',
  name: 'Tmux: foo',
  mode: 'tmux',
  targetHost: 'localhost:foo',
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1762499940000,
  lastActivity: 1762500000000,
};

describe('live roster: initial state and snapshot reconciliation', () => {
  let send: MockInstance<[WSMessageClient], boolean>;

  beforeEach(() => {
    useConnectionStore.setState({ mode: 'live' });
    useAgentStore.setState({ agents: [], activeAgentId: null, pending: {} });
    send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useConnectionStore.setState({ mode: 'demo' });
  });

  it('initialAgentsFor returns the seeds in demo and nothing in live', () => {
    expect(initialAgentsFor('demo').map((a) => a.id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    expect(initialAgentsFor('live')).toEqual([]);
  });

  it('live addAgent sends exactly one agent:create and appends a pending agent', () => {
    useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'agent:create',
      name: 'Build',
      mode: 'tmux',
      targetHost: 'localhost:build',
    });
    const s = useAgentStore.getState();
    expect(s.agents).toHaveLength(1);
    expect(s.agents[0].id.startsWith('pending-')).toBe(true);
    expect(s.agents[0].status).toBe('idle');
    expect(s.agents[0].layout.isFloating).toBe(false);
    expect(s.activeAgentId).toBe(s.agents[0].id);
    expect(s.pending[s.agents[0].id]).toMatchObject({ name: 'Build', mode: 'tmux', targetHost: 'localhost:build' });
  });

  it('live addAgent forwards initialCmd only when non-empty', () => {
    useAgentStore.getState().addAgent('A', 'ssh', 'u@h', 'ls -la');
    expect(send).toHaveBeenLastCalledWith({
      type: 'agent:create',
      name: 'A',
      mode: 'ssh',
      targetHost: 'u@h',
      initialCmd: 'ls -la',
    });
    useAgentStore.getState().addAgent('B', 'ssh', 'u@h2', '');
    expect(send).toHaveBeenLastCalledWith({
      type: 'agent:create',
      name: 'B',
      mode: 'ssh',
      targetHost: 'u@h2',
    });
  });

  it('live addAgent adds nothing when the message is not delivered', () => {
    send.mockReturnValue(false);
    useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
    const s = useAgentStore.getState();
    expect(s.agents).toEqual([]);
    expect(s.pending).toEqual({});
  });

  it('claims the pending create: server id, same slot, layout and focus carried over', () => {
    useAgentStore.setState({
      agents: [serverAgent({ id: 'agent-9', name: 'Other', targetHost: 'localhost:o' })],
      activeAgentId: 'agent-9',
    });
    useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
    const pendingId = useAgentStore.getState().agents[1].id;
    useAgentStore.setState((st) => ({
      agents: st.agents.map((a) =>
        a.id === pendingId ? { ...a, layout: { isFloating: true, x: 5, y: 6, width: 300, height: 200 } } : a,
      ),
    }));

    notify({
      type: 'agent:init_list',
      agents: [
        serverAgent({ id: 'agent-9', name: 'Other', targetHost: 'localhost:o' }),
        serverAgent({ id: 'agent-77-zz', name: 'Build', targetHost: 'localhost:build' }),
      ],
    });

    const s = useAgentStore.getState();
    expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77-zz']);
    expect(s.agents[1].layout).toEqual({ isFloating: true, x: 5, y: 6, width: 300, height: 200 });
    expect(s.pending).toEqual({});
    expect(s.activeAgentId).toBe('agent-77-zz');
  });

  it('applying the same snapshot twice never duplicates', () => {
    const snap = {
      type: 'agent:init_list',
      agents: [serverAgent({ id: 'a1' }), serverAgent({ id: 'a2', name: 'Two' })],
    };
    notify(snap);
    notify(snap);
    expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(useAgentStore.getState().activeAgentId).toBe('a1');
  });

  it('surviving agents keep local layout and unreadOutput; missing agents are removed', () => {
    useAgentStore.setState({
      agents: [
        serverAgent({ id: 'a1', unreadOutput: true, layout: { isFloating: true, x: 9, y: 9 } }),
        serverAgent({ id: 'a2', name: 'Two' }),
      ],
      activeAgentId: 'a2',
    });
    notify({
      type: 'agent:init_list',
      agents: [serverAgent({ id: 'a1', status: 'thinking', unreadOutput: false })],
    });
    const s = useAgentStore.getState();
    expect(s.agents).toHaveLength(1);
    expect(s.agents[0]).toMatchObject({
      id: 'a1',
      status: 'thinking',
      unreadOutput: true,
      layout: { isFloating: true, x: 9, y: 9 },
    });
    expect(s.activeAgentId).toBe('a1');
  });

  it('activeAgentId becomes null when the snapshot is empty', () => {
    useAgentStore.setState({ agents: [serverAgent({ id: 'a1' })], activeAgentId: 'a1' });
    notify({ type: 'agent:init_list', agents: [] });
    expect(useAgentStore.getState().activeAgentId).toBeNull();
  });

  it('survives gateway-real agent shapes: createAgent id and discovered tmux agent', () => {
    notify({ type: 'agent:init_list', agents: [GATEWAY_DISCOVERED, GATEWAY_CREATED] });
    const s = useAgentStore.getState();
    expect(s.agents.map((a) => a.id)).toEqual(['tmux-foo', 'agent-1762500000000-a1b2']);
    expect(s.agents[0].name).toBe('Tmux: foo');
    expect(s.agents[1]).toMatchObject({ name: 'Build Runner', mode: 'tmux', targetHost: 'localhost:build' });
  });

  it('claims a pending create against the gateway-real server shape', () => {
    useAgentStore.getState().addAgent('Build Runner', 'tmux', 'localhost:build');
    notify({ type: 'agent:init_list', agents: [GATEWAY_DISCOVERED, GATEWAY_CREATED] });
    const s = useAgentStore.getState();
    expect(s.agents.map((a) => a.id)).toEqual(['agent-1762500000000-a1b2', 'tmux-foo']);
    expect(s.pending).toEqual({});
    expect(s.activeAgentId).toBe('agent-1762500000000-a1b2');
  });

  it('ignores snapshots in demo mode', () => {
    useConnectionStore.setState({ mode: 'demo' });
    notify({ type: 'agent:init_list', agents: [serverAgent({ id: 'x1' })] });
    expect(useAgentStore.getState().agents).toEqual([]);
  });
});

describe('demo mode regression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('addAgent sends no agent:create, starts the mock stream, removeAgent is local', () => {
    const send = vi.spyOn(agentSocket, 'send');
    const start = vi.spyOn(agentSocket, 'startMockStream');
    const before = agentStore.agents.length;
    agentStore.addAgent('Demo Worker', 'tmux', 'localhost:demo');
    expect(send).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    const added = agentStore.agents.find((a) => a.name === 'Demo Worker')!;
    expect(added.id.startsWith('agent-')).toBe(true);
    agentStore.removeAgent(added.id);
    expect(agentStore.agents.length).toBe(before);
    expect(send).not.toHaveBeenCalled();
  });
});
