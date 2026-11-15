import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { useAgentStore, resetAgentStore, initialAgentsFor } from '../agentStore';
import { useConnectionStore } from '../connectionStore';
import { useLogBufferStore } from '../logBufferStore';
import { agentSocket } from '../../services/agentSocket';
import type { Agent } from '../../types/agent';

const notify = (msg: unknown) => (agentSocket as any).notify(msg);

function serverAgent(id: string): Agent {
  return {
    id,
    name: `Worker ${id}`,
    mode: 'tmux',
    targetHost: 'localhost:w',
    status: 'running',
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: 1000,
    lastActivity: 2000,
  };
}

const dirty = () =>
  useAgentStore.setState({
    agents: [serverAgent('x1')],
    pending: { p1: { startedAt: 1 } as never },
    killing: { x1: 5 },
    rosterNotices: [{ id: 'n1', kind: 'gateway_error', title: 't', message: 'm' } as never],
    activeAgentId: 'x1',
    layoutMode: 'tiled' as never,
    searchQuery: 'zzz',
  });

beforeEach(() => {
  useConnectionStore.setState({ mode: 'live' });
});

afterEach(() => {
  resetAgentStore();
  useConnectionStore.setState({ mode: 'demo' });
});

describe('resetAgentStore', () => {
  it('restores the seven state fields to their live initial values', () => {
    dirty();
    resetAgentStore();
    const s = useAgentStore.getState();
    expect(s.agents).toEqual([]);
    expect(s.pending).toEqual({});
    expect(s.killing).toEqual({});
    expect(s.rosterNotices).toEqual([]);
    expect(s.activeAgentId).toBeNull();
    expect(s.layoutMode).toBe('grid');
    expect(s.searchQuery).toBe('');
  });

  it('demo mode resets to the seed agents with agent-1 active', () => {
    useConnectionStore.setState({ mode: 'demo' });
    dirty();
    resetAgentStore();
    const s = useAgentStore.getState();
    expect(s.agents.map((a) => a.id)).toEqual(initialAgentsFor('demo').map((a) => a.id));
    expect(s.activeAgentId).toBe('agent-1');
  });

  it('does not touch the other stores', () => {
    useLogBufferStore.getState().appendOutput('x1', 'hello\n');
    useConnectionStore.setState({ lastError: 'boom' });
    resetAgentStore();
    expect(useLogBufferStore.getState().buffers['x1']).toBeDefined();
    expect(useConnectionStore.getState().lastError).toBe('boom');
    expect(useConnectionStore.getState().mode).toBe('live');
    useLogBufferStore.getState().clearBuffer();
    useConnectionStore.setState({ lastError: null });
  });

  it('forgets roster tracking: a snapshot after a reset behaves as on a fresh store', () => {
    notify({ type: 'agent:init_list', agents: [serverAgent('t1')] });
    notify({ type: 'agent:added', agent: serverAgent('t2') });
    notify({ type: 'agent:removed', agentId: 't2' });
    resetAgentStore();
    expect(useAgentStore.getState().agents).toEqual([]);
    notify({ type: 'agent:init_list', agents: [serverAgent('t2')] });
    expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['t2']);
    expect(useAgentStore.getState().activeAgentId).toBe('t2');
  });

  it('is idempotent', () => {
    dirty();
    resetAgentStore();
    const first = useAgentStore.getState().agents;
    resetAgentStore();
    expect(useAgentStore.getState().agents).toEqual(first);
  });
});
