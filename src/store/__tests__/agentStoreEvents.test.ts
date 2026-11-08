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

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('agent:removed', () => {
  it('removes a known agent and clears its killing flag', () => {
    useAgentStore.setState({ agents: [A, B], activeAgentId: B.id, killing: { [A.id]: 1 } });
    notify({ type: 'agent:removed', agentId: A.id, reason: 'killed' });
    const s = useAgentStore.getState();
    expect(ids()).toEqual([B.id]);
    expect(s.killing).toEqual({});
    expect(s.activeAgentId).toBe(B.id);
  });

  it('activates the first remaining agent when the active one was removed, or null when none remain', () => {
    useAgentStore.setState({ agents: [A, B, C], activeAgentId: B.id });
    notify({ type: 'agent:removed', agentId: B.id });
    expect(useAgentStore.getState().activeAgentId).toBe(A.id);
    notify({ type: 'agent:removed', agentId: A.id });
    notify({ type: 'agent:removed', agentId: C.id });
    expect(useAgentStore.getState().activeAgentId).toBeNull();
    expect(ids()).toEqual([]);
  });

  it('ignores an unknown id, a pending pane id, and Demo mode', () => {
    const pendingPane = serverAgent({ id: 'pending-3', name: 'New' });
    const pending = { 'pending-3': { name: 'New', mode: 'tmux' as const, targetHost: 'localhost:w', startedAt: 1, reqId: 'r' } };
    useAgentStore.setState({ agents: [A, pendingPane], pending, activeAgentId: A.id });
    notify({ type: 'agent:removed', agentId: 'nobody' });
    notify({ type: 'agent:removed', agentId: 'pending-3' });
    expect(ids()).toEqual([A.id, 'pending-3']);
    expect(useAgentStore.getState().pending).toEqual(pending);
    useConnectionStore.setState({ mode: 'demo' });
    notify({ type: 'agent:removed', agentId: A.id });
    expect(ids()).toEqual([A.id, 'pending-3']);
  });

  it('applying it twice equals applying it once', () => {
    useAgentStore.setState({ agents: [A, B], activeAgentId: A.id });
    notify({ type: 'agent:removed', agentId: A.id });
    const once = useAgentStore.getState().agents;
    notify({ type: 'agent:removed', agentId: A.id });
    expect(useAgentStore.getState().agents).toEqual(once);
    expect(useAgentStore.getState().activeAgentId).toBe(B.id);
  });

  it('drops an invalid event (empty agentId) with at most one payload-free warning each', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useAgentStore.setState({ agents: [A], activeAgentId: A.id });
    notify({ type: 'agent:removed', agentId: '' });
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    notify({ type: 'agent:removed', agentId: 12345 });
    expect(ids()).toEqual([A.id]);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('12345');
  });

  it('a kill in flight is cleared by the event, and its later ack finds nothing to do', async () => {
    const send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
    useAgentStore.setState({ agents: [A, B], activeAgentId: A.id });
    useAgentStore.getState().removeAgent(A.id);
    expect(useAgentStore.getState().killing[A.id]).toBeTypeOf('number');
    const reqId = (send.mock.calls[0][0] as any).reqId as string;
    notify({ type: 'agent:removed', agentId: A.id, reason: 'killed' });
    expect(useAgentStore.getState().killing).toEqual({});
    expect(ids()).toEqual([B.id]);
    notify({ type: 'agent:ack', reqId, op: 'kill', ok: true });
    await flush();
    expect(ids()).toEqual([B.id]);
    expect(useAgentStore.getState().killing).toEqual({});
    expect(useAgentStore.getState().rosterNotices).toEqual([]);
  });
});

