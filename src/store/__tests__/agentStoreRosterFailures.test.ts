import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { useAgentStore, ROSTER_REQUEST_TIMEOUT_MS } from '../agentStore';
import { useConnectionStore } from '../connectionStore';
import { agentSocket } from '../../services/agentSocket';
import type { WSMessageClient } from '../../services/wsProtocol';
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

const EXISTING = serverAgent({ id: 'agent-9', name: 'Other', targetHost: 'localhost:o' });

describe('live roster failure paths', () => {
  let send: MockInstance<[WSMessageClient], boolean>;

  beforeEach(() => {
    vi.useFakeTimers();
    (agentSocket as any).requests.clear();
    useConnectionStore.setState({ mode: 'live' });
    useAgentStore.setState({
      agents: [EXISTING],
      activeAgentId: 'agent-9',
      pending: {},
      killing: {},
      rosterNotices: [],
    });
    send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
  });

  afterEach(() => {
    (agentSocket as any).requests.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useConnectionStore.setState({ mode: 'demo' });
  });

  const snapshot = (agents: unknown) => notify({ type: 'agent:init_list', agents });

  describe('create', () => {
    it('pushes a create_failed notice when the message is not delivered', () => {
      send.mockReturnValue(false);
      useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
      const s = useAgentStore.getState();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('create_failed');
      expect(s.rosterNotices[0].title).toContain('Build');
      expect(s.rosterNotices[0].message).toMatch(/connected/);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rolls back after 10 s: pending removed, previous active restored, one notice', async () => {
      useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
      expect(useAgentStore.getState().activeAgentId?.startsWith('pending-')).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);

      const s = useAgentStore.getState();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-9');
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('create_failed');
      expect(s.rosterNotices[0].title).toContain('Build');
      expect(s.rosterNotices[0].message).toMatch(/10 s/);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rollback with no previous agent leaves a null active id', async () => {
      useAgentStore.setState({ agents: [], activeAgentId: null });
      useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);
      expect(useAgentStore.getState().agents).toEqual([]);
      expect(useAgentStore.getState().activeAgentId).toBeNull();
    });

    it('an ack before the timeout clears the timer and settles the pane', async () => {
      useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
      notify({
        type: 'agent:ack',
        reqId: (send.mock.calls[0][0] as any).reqId,
        op: 'create',
        ok: true,
        agent: serverAgent({ id: 'agent-77', name: 'Build', targetHost: 'localhost:build' }),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS * 2);
      const s = useAgentStore.getState();
      expect(s.rosterNotices).toEqual([]);
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
    });

    it('cancelling a pending create sends no kill, removes it and pushes no notice', () => {
      useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = useAgentStore.getState().agents[1].id;
      send.mockClear();

      useAgentStore.getState().removeAgent(pendingId);

      const s = useAgentStore.getState();
      expect(send).not.toHaveBeenCalled();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.pending).toEqual({});
      expect(s.rosterNotices).toEqual([]);
      // The request stays in flight in the request layer (its answer may still add the agent).
      expect(vi.getTimerCount()).toBe(1);
    });

    it('cancelled create, then the gateway announces it: exactly one ordinary agent', () => {
      useAgentStore.setState({ agents: [], activeAgentId: null });
      useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = useAgentStore.getState().agents[0].id;
      useAgentStore.getState().removeAgent(pendingId);

      snapshot([serverAgent({ id: 'agent-77', name: 'Build', targetHost: 'localhost:build' })]);

      const s = useAgentStore.getState();
      expect(s.agents).toHaveLength(1);
      expect(s.agents[0]).toMatchObject({ id: 'agent-77', name: 'Build' });
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-77');
    });

    it('snapshot arriving after the rollback: no duplicate and no stuck pending entry', async () => {
      useAgentStore.setState({ agents: [], activeAgentId: null });
      useAgentStore.getState().addAgent('Build', 'tmux', 'localhost:build');
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);
      expect(useAgentStore.getState().agents).toEqual([]);
      expect(useAgentStore.getState().rosterNotices).toHaveLength(1);

      const late = serverAgent({ id: 'agent-77', name: 'Build', targetHost: 'localhost:build' });
      snapshot([late]);
      snapshot([late]);

      const s = useAgentStore.getState();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-77']);
      expect(s.pending).toEqual({});
      expect(Object.keys(s.killing)).toEqual([]);
      expect(s.rosterNotices).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('kill', () => {
    it('sends exactly one agent:kill, keeps the agent listed and ignores a second call', () => {
      useAgentStore.getState().removeAgent('agent-9');
      useAgentStore.getState().removeAgent('agent-9');
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ type: 'agent:kill', agentId: 'agent-9' });
      const s = useAgentStore.getState();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.killing['agent-9']).toBeDefined();
    });

    it('a snapshot without the agent removes it and clears killing and the timer', () => {
      useAgentStore.setState({
        agents: [EXISTING, serverAgent({ id: 'agent-10', name: 'Two' })],
        activeAgentId: 'agent-9',
      });
      useAgentStore.getState().removeAgent('agent-9');
      snapshot([serverAgent({ id: 'agent-10', name: 'Two' })]);
      const s = useAgentStore.getState();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-10']);
      expect(s.killing).toEqual({});
      expect(s.activeAgentId).toBe('agent-10');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('removing the last agent leaves a null active id', () => {
      useAgentStore.getState().removeAgent('agent-9');
      snapshot([]);
      expect(useAgentStore.getState().agents).toEqual([]);
      expect(useAgentStore.getState().activeAgentId).toBeNull();
    });

    it('pushes kill_failed and does not set killing when not delivered', () => {
      send.mockReturnValue(false);
      useAgentStore.getState().removeAgent('agent-9');
      const s = useAgentStore.getState();
      expect(s.killing).toEqual({});
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('kill_failed');
      expect(s.rosterNotices[0].title).toContain('Other');
      expect(s.rosterNotices[0].message).toMatch(/connected/);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('an unconfirmed kill keeps the agent listed and pushes one kill_failed notice', () => {
      useAgentStore.getState().removeAgent('agent-9');
      vi.advanceTimersByTime(ROSTER_REQUEST_TIMEOUT_MS);
      const s = useAgentStore.getState();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.killing).toEqual({});
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('kill_failed');
      expect(s.rosterNotices[0].message).toMatch(/10 s/);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a snapshot that still lists the agent keeps killing until the timeout', () => {
      useAgentStore.getState().removeAgent('agent-9');
      snapshot([EXISTING]);
      expect(useAgentStore.getState().killing['agent-9']).toBeDefined();
      vi.advanceTimersByTime(ROSTER_REQUEST_TIMEOUT_MS);
      expect(useAgentStore.getState().rosterNotices).toHaveLength(1);
    });
  });

  describe('status events', () => {
    it('updates status and lastActivity with no component mounted', () => {
      vi.setSystemTime(5_000_000);
      notify({ type: 'agent:status_change', agentId: 'agent-9', status: 'error' });
      const a = useAgentStore.getState().agents[0];
      expect(a.status).toBe('error');
      expect(a.lastActivity).toBe(5_000_000);
    });

    it('ignores an unknown agent id', () => {
      const before = useAgentStore.getState().agents;
      notify({ type: 'agent:status_change', agentId: 'nope', status: 'error' });
      expect(useAgentStore.getState().agents).toBe(before);
    });
  });

  describe('snapshot hardening', () => {
    let warn: MockInstance;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('a non-array agents field leaves the roster unchanged', () => {
      snapshot('not an array');
      snapshot(null);
      snapshot({ length: 1 });
      expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(warn).toHaveBeenCalled();
    });

    it('drops invalid entries, keeps valid ones and logs only a count', () => {
      snapshot([
        serverAgent({ id: 'ok-1', name: 'Good' }),
        { name: 'no id', mode: 'tmux' },
        { ...serverAgent({ id: 'bad-type' }), status: 42 },
        'a string',
        null,
        { ...serverAgent({ id: 'ok-2', name: 'Secret <img src=x onerror=alert(1)>' }) },
      ]);
      const ids = useAgentStore.getState().agents.map((a) => a.id);
      expect(ids).toEqual(['ok-1', 'ok-2']);
      const logged = warn.mock.calls.map((c) => c.join(' ')).join(' ');
      expect(logged).toMatch(/4/);
      expect(logged).not.toContain('onerror');
      expect(logged).not.toContain('no id');
    });

    it('the same snapshot twice and a reconnect resync leave no duplicate ids', () => {
      const snap = [serverAgent({ id: 'a1' }), serverAgent({ id: 'a2', name: 'Two' })];
      snapshot(snap);
      snapshot(snap);
      useConnectionStore.setState({ state: 'reconnecting' });
      useConnectionStore.setState({ state: 'open' });
      snapshot(snap);
      const ids = useAgentStore.getState().agents.map((a) => a.id);
      expect(ids).toEqual(['a1', 'a2']);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('dismissRosterNotice removes only that notice', () => {
    send.mockReturnValue(false);
    useAgentStore.getState().addAgent('A', 'tmux', 'h:a');
    useAgentStore.getState().addAgent('B', 'tmux', 'h:b');
    const [first, second] = useAgentStore.getState().rosterNotices;
    useAgentStore.getState().dismissRosterNotice(first.id);
    expect(useAgentStore.getState().rosterNotices.map((n) => n.id)).toEqual([second.id]);
  });
});
