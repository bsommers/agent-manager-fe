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

  it('does not claim pending panes by name, mode and targetHost: the pane stays, the snapshot agent is appended', () => {
    const pending: PendingMap = { 'pending-1': req(), 'pending-2': req() };
    const local = [
      ag('pending-1', { layout: { isFloating: true, x: 1 } }),
      ag('pending-2', { layout: { isFloating: true, x: 2 } }),
    ];
    const r = reconcileSnapshot(local, pending, [ag('s1'), ag('s2')]);
    expect(r.agents.map((a) => a.id)).toEqual(['pending-1', 'pending-2', 's1', 's2']);
    expect(r.agents[0].layout.x).toBe(1);
    expect(r.agents[1].layout.x).toBe(2);
    expect(Object.keys(r.pending)).toEqual(['pending-1', 'pending-2']);
    expect(r.pending['pending-1']).toBe(pending['pending-1']);
    expect('claimed' in r).toBe(false);
  });

  it('a snapshot agent equal to the pending request leaves the pane in place (same index)', () => {
    const local = [ag('existing'), ag('pending-1'), ag('other', { name: 'O' })];
    const r = reconcileSnapshot(local, { 'pending-1': req() }, [ag('existing'), ag('fresh'), ag('other', { name: 'O' })]);
    expect(r.agents.map((a) => a.id)).toEqual(['existing', 'pending-1', 'other', 'fresh']);
    expect(Object.keys(r.pending)).toEqual(['pending-1']);
    expect(r.removedIds).toEqual([]);
  });

  it('keeps pending panes and appends fresh agents in snapshot order', () => {
    const local = [ag('pending-1', { name: 'Mine', targetHost: 'h:mine' })];
    const r = reconcileSnapshot(local, { 'pending-1': req('Mine', 'h:mine') }, [
      ag('z1', { name: 'Z1' }),
      ag('z2', { name: 'Z2' }),
    ]);
    expect(r.agents.map((a) => a.id)).toEqual(['pending-1', 'z1', 'z2']);
  });

  it('never lists a pending pane in removedIds', () => {
    const r = reconcileSnapshot([ag('pending-1')], { 'pending-1': req() }, []);
    expect(r.agents.map((a) => a.id)).toEqual(['pending-1']);
    expect(r.removedIds).toEqual([]);
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
    expect(twice.pending).toEqual(once.pending);
    expect(twice.removedIds).toEqual([]);
  });
});
