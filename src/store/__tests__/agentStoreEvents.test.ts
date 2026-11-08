import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAgentStore } from '../agentStore';
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

const A = serverAgent({ id: 'agent-1762500000000-a1b2', name: 'Alpha', targetHost: 'localhost:alpha' });
const B = serverAgent({ id: 'agent-1762500000001-b2c3', name: 'Beta', targetHost: 'localhost:beta' });
const C = serverAgent({ id: 'tmux-gamma', name: 'Tmux: gamma', targetHost: 'localhost:gamma' });

const ids = () => useAgentStore.getState().agents.map((a) => a.id);
const names = () => useAgentStore.getState().agents.map((a) => a.name);

function reset() {
  (agentSocket as any).requests.clear();
  useAgentStore.setState({ agents: [], activeAgentId: null, pending: {}, killing: {}, rosterNotices: [] });
}

beforeEach(() => {
  useConnectionStore.setState({ mode: 'live' });
  reset();
});

afterEach(() => {
  reset();
  vi.restoreAllMocks();
  useConnectionStore.setState({ mode: 'demo' });
});

describe('agent:added', () => {
  it('appends an unknown agent with default layout and no unread output', () => {
    useAgentStore.setState({ agents: [A], activeAgentId: A.id });
    notify({ type: 'agent:added', agent: B });
    expect(ids()).toEqual([A.id, B.id]);
    const added = useAgentStore.getState().agents[1];
    expect(added.unreadOutput).toBe(false);
    expect(added.layout).toEqual({ isFloating: false });
    expect(added.name).toBe('Beta');
  });

  it('does not steal focus from an active agent', () => {
    useAgentStore.setState({ agents: [A], activeAgentId: A.id });
    notify({ type: 'agent:added', agent: B });
    expect(useAgentStore.getState().activeAgentId).toBe(A.id);
  });

  it('activates the new agent when there was no active agent', () => {
    notify({ type: 'agent:added', agent: A });
    expect(useAgentStore.getState().activeAgentId).toBe(A.id);
  });

  it('is idempotent: the same event twice leaves one agent', () => {
    notify({ type: 'agent:added', agent: A });
    notify({ type: 'agent:added', agent: A });
    expect(ids()).toEqual([A.id]);
  });

  it('for a known id takes the server fields and keeps local layout, unreadOutput and order', () => {
    const local = {
      ...A,
      unreadOutput: true,
      layout: { isFloating: true, x: 10, y: 20, width: 300, height: 200, zIndex: 12 },
    };
    useAgentStore.setState({ agents: [local, B], activeAgentId: B.id });
    notify({ type: 'agent:added', agent: { ...A, name: 'Alpha renamed', status: 'thinking' } });
    const s = useAgentStore.getState();
    expect(s.agents.map((a) => a.id)).toEqual([A.id, B.id]);
    expect(s.agents[0].name).toBe('Alpha renamed');
    expect(s.agents[0].status).toBe('thinking');
    expect(s.agents[0].unreadOutput).toBe(true);
    expect(s.agents[0].layout).toEqual(local.layout);
    expect(s.activeAgentId).toBe(B.id);
  });

  it('never touches pending entries or killing flags', () => {
    const pendingPane = serverAgent({ id: 'pending-9', name: 'New' });
    const pending = { 'pending-9': { name: 'New', mode: 'tmux' as const, targetHost: 'localhost:w', startedAt: 5, reqId: 'r1' } };
    useAgentStore.setState({ agents: [A, pendingPane], pending, killing: { [A.id]: 7 }, activeAgentId: 'pending-9' });
    notify({ type: 'agent:added', agent: B });
    const s = useAgentStore.getState();
    expect(s.pending).toEqual(pending);
    expect(s.killing).toEqual({ [A.id]: 7 });
    expect(s.activeAgentId).toBe('pending-9');
    expect(s.agents.map((a) => a.id)).toEqual([A.id, 'pending-9', B.id]);
  });

  it('drops an invalid event (missing agent) with one payload-free warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useAgentStore.setState({ agents: [A], activeAgentId: A.id });
    notify({ type: 'agent:added' });
    expect(ids()).toEqual([A.id]);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('drops an agent with a bad status and does not leak its text into the warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    notify({ type: 'agent:added', agent: { ...B, status: 'SECRET-STATUS-TEXT' } });
    expect(ids()).toEqual([]);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-STATUS-TEXT');
  });

  it('drops an agent whose id is 300 characters long', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    notify({ type: 'agent:added', agent: { ...B, id: 'x'.repeat(300) } });
    expect(ids()).toEqual([]);
  });

  it('ignores a new id when the roster already holds 1000 agents, but still updates a known one', () => {
    const many = Array.from({ length: 1000 }, (_, i) => serverAgent({ id: `bulk-${i}`, name: `bulk ${i}` }));
    useAgentStore.setState({ agents: many, activeAgentId: 'bulk-0' });
    notify({ type: 'agent:added', agent: B });
    expect(useAgentStore.getState().agents).toHaveLength(1000);
    expect(ids()).not.toContain(B.id);
    notify({ type: 'agent:added', agent: { ...many[5], name: 'known' } });
    expect(useAgentStore.getState().agents[5].name).toBe('known');
    expect(useAgentStore.getState().agents).toHaveLength(1000);
  });

  it('is ignored in Demo mode without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useConnectionStore.setState({ mode: 'demo' });
    const before = [A];
    useAgentStore.setState({ agents: before, activeAgentId: A.id });
    notify({ type: 'agent:added', agent: B });
    expect(useAgentStore.getState().agents).toBe(before);
    expect(warn).not.toHaveBeenCalled();
  });
});