describe('agent:updated', () => {
  it('merges only the supplied keys and leaves status, layout and unreadOutput alone', () => {
    const local: Agent = {
      ...A,
      status: 'thinking',
      unreadOutput: true,
      layout: { isFloating: true, x: 1, y: 2, width: 3, height: 4 },
      tags: ['old'],
      group: 'g1',
    };
    useAgentStore.setState({ agents: [local, B], activeAgentId: A.id });
    notify({ type: 'agent:updated', agentId: A.id, patch: { name: 'Renamed', tags: ['x', 'y'] } });
    const got = useAgentStore.getState().agents[0];
    expect(got.name).toBe('Renamed');
    expect(got.tags).toEqual(['x', 'y']);
    expect(got.group).toBe('g1');
    expect(got.status).toBe('thinking');
    expect(got.unreadOutput).toBe(true);
    expect(got.layout).toEqual(local.layout);
    expect(useAgentStore.getState().agents[1]).toEqual(B);
  });

  it('replaces tags as a whole, including with an empty list', () => {
    useAgentStore.setState({ agents: [{ ...A, tags: ['a', 'b'] }], activeAgentId: A.id });
    notify({ type: 'agent:updated', agentId: A.id, patch: { tags: [] } });
    expect(useAgentStore.getState().agents[0].tags).toEqual([]);
  });

  it('merges group, meta and capabilities', () => {
    useAgentStore.setState({ agents: [A], activeAgentId: A.id });
    notify({
      type: 'agent:updated',
      agentId: A.id,
      patch: { group: 'ops', meta: { k: 'v' }, capabilities: ['input', 'kill'] },
    });
    const got = useAgentStore.getState().agents[0];
    expect(got.group).toBe('ops');
    expect(got.meta).toEqual({ k: 'v' });
    expect(got.capabilities).toEqual(['input', 'kill']);
  });

  it('changes nothing for an unknown id, an empty patch or Demo mode', () => {
    useAgentStore.setState({ agents: [A], activeAgentId: A.id });
    const before = useAgentStore.getState().agents;
    notify({ type: 'agent:updated', agentId: 'nobody', patch: { name: 'x' } });
    notify({ type: 'agent:updated', agentId: A.id, patch: {} });
    expect(useAgentStore.getState().agents).toBe(before);
    useConnectionStore.setState({ mode: 'demo' });
    notify({ type: 'agent:updated', agentId: A.id, patch: { name: 'x' } });
    expect(useAgentStore.getState().agents).toBe(before);
  });

  it('does not update a pending pane even if the ids collide', () => {
    const pendingPane = serverAgent({ id: 'pending-4', name: 'New' });
    const pending = { 'pending-4': { name: 'New', mode: 'tmux' as const, targetHost: 'localhost:w', startedAt: 1, reqId: 'r' } };
    useAgentStore.setState({ agents: [pendingPane], pending, activeAgentId: 'pending-4' });
    notify({ type: 'agent:updated', agentId: 'pending-4', patch: { name: 'Hijack' } });
    expect(useAgentStore.getState().agents[0].name).toBe('New');
  });

  it('drops an invalid patch (tags of the wrong type) with at most one payload-free warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useAgentStore.setState({ agents: [A], activeAgentId: A.id });
    notify({ type: 'agent:updated', agentId: A.id, patch: { tags: 'SECRET-TAGS' } });
    expect(useAgentStore.getState().agents[0].name).toBe('Alpha');
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-TAGS');
  });
});

type Step =
  | { t: 'added'; agent: Agent }
  | { t: 'removed'; id: string }
  | { t: 'updated'; id: string; patch: Record<string, unknown> }
  | { t: 'snapshot'; agents: Agent[] }
  | { t: 'create'; name: string }
  | { t: 'ack'; of: number; agent: Agent };

