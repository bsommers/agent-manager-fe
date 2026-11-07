import { describe, it, expect } from 'vitest';
import { reconcileSnapshot, type PendingMap } from '../rosterReconcile';
import type { Agent } from '../../types/agent';

function ag(id: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    name: 'W',
    mode: 'tmux',
    targetHost: 'h:w',
    status: 'running',
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: 1,
    lastActivity: 2,
    ...over,
  };
}

const req = (name = 'W', targetHost = 'h:w', mode: Agent['mode'] = 'tmux') => ({
  name,
  mode,
  targetHost,
  startedAt: 1,
});

describe('reconcileSnapshot', () => {
  it('replaces by id and takes the server fields', () => {
    const r = reconcileSnapshot([ag('a', { status: 'idle' })], {}, [ag('a', { status: 'thinking' })]);
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0].status).toBe('thinking');
  });

  it('preserves layout and unreadOutput of surviving agents', () => {
    const layout = { isFloating: true, x: 1, y: 2, width: 3, height: 4, zIndex: 5 };
    const r = reconcileSnapshot([ag('a', { layout, unreadOutput: true })], {}, [ag('a')]);
    expect(r.agents[0].layout).toEqual(layout);
    expect(r.agents[0].unreadOutput).toBe(true);
  });

  it('reports dropped agents in removedIds', () => {
    const r = reconcileSnapshot([ag('a'), ag('b')], {}, [ag('b')]);
    expect(r.agents.map((a) => a.id)).toEqual(['b']);
    expect(r.removedIds).toEqual(['a']);
  });

  it('claims pending creates in FIFO order for identical keys', () => {
    const pending: PendingMap = { 'pending-1': req(), 'pending-2': req() };
    const local = [
      ag('pending-1', { layout: { isFloating: true, x: 1 } }),
      ag('pending-2', { layout: { isFloating: true, x: 2 } }),
    ];
    const r = reconcileSnapshot(local, pending, [ag('s1'), ag('s2')]);
    expect(r.claimed).toEqual({ 'pending-1': 's1', 'pending-2': 's2' });
    expect(r.agents.map((a) => a.id)).toEqual(['s1', 's2']);
    expect(r.agents[0].layout.x).toBe(1);
    expect(r.agents[1].layout.x).toBe(2);
    expect(r.pending).toEqual({});
  });

  it('never claims an agent that was already in the roster', () => {
    const local = [ag('existing'), ag('pending-1')];
    const r = reconcileSnapshot(local, { 'pending-1': req() }, [ag('existing')]);
    expect(r.claimed).toEqual({});
    expect(r.agents.map((a) => a.id)).toEqual(['existing', 'pending-1']);
    expect(Object.keys(r.pending)).toEqual(['pending-1']);
  });

  it('claims the fresh agent, not the existing one, when both match the key', () => {
    const local = [ag('existing'), ag('pending-1')];
    const r = reconcileSnapshot(local, { 'pending-1': req() }, [ag('existing'), ag('fresh')]);
    expect(r.claimed).toEqual({ 'pending-1': 'fresh' });
    expect(r.agents.map((a) => a.id)).toEqual(['existing', 'fresh']);
  });

  it('keeps unmatched pending and appends unmatched fresh agents in snapshot order', () => {
    const local = [ag('pending-1', { name: 'Mine', targetHost: 'h:mine' })];
    const r = reconcileSnapshot(local, { 'pending-1': req('Mine', 'h:mine') }, [
      ag('z1', { name: 'Z1' }),
      ag('z2', { name: 'Z2' }),
    ]);
    expect(r.agents.map((a) => a.id)).toEqual(['pending-1', 'z1', 'z2']);
    expect(r.claimed).toEqual({});
  });

  it('collapses duplicate snapshot ids to the first', () => {
    const r = reconcileSnapshot([], {}, [ag('a', { name: 'first' }), ag('a', { name: 'second' })]);
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0].name).toBe('first');
  });

  it('does not mutate its inputs', () => {
    const local = [ag('a'), ag('pending-1')];
    const pending: PendingMap = { 'pending-1': req() };
    const snap = [ag('a', { status: 'idle' }), ag('s1')];
    const frozen = JSON.stringify({ local, pending, snap });
    Object.freeze(local);
    Object.freeze(pending);
    Object.freeze(snap);
    reconcileSnapshot(local, pending, snap);
    expect(JSON.stringify({ local, pending, snap })).toBe(frozen);
  });

  it('is idempotent when applied twice', () => {
    const local = [ag('a'), ag('pending-1')];
    const pending: PendingMap = { 'pending-1': req() };
    const snap = [ag('a'), ag('s1')];
    const once = reconcileSnapshot(local, pending, snap);
    const twice = reconcileSnapshot(once.agents, once.pending, snap);
    expect(twice.agents).toEqual(once.agents);
    expect(twice.pending).toEqual({});
    expect(twice.removedIds).toEqual([]);
  });
});
