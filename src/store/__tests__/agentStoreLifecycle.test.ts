import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { useAgentStore, ROSTER_REQUEST_TIMEOUT_MS } from '../agentStore';
import { useConnectionStore } from '../connectionStore';
import { agentSocket } from '../../services/agentSocket';
import type { WSMessageClient } from '../../services/wsProtocol';
import type { Agent } from '../../types/agent';

const notify = (msg: unknown) => (agentSocket as any).notify(msg);
const layer = () => (agentSocket as any).requests as { clear: () => void };

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

// Shape of SessionManager.createAgent and TmuxDiscovery in the gateway.
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

/** Let promise continuations run (the request layer settles through promises). */
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('request-driven agent lifecycle', () => {
  let send: MockInstance<[WSMessageClient], boolean>;

  const frames = () => send.mock.calls.map((c) => c[0] as any);
  const reqIdOf = (i: number) => frames()[i].reqId as string;
  const ack = (reqId: string, agent?: Agent, op = 'create') =>
    notify({ type: 'agent:ack', reqId, op, ok: true, ...(agent ? { agent } : {}) });
  const fail = (reqId: string | undefined, code: string, message = 'boom', retryable = false) =>
    notify({ type: 'agent:error', ...(reqId ? { reqId } : {}), code, message, retryable });
  const snapshot = (agents: unknown) => notify({ type: 'agent:init_list', agents });
  const state = () => useAgentStore.getState();

  beforeEach(() => {
    vi.useFakeTimers();
    layer().clear();
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
    layer().clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useConnectionStore.setState({ mode: 'demo' });
  });

  describe('create', () => {
    it('sends one agent:create with a reqId and records the same reqId on the pending entry', () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      expect(send).toHaveBeenCalledTimes(1);
      expect(frames()[0]).toEqual({
        type: 'agent:create',
        name: 'Build',
        mode: 'tmux',
        targetHost: 'localhost:build',
        reqId: expect.any(String),
      });
      const pendingId = state().agents[1].id;
      expect(pendingId.startsWith('pending-')).toBe(true);
      expect(state().pending[pendingId].reqId).toBe(reqIdOf(0));
      expect(state().activeAgentId).toBe(pendingId);
    });

    it('forwards initialCmd only when non-empty and always carries a reqId', () => {
      state().addAgent('A', 'ssh', 'u@h', 'ls -la');
      state().addAgent('B', 'ssh', 'u@h2', '');
      expect(frames()[0]).toMatchObject({ initialCmd: 'ls -la', reqId: expect.any(String) });
      expect('initialCmd' in frames()[1]).toBe(false);
      expect(frames()[1].reqId).toEqual(expect.any(String));
      expect(reqIdOf(0)).not.toBe(reqIdOf(1));
    });

    it('an ack replaces the pending pane in place with its layout, moves focus and leaves no timer', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = state().agents[1].id;
      useAgentStore.setState((st) => ({
        agents: st.agents.map((a) =>
          a.id === pendingId ? { ...a, layout: { isFloating: true, x: 5, y: 6, width: 300, height: 200 } } : a,
        ),
      }));
      ack(reqIdOf(0), BUILD);
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
      expect(s.agents[1].layout).toEqual({ isFloating: true, x: 5, y: 6, width: 300, height: 200 });
      expect(s.agents[1].unreadOutput).toBe(false);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-77');
      expect(s.rosterNotices).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not move focus when the pane was no longer active', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      useAgentStore.setState({ activeAgentId: 'agent-9' });
      ack(reqIdOf(0), BUILD);
      await flush();
      expect(state().activeAgentId).toBe('agent-9');
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
    });

    it('settles against the gateway-real server shape', async () => {
      state().addAgent('Build Runner', 'tmux', 'localhost:build');
      ack(reqIdOf(0), GATEWAY_CREATED);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', 'agent-1762500000000-a1b2']);
      expect(state().activeAgentId).toBe('agent-1762500000000-a1b2');
    });

    it('a snapshot listing the agent before the ack leaves one agent and the pane; the ack then drops the pane', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = state().agents[1].id;
      snapshot([EXISTING, BUILD]);
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', pendingId, 'agent-77']);
      expect(state().pending[pendingId]).toBeDefined();
      ack(reqIdOf(0), BUILD);
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-77');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('the reverse order (ack, then snapshot) gives the same final roster', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      ack(reqIdOf(0), BUILD);
      await flush();
      snapshot([EXISTING, BUILD]);
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-77');
    });

    it('two identical creates are matched by reqId, even when the acks arrive in reverse', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      state().addAgent('Build', 'tmux', 'localhost:build');
      const [p1, p2] = state().agents.slice(1).map((a) => a.id);
      useAgentStore.setState((st) => ({
        agents: st.agents.map((a) => (a.id === p1 ? { ...a, layout: { isFloating: true, x: 1 } } : a)),
      }));
      const s1 = serverAgent({ id: 'srv-1', name: 'Build', targetHost: 'localhost:build' });
      const s2 = serverAgent({ id: 'srv-2', name: 'Build', targetHost: 'localhost:build' });
      ack(reqIdOf(1), s2);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', p1, 'srv-2']);
      ack(reqIdOf(0), s1);
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'srv-1', 'srv-2']);
      expect(s.agents[1].layout.x).toBe(1);
      expect(s.pending).toEqual({});
      expect(p2).toBeDefined();
    });

    it.each([
      ['BACKEND_DOWN', 'tmux server is not running'],
      ['CONFLICT', 'an agent with that name exists'],
      ['USAGE', 'name is required'],
    ])('an agent:error (%s) removes the pane, restores the previous active agent and names the code', async (code, text) => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      fail(reqIdOf(0), code, text, code === 'BACKEND_DOWN');
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-9');
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('create_failed');
      expect(s.rosterNotices[0].title).toContain('Build');
      expect(s.rosterNotices[0].message).toContain(code);
      expect(s.rosterNotices[0].message).toContain(text);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a rollback keeps the active agent the user moved to meanwhile', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      useAgentStore.setState({ agents: [EXISTING, serverAgent({ id: 'agent-10', name: 'Two' })].concat(state().agents.slice(1)) });
      useAgentStore.setState({ activeAgentId: 'agent-10' });
      fail(reqIdOf(0), 'USAGE');
      await flush();
      expect(state().activeAgentId).toBe('agent-10');
    });

    it('a timeout rolls back with the 10 s wording and leaves no timer', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-9');
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].message).toBe('The backend did not confirm within 10 s, so the pending pane was removed.');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a late ack after the timeout raises no notice and adds nothing', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);
      ack(reqIdOf(0), BUILD);
      fail(reqIdOf(0), 'INTERNAL');
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(state().rosterNotices).toHaveLength(1);
    });

    it('not connected keeps the synchronous notice and adds nothing', () => {
      send.mockReturnValue(false);
      state().addAgent('Build', 'tmux', 'localhost:build');
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.pending).toEqual({});
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].message).toBe('The backend is not connected, so the agent was not created.');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('cancelling a pending pane sends no frame and no notice; the later ack adds one ordinary agent without focus', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = state().agents[1].id;
      const createReqId = reqIdOf(0);
      send.mockClear();
      state().removeAgent(pendingId);
      expect(send).not.toHaveBeenCalled();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(state().rosterNotices).toEqual([]);
      useAgentStore.setState({ activeAgentId: 'agent-9' });

      ack(createReqId, BUILD);
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
      expect(s.pending).toEqual({});
      expect(s.activeAgentId).toBe('agent-9');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a cancelled create whose ack and snapshot both arrive yields exactly one agent', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      state().removeAgent(state().agents[1].id);
      snapshot([EXISTING, BUILD]);
      ack(reqIdOf(0), BUILD);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
    });

    it('a late error for a cancelled create adds no notice', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      state().removeAgent(state().agents[1].id);
      fail(reqIdOf(0), 'BACKEND_DOWN', 'down', true);
      await flush();
      expect(state().rosterNotices).toEqual([]);
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
    });
  });

  describe('kill and close', () => {
    const TWO = serverAgent({ id: 'agent-10', name: 'Two' });

    beforeEach(() => {
      useAgentStore.setState({ agents: [EXISTING, TWO], activeAgentId: 'agent-9' });
    });

    it('sends agent:kill with a reqId, forwards options only when true and never invents confirm', () => {
      state().removeAgent('agent-9');
      state().removeAgent('agent-10', { killSession: true });
      expect(frames()[0]).toEqual({ type: 'agent:kill', agentId: 'agent-9', reqId: expect.any(String) });
      expect(frames()[1]).toEqual({ type: 'agent:kill', agentId: 'agent-10', killSession: true, reqId: expect.any(String) });
      expect('confirm' in frames()[1]).toBe(false);
      expect(state().killing['agent-9']).toBeDefined();
    });

    it('an ack removes the agent, clears killing and moves the active id to a neighbour', async () => {
      state().removeAgent('agent-9');
      expect(state().agents).toHaveLength(2);
      ack(reqIdOf(0), undefined, 'kill');
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-10']);
      expect(s.killing).toEqual({});
      expect(s.activeAgentId).toBe('agent-10');
      expect(s.rosterNotices).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('removing the last agent leaves a null active id', async () => {
      useAgentStore.setState({ agents: [EXISTING], activeAgentId: 'agent-9' });
      state().removeAgent('agent-9');
      ack(reqIdOf(0), undefined, 'kill');
      await flush();
      expect(state().agents).toEqual([]);
      expect(state().activeAgentId).toBeNull();
    });

    it('closing a non-active agent keeps the active id', async () => {
      state().removeAgent('agent-10');
      ack(reqIdOf(0), undefined, 'kill');
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(state().activeAgentId).toBe('agent-9');
    });

    it('a second call while the first is in flight is ignored', () => {
      state().removeAgent('agent-9');
      state().removeAgent('agent-9');
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('a USAGE refusal (kill without confirm) surfaces at once with the code and message', async () => {
      state().removeAgent('agent-9', { killSession: true });
      fail(reqIdOf(0), 'USAGE', 'killSession needs confirm: true');
      await flush();
      const s = state();
      expect(s.killing).toEqual({});
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-10']);
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('kill_failed');
      expect(s.rosterNotices[0].title).toBe('Could not kill the tmux session of "Other"');
      expect(s.rosterNotices[0].message).toContain('USAGE');
      expect(s.rosterNotices[0].message).toContain('killSession needs confirm: true');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a timeout keeps the plain versus session wording', async () => {
      state().removeAgent('agent-9');
      state().removeAgent('agent-10', { killSession: true, confirm: true });
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);
      const n = state().rosterNotices;
      expect(n).toHaveLength(2);
      expect(n[0].message).toBe('The backend did not confirm within 10 s, so the agent is still listed.');
      expect(n[1].message).toBe(
        'The backend did not confirm within 10 s, so the session may still be running and the agent is still listed.',
      );
      expect(state().killing).toEqual({});
      expect(vi.getTimerCount()).toBe(0);
    });

    it('NOT_FOUND drops the agent locally without a notice', async () => {
      state().removeAgent('agent-9');
      fail(reqIdOf(0), 'NOT_FOUND', 'no such agent');
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-10']);
      expect(s.killing).toEqual({});
      expect(s.activeAgentId).toBe('agent-10');
      expect(s.rosterNotices).toEqual([]);
    });

    it('not connected keeps its synchronous notice', () => {
      send.mockReturnValue(false);
      state().removeAgent('agent-9', { killSession: true, confirm: true });
      expect(state().killing).toEqual({});
      expect(state().rosterNotices[0].message).toBe('The backend is not connected, so the session was left running.');
    });

    it('a snapshot that no longer lists the agent clears killing; the late ack changes nothing', async () => {
      state().removeAgent('agent-9');
      snapshot([TWO]);
      expect(state().killing).toEqual({});
      ack(reqIdOf(0), undefined, 'kill');
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-10']);
      expect(state().rosterNotices).toEqual([]);
    });
  });

  describe('updateAgent', () => {
    it('sends only the supplied keys with a reqId and applies the ack agent without touching layout', async () => {
      useAgentStore.setState({
        agents: [{ ...EXISTING, layout: { isFloating: true, x: 4, y: 5 } }],
      });
      const p = state().updateAgent('agent-9', { name: 'Renamed', tags: ['a'] });
      expect(frames()[0]).toEqual({
        type: 'agent:update',
        agentId: 'agent-9',
        name: 'Renamed',
        tags: ['a'],
        reqId: expect.any(String),
      });
      expect('group' in frames()[0]).toBe(false);
      // Nothing changes before the ack.
      expect(state().agents[0].name).toBe('Other');
      ack(reqIdOf(0), { ...EXISTING, name: 'Renamed', tags: ['a'], group: 'ops' }, 'update');
      expect(await p).toBe(true);
      expect(state().agents[0]).toMatchObject({
        name: 'Renamed',
        tags: ['a'],
        group: 'ops',
        layout: { isFloating: true, x: 4, y: 5 },
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('an error resolves false and pushes an update_failed notice with the typed reason', async () => {
      const p = state().updateAgent('agent-9', { group: 'ops' });
      fail(reqIdOf(0), 'FORBIDDEN', 'read only');
      expect(await p).toBe(false);
      const n = state().rosterNotices;
      expect(n).toHaveLength(1);
      expect(n[0].kind).toBe('update_failed');
      expect(n[0].message).toContain('FORBIDDEN');
      expect(state().agents[0].group).toBeUndefined();
    });

    it('a timeout resolves false with an update_failed notice', async () => {
      const p = state().updateAgent('agent-9', { name: 'X' });
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);
      expect(await p).toBe(false);
      expect(state().rosterNotices[0].kind).toBe('update_failed');
      expect(state().rosterNotices[0].message).toMatch(/10 s/);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('not connected resolves false with a notice', async () => {
      send.mockReturnValue(false);
      expect(await state().updateAgent('agent-9', { name: 'X' })).toBe(false);
      expect(state().rosterNotices[0].kind).toBe('update_failed');
    });

    it('a pending id, an unknown id and an empty patch resolve false without sending', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      const pendingId = state().agents[1].id;
      send.mockClear();
      expect(await state().updateAgent(pendingId, { name: 'X' })).toBe(false);
      expect(await state().updateAgent('nope', { name: 'X' })).toBe(false);
      expect(await state().updateAgent('agent-9', {})).toBe(false);
      expect(await state().updateAgent('agent-9', { name: undefined })).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('in Demo mode applies locally, sends nothing and resolves true', async () => {
      useConnectionStore.setState({ mode: 'demo' });
      expect(await state().updateAgent('agent-9', { name: 'Local', group: 'g' })).toBe(true);
      expect(send).not.toHaveBeenCalled();
      expect(state().agents[0]).toMatchObject({ name: 'Local', group: 'g' });
    });
  });

  describe('re-send after reconnect', () => {
    const resend = () => (agentSocket as any).requests.resendInFlight();

    it('re-sends the identical frame (same reqId) and the ack to it settles the original create', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      resend();
      expect(send).toHaveBeenCalledTimes(2);
      expect(frames()[1]).toEqual(frames()[0]);
      ack(reqIdOf(1), BUILD);
      await flush();
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('replay: the snapshot on reconnect already lists the agent, the replayed ack follows: one agent, no pane, no notice', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      useConnectionStore.setState({ state: 'reconnecting' });
      useConnectionStore.setState({ state: 'open' });
      resend();
      snapshot([EXISTING, BUILD]);
      ack(reqIdOf(1), BUILD);
      await flush();
      const s = state();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9', 'agent-77']);
      expect(s.pending).toEqual({});
      expect(s.rosterNotices).toEqual([]);
      expect(s.activeAgentId).toBe('agent-77');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops after three transmissions and then times out with the 10 s wording', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      resend();
      resend();
      resend();
      expect(send).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(ROSTER_REQUEST_TIMEOUT_MS);
      expect(state().rosterNotices).toHaveLength(1);
      expect(state().agents.map((a) => a.id)).toEqual(['agent-9']);
    });
  });

  describe('uncorrelated gateway errors and notice hygiene', () => {
    it('an agent:error without a reqId becomes one gateway_error notice "(CODE) text"', () => {
      fail(undefined, 'BACKEND_DOWN', 'tmux server is not running', true);
      const n = state().rosterNotices;
      expect(n).toHaveLength(1);
      expect(n[0].kind).toBe('gateway_error');
      expect(n[0].title).toBe('The backend reported an error');
      expect(n[0].message).toBe('(BACKEND_DOWN) tmux server is not running');
    });

    it('an agent:error with an unknown reqId also becomes a notice', () => {
      fail('never-sent', 'INTERNAL', 'oops');
      expect(state().rosterNotices.map((x) => x.message)).toEqual(['(INTERNAL) oops']);
    });

    it('strips control characters, collapses whitespace and caps the text at 200 characters', () => {
      fail(undefined, 'INTERNAL', 'a\u0000b\u001b[31m  c\n\n\td\u0085e\u007f' + 'x'.repeat(1000));
      const m = state().rosterNotices[0].message;
      expect(m.startsWith('(INTERNAL) ab[31m c de')).toBe(true);
      // eslint-disable-next-line no-control-regex
      expect(/[\u0000-\u001f\u007f-\u009f]/.test(m)).toBe(false);
      expect(m.length).toBeLessThanOrEqual(200);
    });

    it('truncates a 1024-character message', () => {
      fail(undefined, 'INTERNAL', 'y'.repeat(1024));
      expect(state().rosterNotices[0].message.length).toBeLessThanOrEqual(200);
    });

    it('does not repeat an identical consecutive gateway_error, but pushes a different one', () => {
      fail(undefined, 'INTERNAL', 'same');
      fail(undefined, 'INTERNAL', 'same');
      expect(state().rosterNotices).toHaveLength(1);
      fail(undefined, 'INTERNAL', 'different');
      fail(undefined, 'INTERNAL', 'same');
      expect(state().rosterNotices.map((x) => x.message)).toEqual([
        '(INTERNAL) same',
        '(INTERNAL) different',
        '(INTERNAL) same',
      ]);
    });

    it('caps the notice list at 20, dropping the oldest', () => {
      for (let i = 0; i < 25; i++) fail(undefined, 'INTERNAL', `error ${i}`);
      const n = state().rosterNotices;
      expect(n).toHaveLength(20);
      expect(n[0].message).toBe('(INTERNAL) error 5');
      expect(n[19].message).toBe('(INTERNAL) error 24');
    });

    it('caps notices of every kind, not only gateway errors', () => {
      send.mockReturnValue(false);
      for (let i = 0; i < 30; i++) state().addAgent(`A${i}`, 'tmux', 'h:a');
      expect(state().rosterNotices).toHaveLength(20);
    });

    it('a stray agent:ack for an unknown reqId changes nothing and raises no notice', async () => {
      const before = state().agents;
      ack('unknown-req', BUILD);
      await flush();
      expect(state().agents).toBe(before);
      expect(state().rosterNotices).toEqual([]);
    });

    it('an agent:error for a request settled earlier raises no notice', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      const id = reqIdOf(0);
      ack(id, BUILD);
      await flush();
      fail(id, 'INTERNAL', 'late');
      await flush();
      expect(state().rosterNotices).toEqual([]);
    });

    it('typed copy for create, kill and update failures names the code and a sanitized text', async () => {
      state().addAgent('Build', 'tmux', 'localhost:build');
      fail(reqIdOf(0), 'CONFLICT', 'name\u0000 is\n taken');
      state().removeAgent('agent-9');
      fail(reqIdOf(1), 'FORBIDDEN', 'read\tonly');
      const p = state().updateAgent('agent-9', { name: 'Z' });
      fail(reqIdOf(2), 'RATE_LIMITED', 'slow down', true);
      await p;
      await flush();
      expect(state().rosterNotices.map((x) => x.message)).toEqual([
        'The backend rejected the request (CONFLICT): name is taken',
        'The backend rejected the request (FORBIDDEN): read only',
        'The backend rejected the request (RATE_LIMITED): slow down',
      ]);
    });

    it('malformed frames are dropped without throwing or a notice, warning by count only', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => {
        notify({ type: 'agent:error', code: 'INTERNAL', message: 42, retryable: false });
        notify({ type: 'agent:ack', op: 'create', ok: true });
        notify({ type: 'agent:error', code: 'SECRET-CODE', message: 'secret <b>', retryable: false });
      }).not.toThrow();
      expect(state().rosterNotices).toEqual([]);
      expect(warn.mock.calls.length).toBeLessThanOrEqual(3);
      const logged = warn.mock.calls.map((c) => c.join(' ')).join(' ');
      expect(logged).not.toContain('secret');
      expect(logged).not.toContain('SECRET-CODE');
    });

    it('renders a hostile gateway message as plain text', async () => {
      const { render, screen, cleanup } = await import('@testing-library/react');
      const React = await import('react');
      const { NotificationToastManager } = await import('../../components/layout/NotificationToastManager');
      const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
      fail(undefined, 'INTERNAL', hostile);
      const { container } = render(React.createElement(NotificationToastManager));
      const notice = screen.getByTestId('roster-notice-gateway_error');
      expect(notice.textContent).toContain('<img src=x onerror=alert(1)>');
      expect(container.querySelector('img')).toBeNull();
      expect(document.querySelector('img')).toBeNull();
      expect(document.querySelector('script')).toBeNull();
      cleanup();
    });
  });
});
