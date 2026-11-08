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

const TARGET = serverAgent({ id: 'agent-1', name: 'Build Box', targetHost: 'localhost:qa_a' });
const OTHER = serverAgent({ id: 'agent-9', name: 'Other', targetHost: 'localhost:o' });
const OPTS = { killSession: true, confirm: true } as const;

describe('removeAgent with session-kill options', () => {
  let send: MockInstance<[WSMessageClient], boolean>;

  beforeEach(() => {
    vi.useFakeTimers();
    useConnectionStore.setState({ mode: 'live' });
    useAgentStore.setState({
      agents: [TARGET, OTHER],
      activeAgentId: 'agent-1',
      pending: {},
      killing: {},
      rosterNotices: [],
    });
    send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useConnectionStore.setState({ mode: 'demo' });
  });

  describe('forwarding', () => {
    it('sends the plain message when no option is given', () => {
      useAgentStore.getState().removeAgent('agent-1');
      expect(send).toHaveBeenCalledWith({ type: 'agent:kill', agentId: 'agent-1' });
      expect(Object.keys(send.mock.calls[0][0]).sort()).toEqual(['agentId', 'type']);
    });

    it('sends the plain message when both options are false or empty', () => {
      useAgentStore.getState().removeAgent('agent-1', { killSession: false, confirm: false });
      expect(Object.keys(send.mock.calls[0][0]).sort()).toEqual(['agentId', 'type']);
    });

    it('sends both when both are true', () => {
      useAgentStore.getState().removeAgent('agent-1', { ...OPTS });
      expect(send).toHaveBeenCalledWith({
        type: 'agent:kill',
        agentId: 'agent-1',
        killSession: true,
        confirm: true,
      });
    });

    it('does not fabricate confirm when only killSession is given', () => {
      useAgentStore.getState().removeAgent('agent-1', { killSession: true });
      const msg = send.mock.calls[0][0];
      expect(msg).toEqual({ type: 'agent:kill', agentId: 'agent-1', killSession: true });
      expect('confirm' in msg).toBe(false);
    });

    it('forwards confirm alone without adding killSession', () => {
      useAgentStore.getState().removeAgent('agent-1', { confirm: true });
      const msg = send.mock.calls[0][0];
      expect(msg).toEqual({ type: 'agent:kill', agentId: 'agent-1', confirm: true });
      expect('killSession' in msg).toBe(false);
    });
  });

  describe('failure notices', () => {
    it('not delivered: session-kill notice, no killing entry, no timer', () => {
      send.mockReturnValue(false);
      useAgentStore.getState().removeAgent('agent-1', { ...OPTS });
      const s = useAgentStore.getState();
      expect(s.killing).toEqual({});
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('kill_failed');
      expect(s.rosterNotices[0].title).toBe('Could not kill the tmux session of "Build Box"');
      expect(s.rosterNotices[0].message).toBe('The backend is not connected, so the session was left running.');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('unconfirmed after 10 s: clears killing and pushes the session-kill notice', () => {
      useAgentStore.getState().removeAgent('agent-1', { ...OPTS });
      expect(useAgentStore.getState().killing).toHaveProperty('agent-1');
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(ROSTER_REQUEST_TIMEOUT_MS);
      const s = useAgentStore.getState();
      expect(s.killing).toEqual({});
      expect(s.rosterNotices).toHaveLength(1);
      expect(s.rosterNotices[0].kind).toBe('kill_failed');
      expect(s.rosterNotices[0].title).toBe('Could not kill the tmux session of "Build Box"');
      expect(s.rosterNotices[0].message).toBe(
        'The backend did not confirm within 10 s, so the session may still be running and the agent is still listed.',
      );
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a plain close keeps its original notice texts', () => {
      send.mockReturnValue(false);
      useAgentStore.getState().removeAgent('agent-1');
      let n = useAgentStore.getState().rosterNotices;
      expect(n[0].title).toBe('Could not close "Build Box"');
      expect(n[0].message).toBe('The backend is not connected, so the agent was left running.');

      send.mockReturnValue(true);
      useAgentStore.setState({ rosterNotices: [] });
      useAgentStore.getState().removeAgent('agent-1');
      vi.advanceTimersByTime(ROSTER_REQUEST_TIMEOUT_MS);
      n = useAgentStore.getState().rosterNotices;
      expect(n[0].title).toBe('Could not close "Build Box"');
      expect(n[0].message).toBe('The backend did not confirm within 10 s, so the agent is still listed.');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('confirmation by snapshot', () => {
    it('a snapshot without the agent clears killing and the timer', () => {
      useAgentStore.getState().removeAgent('agent-1', { ...OPTS });
      expect(vi.getTimerCount()).toBe(1);
      notify({ type: 'agent:init_list', agents: [OTHER] });
      const s = useAgentStore.getState();
      expect(s.agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(s.killing).toEqual({});
      expect(s.rosterNotices).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('guards', () => {
    it('a second session kill while one is in flight sends nothing', () => {
      useAgentStore.getState().removeAgent('agent-1', { ...OPTS });
      useAgentStore.getState().removeAgent('agent-1', { ...OPTS });
      expect(send).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('a pending id is cancelled locally and nothing is sent', () => {
      useAgentStore.getState().addAgent('Fresh', 'tmux', 'localhost:fresh');
      const pendingId = Object.keys(useAgentStore.getState().pending)[0];
      send.mockClear();
      useAgentStore.getState().removeAgent(pendingId, { ...OPTS });
      expect(send).not.toHaveBeenCalled();
      expect(useAgentStore.getState().pending).toEqual({});
      expect(useAgentStore.getState().agents.some((a) => a.id === pendingId)).toBe(false);
      // The cancelled create stays in flight in the request layer (its ack may still add the agent).
      expect(vi.getTimerCount()).toBe(1);
    });

    it('an unknown id does nothing', () => {
      useAgentStore.getState().removeAgent('nope', { ...OPTS });
      expect(send).not.toHaveBeenCalled();
      expect(useAgentStore.getState().killing).toEqual({});
      expect(useAgentStore.getState().rosterNotices).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('Demo mode', () => {
    it('removes the agent locally and sends nothing', () => {
      useConnectionStore.setState({ mode: 'demo' });
      useAgentStore.getState().removeAgent('agent-1', { ...OPTS });
      expect(send).not.toHaveBeenCalled();
      expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['agent-9']);
      expect(useAgentStore.getState().activeAgentId).toBe('agent-9');
    });
  });
});