describe('convergence of events, acks and snapshots', () => {
  function run(steps: Step[], initial: Agent[] = []) {
    const send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
    useAgentStore.setState({ agents: initial, activeAgentId: initial[0]?.id ?? null });
    const reqIds: string[] = [];
    steps.forEach((step, i) => {
      switch (step.t) {
        case 'added':
          notify({ type: 'agent:added', agent: step.agent });
          break;
        case 'removed':
          notify({ type: 'agent:removed', agentId: step.id, reason: 'killed' });
          break;
        case 'updated':
          notify({ type: 'agent:updated', agentId: step.id, patch: step.patch });
          break;
        case 'snapshot':
          notify({ type: 'agent:init_list', agents: step.agents });
          break;
        case 'create':
          useAgentStore.getState().addAgent(step.name, 'tmux', 'localhost:x');
          reqIds.push((send.mock.calls[send.mock.calls.length - 1][0] as any).reqId);
          break;
        case 'ack':
          notify({ type: 'agent:ack', reqId: reqIds[step.of], op: 'create', ok: true, agent: step.agent });
          break;
      }
      const seen = new Set<string>();
      for (const a of useAgentStore.getState().agents) {
        if (seen.has(a.id)) throw new Error(`step ${i} (${step.t}): duplicate pane id ${a.id}`);
        seen.add(a.id);
      }
    });
  }

  const finalState = async (steps: Step[]) => {
    run(steps);
    await flush();
    const s = useAgentStore.getState();
    return { ids: s.agents.map((a) => a.id), pending: Object.keys(s.pending), s };
  };

  const table: Array<{ name: string; steps: Step[]; expected: string[] }> = [
    {
      name: 'added then a snapshot containing it',
      steps: [{ t: 'added', agent: A }, { t: 'snapshot', agents: [A, B] }],
      expected: [A.id, B.id],
    },
    {
      name: 'a snapshot then added of the same id',
      steps: [{ t: 'snapshot', agents: [A] }, { t: 'added', agent: A }],
      expected: [A.id],
    },
    {
      name: 'removed then a stale snapshot that still lists the agent (the snapshot wins)',
      steps: [{ t: 'snapshot', agents: [A, B] }, { t: 'removed', id: A.id }, { t: 'snapshot', agents: [A, B] }],
      // The snapshot re-lists A; known panes keep their order and the returning agent is appended.
      expected: [B.id, A.id],
    },
    {
      name: 'removed, then a later snapshot that omits it: no resurrection',
      steps: [{ t: 'added', agent: A }, { t: 'removed', id: A.id }, { t: 'snapshot', agents: [B] }],
      expected: [B.id],
    },
    {
      name: 'added then the ack of the pending create',
      steps: [{ t: 'create', name: 'Alpha' }, { t: 'added', agent: A }, { t: 'ack', of: 0, agent: A }],
      expected: [A.id],
    },
    {
      name: 'the ack of the pending create then added',
      steps: [{ t: 'create', name: 'Alpha' }, { t: 'ack', of: 0, agent: A }, { t: 'added', agent: A }],
      expected: [A.id],
    },
    {
      name: 'a snapshot between the create and its ack',
      steps: [{ t: 'create', name: 'Alpha' }, { t: 'snapshot', agents: [A] }, { t: 'ack', of: 0, agent: A }],
      expected: [A.id],
    },
    {
      name: 'added, removed, added again',
      steps: [{ t: 'added', agent: A }, { t: 'removed', id: A.id }, { t: 'added', agent: A }],
      expected: [A.id],
    },
    {
      name: 'updated before added is ignored, then added carries the server fields',
      steps: [{ t: 'updated', id: A.id, patch: { name: 'Early' } }, { t: 'added', agent: A }],
      expected: [A.id],
    },
    {
      name: 'removed of an unknown agent does not block a later added',
      steps: [{ t: 'removed', id: B.id }, { t: 'added', agent: B }, { t: 'added', agent: C }],
      expected: [B.id, C.id],
    },
  ];

  it('the table covers both orders of ack versus added', () => {
    const names = table.map((r) => r.name);
    expect(names).toContain('added then the ack of the pending create');
    expect(names).toContain('the ack of the pending create then added');
    expect(table.length).toBeGreaterThanOrEqual(7);
  });

  for (const row of table) {
    it(row.name, async () => {
      const r = await finalState(row.steps);
      expect(r.ids).toEqual(row.expected);
      expect(r.pending).toEqual([]);
      expect(r.ids.some((id) => id.startsWith('pending-'))).toBe(false);
    });

    if (!row.steps.some((s) => s.t === 'create' || s.t === 'ack')) {
      it(`${row.name}: the same sequence applied twice from empty ends in the same set of agents`, async () => {
        const once = await finalState(row.steps);
        reset();
        vi.restoreAllMocks();
        const twice = await finalState([...row.steps, ...row.steps]);
        expect([...twice.ids].sort()).toEqual([...once.ids].sort());
      });
    }
  }

  it('a removed agent is not resurrected by a later update, and the snapshot is the truth', async () => {
    const r = await finalState([
      { t: 'snapshot', agents: [A, B] },
      { t: 'removed', id: B.id },
      { t: 'updated', id: B.id, patch: { name: 'ghost' } },
    ]);
    expect(r.ids).toEqual([A.id]);
  });

  it('an update after the add is applied', async () => {
    const r = await finalState([
      { t: 'added', agent: A },
      { t: 'updated', id: A.id, patch: { name: 'Renamed' } },
    ]);
    expect(r.s.agents[0].name).toBe('Renamed');
  });

  it('reconnect: the connect snapshot replaces what events built, keeps pending panes, falls back for the active id', async () => {
    run([
      { t: 'added', agent: A },
      { t: 'added', agent: B },
      { t: 'added', agent: C },
      { t: 'create', name: 'Pending one' },
    ]);
    const pendingId = Object.keys(useAgentStore.getState().pending)[0];
    useAgentStore.setState({ activeAgentId: B.id });
    const D = serverAgent({ id: 'agent-d', name: 'Delta', targetHost: 'localhost:delta' });
    notify({ type: 'agent:init_list', agents: [C, D] });
    await flush();
    const s = useAgentStore.getState();
    const got = s.agents.map((a) => a.id);
    expect(got).toEqual(expect.arrayContaining([C.id, D.id, pendingId]));
    expect(got).not.toContain(A.id);
    expect(got).not.toContain(B.id);
    expect(Object.keys(s.pending)).toEqual([pendingId]);
    expect(s.activeAgentId).not.toBe(B.id);
    expect(got).toContain(s.activeAgentId);
  });

  it('reconnect keeps the active id when that agent is still in the snapshot', () => {
    run([{ t: 'added', agent: A }, { t: 'added', agent: B }]);
    useAgentStore.setState({ activeAgentId: B.id });
    notify({ type: 'agent:init_list', agents: [B, A] });
    expect(useAgentStore.getState().activeAgentId).toBe(B.id);
  });

  it('property: every permutation of added/updated/removed events for one agent ends with at most one pane', async () => {
    const evs: Step[] = [
      { t: 'added', agent: A },
      { t: 'updated', id: A.id, patch: { name: 'U' } },
      { t: 'removed', id: A.id },
      { t: 'added', agent: A },
    ];
    const perms = (xs: Step[]): Step[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const all = perms(evs);
    expect(all).toHaveLength(24);
    for (const p of all) {
      reset();
      vi.restoreAllMocks();
      const r = await finalState(p);
      expect(r.ids.filter((id) => id === A.id).length).toBeLessThanOrEqual(1);
    }
  });
});
