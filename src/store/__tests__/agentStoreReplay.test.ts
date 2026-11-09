import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { useAgentStore } from '../agentStore';
import { useConnectionStore } from '../connectionStore';
import { agentSocket } from '../../services/agentSocket';
import type { WSMessageClient } from '../../services/wsProtocol';
import type { Agent } from '../../types/agent';

const notify = (msg: unknown) => (agentSocket as any).notify(msg);
const layer = () => (agentSocket as any).requests as { clear: () => void; resendInFlight: () => void };

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

const EXISTING = serverAgent({ id: 'agent-9', name: 'Other', targetHost: 'localhost:o' });
const BUILD = serverAgent({ id: 'agent-77', name: 'Build', targetHost: 'localhost:build' });

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('replayed acks versus newer roster knowledge', () => {
  let send: MockInstance<[WSMessageClient], boolean>;
  const frames = () => send.mock.calls.map((c) => c[0] as any);
  const ack = (reqId: string, agent?: Agent, op = 'create') =>
    notify({ type: 'agent:ack', reqId, op, ok: true, ...(agent ? { agent } : {}) });
  const state = () => useAgentStore.getState();

  beforeEach(() => {
    vi.useFakeTimers();
    layer().clear();
    useConnectionStore.setState({ mode: 'live' });
    useAgentStore.setState({ agents: [EXISTING], activeAgentId: 'agent-9', pending: {}, killing: {}, rosterNotices: [] });
    send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
  });

  afterEach(() => {
    layer().clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useConnectionStore.setState({ mode: 'demo' });
  });

  describe('create ack for an agent that is already gone', () => {
    it('a later init_list without the agent: the replayed cached ack leaves no ghost and drops the pane', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      layer().resendInFlight();
      notify({ type: 'agent:init_list', agents: [EXISTING] });
      ack(frames()[1].reqId, BUILD);
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-9');
      expect(s.rosterNotices).toEqual([]);
    });

    it('an agent:removed after the agent was announced: the ack leaves no ghost', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      notify({ type: 'agent:added', agent: BUILD });
      notify({ type: 'agent:removed', agentId: BUILD.id });
      ack(frames()[0].reqId, BUILD);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(state().pending).toEqual({});
    });

    it('an agent:removed for an agent never listed locally still counts', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      notify({ type: 'agent:removed', agentId: BUILD.id });
      ack(frames()[0].reqId, BUILD);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(state().pending).toEqual({});
    });

    it('a user-cancelled pane plus a snapshot without the agent: still no ghost', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = state().agents[1].id;
      state().removeAgent(pendingId);
      notify({ type: 'agent:init_list', agents: [EXISTING] });
      ack(frames()[0].reqId, BUILD);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
    });

    it('control: a snapshot without the agent followed by agent:added still settles normally', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      notify({ type: 'agent:init_list', agents: [EXISTING] });
      notify({ type: 'agent:added', agent: BUILD });
      ack(frames()[0].reqId, BUILD);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
      expect(state().pending).toEqual({});
    });

    it('control: an old removal that predates the request is ignored', async () => {
      notify({ type: 'agent:removed', agentId: BUILD.id });
      notify({ type: 'agent:init_list', agents: [EXISTING] });
      state().addAgent('Build', 'tmux', 'localhost:build');
      ack(frames()[0].reqId, BUILD);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
    });
  });

  describe('create ack for a listed agent keeps the pane layout', () => {
    it('copies float, position, size and z-index onto the listed agent and keeps the pane index', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = state().agents[1].id;
      state().addAgent('Second', 'tmux', 'localhost:second');
      const layout = { isFloating: true, x: 40, y: 50, width: 500, height: 300, zIndex: 7 };
      useAgentStore.setState({
        agents: state().agents.map((a) => (a.id === pendingId ? { ...a, layout } : a)),
      });
      // agent:added appends after the second pane
      notify({ type: 'agent:added', agent: BUILD });
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', pendingId, expect.stringMatching(/^pending-/), 'agent-77']);
      ack(frames()[0].reqId, BUILD);
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77', expect.stringMatching(/^pending-/)]);
      expect(s.agents[1].layout).toEqual(layout);
      expect(s.agents[1].name).toBe('Build');
      expect(s.pending[pendingId]).toBeUndefined();
    });
  });

  describe('update ack superseded by a newer agent:updated', () => {
    it('a stale replayed ack does not overwrite newer state', async () => {
      const p = state().updateAgent('agent-9', { name: 'Mine' });
      notify({ type: 'agent:updated', agentId: 'agent-9', patch: { name: 'Newer' } });
      ack(frames()[0].reqId, { ...EXISTING, name: 'Mine' }, 'update');
      expect(await p).toBe(true);
      expect(state().agents[0].name).toBe('Newer');
    });

    it('control: with no event since sending, the ack is applied', async () => {
      notify({ type: 'agent:updated', agentId: 'agent-9', patch: { name: 'Earlier' } });
      const p = state().updateAgent('agent-9', { name: 'Mine', tags: ['a'] });
      ack(frames()[0].reqId, { ...EXISTING, name: 'Mine', tags: ['a'] }, 'update');
      expect(await p).toBe(true);
      expect(state().agents[0]).toMatchObject({ name: 'Mine', tags: ['a'] });
    });

    it('an event for another agent does not suppress the ack', async () => {
      const p = state().updateAgent('agent-9', { name: 'Mine' });
      notify({ type: 'agent:updated', agentId: 'other', patch: { name: 'Z' } });
      ack(frames()[0].reqId, { ...EXISTING, name: 'Mine' }, 'update');
      expect(await p).toBe(true);
      expect(state().agents[0].name).toBe('Mine');
    });
  });
});
