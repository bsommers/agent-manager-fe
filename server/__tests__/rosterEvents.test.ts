// Roster announcements over a real WebSocket with several clients (plan 06-04): a create is
// announced as agent:added, a close or session kill as agent:removed, a rename as agent:updated.
// The full agent:init_list snapshot is sent to a connection on connect only. tmux is mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

interface CapturedDriver {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}

const state = vi.hoisted(() => ({ drivers: [] as unknown[], failNext: false }));

vi.mock('../src/services/TmuxDiscovery.js', () => ({
  discoverTmuxSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/TmuxDriver.js', () => ({
  TmuxDriver: vi.fn().mockImplementation(function (
    _session: string,
    _cols: number,
    _rows: number,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ) {
    if (state.failNext) {
      state.failNext = false;
      throw new Error('tmux start failed');
    }
    const driver = { write: vi.fn(), resize: vi.fn(), close: vi.fn(), onData, onExit };
    state.drivers.push(driver);
    return driver;
  }),
}));

vi.mock('../src/services/tmuxKill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/tmuxKill.js')>();
  return { ...actual, killTmuxSession: vi.fn().mockResolvedValue('killed') };
});

import { bootstrap } from '../src/index.js';
import { killTmuxSession } from '../src/services/tmuxKill.js';
import { parseServerMessage } from '@agent-manager/protocol';
import { WebSocket } from 'ws';

type Handle = Awaited<ReturnType<typeof bootstrap>>;
type Frame = { type: string; [key: string]: any };
interface Client {
  ws: WebSocket;
  frames: Frame[];
}

const capturedDrivers = () => state.drivers as CapturedDriver[];
const killMock = killTmuxSession as unknown as ReturnType<typeof vi.fn>;

let handle: Handle;
let port: number;
const clients: Client[] = [];

async function connect(): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const client: Client = { ws, frames: [] };
  ws.on('message', (raw) => client.frames.push(JSON.parse(raw.toString())));
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  await vi.waitFor(() => expect(client.frames.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
  return client;
}

const send = (c: Client, msg: object) => c.ws.send(JSON.stringify(msg));
const ofType = (c: Client, from: number, type: string) => c.frames.slice(from).filter((f) => f.type === type);

let pingSeq = 5000;
/** The gateway answers one socket's frames in order: a pong proves earlier frames arrived. */
async function pong(...cs: Client[]): Promise<void> {
  for (const c of cs) {
    const t = ++pingSeq;
    send(c, { type: 'ping', t });
    await vi.waitFor(() => expect(c.frames.some((f) => f.type === 'pong' && f.t === t)).toBe(true), {
      timeout: 2000,
    });
  }
}

/** Applies announcement frames to a list, as a client would. */
function reduce(list: any[], frames: Frame[]): any[] {
  let out = list;
  for (const f of frames) {
    if (f.type === 'agent:init_list') out = f.agents.map((a: any) => ({ ...a }));
    else if (f.type === 'agent:added') out = [...out.filter((a) => a.id !== f.agent.id), { ...f.agent }];
    else if (f.type === 'agent:removed') out = out.filter((a) => a.id !== f.agentId);
    else if (f.type === 'agent:updated') {
      out = out.map((a) => (a.id === f.agentId ? { ...a, ...f.patch } : a));
    }
  }
  return out;
}

/** The roster-relevant fields, ignoring volatile timestamps. */
const view = (list: any[]) =>
  list.map((a) => ({ id: a.id, name: a.name, status: a.status, tags: a.tags }));

beforeEach(async () => {
  state.drivers.length = 0;
  state.failNext = false;
  killMock.mockClear();
  handle = await bootstrap(0, '127.0.0.1');
  port = (handle.server.address() as AddressInfo).port;
});

afterEach(async () => {
  while (clients.length) {
    const c = clients.pop()!;
    c.ws.removeAllListeners('message');
    if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) c.ws.terminate();
  }
  handle.wss.close();
  await new Promise<void>((resolve) => handle.server.close(() => resolve()));
});

const create = (name: string, extra: object = {}) => ({
  type: 'agent:create',
  name,
  mode: 'tmux',
  targetHost: `qa_${name}`,
  ...extra,
});

describe('create is announced as agent:added', () => {
  it('reaches both clients once, validated, with no snapshot after the connect one', async () => {
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, create('alpha'));

    await vi.waitFor(() => {
      expect(ofType(a, baseA, 'agent:added')).toHaveLength(1);
      expect(ofType(b, baseB, 'agent:added')).toHaveLength(1);
    });
    await pong(a, b);
    for (const [c, base] of [
      [a, baseA],
      [b, baseB],
    ] as const) {
      const f = ofType(c, base, 'agent:added')[0];
      expect(parseServerMessage(f).ok).toBe(true);
      expect(f.agent).toMatchObject({ name: 'alpha', mode: 'tmux', targetHost: 'qa_alpha', status: 'running' });
      expect(ofType(c, base, 'agent:added')).toHaveLength(1);
      expect(ofType(c, base, 'agent:init_list')).toHaveLength(0);
    }
    expect(ofType(a, 0, 'agent:added')[0].agent.id).toBe(ofType(b, 0, 'agent:added')[0].agent.id);
  });

  it('gives the requester its ack in addition to the event, and nobody else an ack', async () => {
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, create('alpha', { reqId: 'r1' }));

    await vi.waitFor(() => {
      expect(ofType(a, baseA, 'agent:ack')).toHaveLength(1);
      expect(ofType(a, baseA, 'agent:added')).toHaveLength(1);
      expect(ofType(b, baseB, 'agent:added')).toHaveLength(1);
    });
    await pong(a, b);
    const ack = ofType(a, baseA, 'agent:ack')[0];
    expect(ack).toMatchObject({ reqId: 'r1', op: 'create', ok: true });
    expect(ack.agent.id).toBe(ofType(a, baseA, 'agent:added')[0].agent.id);
    expect(ofType(a, baseA, 'agent:ack')).toHaveLength(1);
    expect(ofType(b, baseB, 'agent:ack')).toHaveLength(0);
  });

  it('sends the event and no ack when the create has no reqId', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, create('alpha'));

    await vi.waitFor(() => expect(ofType(a, base, 'agent:added')).toHaveLength(1));
    await pong(a);
    expect(ofType(a, base, 'agent:ack')).toHaveLength(0);
    expect(ofType(a, base, 'agent:error')).toHaveLength(0);
  });

  it('announces nothing when the create fails: only a typed error to the requester', async () => {
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;
    state.failNext = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    send(a, create('doomed', { reqId: 'r2' }));

    await vi.waitFor(() => expect(ofType(a, baseA, 'agent:error')).toHaveLength(1));
    await pong(a, b);
    errSpy.mockRestore();
    expect(ofType(a, baseA, 'agent:added')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:added')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:error')).toHaveLength(0);
    expect(ofType(a, baseA, 'agent:error')[0]).toMatchObject({ code: 'BACKEND_DOWN' });
    expect((await connect()).frames[0].agents).toEqual([]);
  });

  it('resyncs a connection that opens afterwards with one snapshot containing the agent once, no added', async () => {
    const a = await connect();
    send(a, create('alpha'));
    await vi.waitFor(() => expect(ofType(a, 0, 'agent:added')).toHaveLength(1));
    const id = ofType(a, 0, 'agent:added')[0].agent.id;

    const late = await connect();
    await pong(late);

    expect(late.frames[0].type).toBe('agent:init_list');
    expect(late.frames[0].agents.filter((x: any) => x.id === id)).toHaveLength(1);
    expect(ofType(late, 0, 'agent:init_list')).toHaveLength(1);
    expect(ofType(late, 0, 'agent:added')).toHaveLength(0);
  });

  it('gives two identical creates two added events with different ids', async () => {
    const a = await connect();
    const b = await connect();

    send(a, create('twin'));
    send(a, create('twin'));

    await vi.waitFor(() => expect(ofType(b, 0, 'agent:added')).toHaveLength(2));
    const [x, y] = ofType(b, 0, 'agent:added');
    expect(x.agent.id).not.toBe(y.agent.id);
  });
});

describe('close and session kill are announced as agent:removed', () => {
  function seed(...names: string[]) {
    return names.map((n) => handle.sessionManager.createAgent(n, 'tmux', `qa_${n}`));
  }

  it('close: every connection gets one removed (killed), the driver closes once, no snapshot', async () => {
    const [x, y] = seed('x', 'y');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:kill', agentId: x.id });

    await vi.waitFor(() => {
      expect(ofType(a, baseA, 'agent:removed')).toHaveLength(1);
      expect(ofType(b, baseB, 'agent:removed')).toHaveLength(1);
    });
    await pong(a, b);
    for (const [c, base] of [
      [a, baseA],
      [b, baseB],
    ] as const) {
      const f = ofType(c, base, 'agent:removed')[0];
      expect(f).toEqual({ type: 'agent:removed', agentId: x.id, reason: 'killed' });
      expect(parseServerMessage(f).ok).toBe(true);
      expect(ofType(c, base, 'agent:removed')).toHaveLength(1);
      expect(ofType(c, base, 'agent:init_list')).toHaveLength(0);
    }
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
    expect(capturedDrivers()[1].close).not.toHaveBeenCalled();
    expect(killMock).not.toHaveBeenCalled();
    expect((await connect()).frames[0].agents.map((z: any) => z.id)).toEqual([y.id]);
  });

  it('close with a reqId: the requester gets the ack and the event, the other client only the event', async () => {
    const [x] = seed('x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:kill', agentId: x.id, reqId: 'k1' });

    await vi.waitFor(() => {
      expect(ofType(a, baseA, 'agent:ack')).toHaveLength(1);
      expect(ofType(a, baseA, 'agent:removed')).toHaveLength(1);
      expect(ofType(b, baseB, 'agent:removed')).toHaveLength(1);
    });
    await pong(a, b);
    expect(ofType(a, baseA, 'agent:ack')[0]).toMatchObject({ reqId: 'k1', op: 'kill', ok: true });
    expect(ofType(b, baseB, 'agent:ack')).toHaveLength(0);
  });

  it('close of an unknown id announces nothing and answers NOT_FOUND to the requester', async () => {
    seed('x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:kill', agentId: 'ghost' });

    await vi.waitFor(() => expect(ofType(a, baseA, 'agent:error')).toHaveLength(1));
    await pong(a, b);
    expect(ofType(a, baseA, 'agent:error')[0]).toMatchObject({ code: 'NOT_FOUND', agentId: 'ghost' });
    expect(ofType(a, baseA, 'agent:removed')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:removed')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:error')).toHaveLength(0);
  });

  it('session kill: tmux once, then removed (killed) to everyone and the ack to the requester', async () => {
    const [x, y] = seed('x', 'y');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;
    const order: string[] = [];
    killMock.mockImplementationOnce(async () => {
      order.push('tmux');
      return 'killed';
    });
    capturedDrivers()[0].close.mockImplementation(() => order.push('driver-close'));

    send(a, { type: 'agent:kill', agentId: x.id, killSession: true, confirm: true, reqId: 'k2' });

    await vi.waitFor(() => {
      expect(ofType(a, baseA, 'agent:removed')).toHaveLength(1);
      expect(ofType(b, baseB, 'agent:removed')).toHaveLength(1);
      expect(ofType(a, baseA, 'agent:ack')).toHaveLength(1);
    });
    await pong(a, b);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith('qa_x');
    expect(order).toEqual(['tmux', 'driver-close']);
    expect(ofType(a, baseA, 'agent:removed')[0]).toEqual({ type: 'agent:removed', agentId: x.id, reason: 'killed' });
    expect(ofType(a, baseA, 'agent:ack')[0]).toMatchObject({ reqId: 'k2', op: 'kill', ok: true });
    expect(ofType(b, baseB, 'agent:ack')).toHaveLength(0);
    expect(ofType(a, baseA, 'agent:init_list')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:init_list')).toHaveLength(0);
    expect((await connect()).frames[0].agents.map((z: any) => z.id)).toEqual([y.id]);
  });

  it.each([
    ['confirm missing', { killSession: true }, 'USAGE'],
    ['confirm not literally true', { killSession: true, confirm: 'true' }, 'USAGE'],
  ])('refusal (%s) announces nothing and leaves the registry unchanged', async (_n, extra, code) => {
    const [x] = seed('x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:kill', agentId: x.id, ...extra });

    await vi.waitFor(() => expect(ofType(a, baseA, 'agent:error')).toHaveLength(1));
    await pong(a, b);
    expect(ofType(a, baseA, 'agent:error')[0]).toMatchObject({ code });
    expect(ofType(a, baseA, 'agent:removed')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:removed')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:error')).toHaveLength(0);
    expect(killMock).not.toHaveBeenCalled();
    expect((await connect()).frames[0].agents.map((z: any) => z.id)).toEqual([x.id]);
  });

  it('refusal for an unkillable session name announces nothing', async () => {
    const [bad] = [handle.sessionManager.createAgent('bad', 'tmux', 'bad name;x')];
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    send(a, { type: 'agent:kill', agentId: bad.id, killSession: true, confirm: true });

    await vi.waitFor(() => expect(ofType(a, baseA, 'agent:error')).toHaveLength(1));
    await pong(a, b);
    vi.mocked(console.warn).mockRestore();
    expect(ofType(a, baseA, 'agent:error')[0]).toMatchObject({ code: 'USAGE' });
    expect(ofType(b, baseB, 'agent:removed')).toHaveLength(0);
    expect(killMock).not.toHaveBeenCalled();
    expect((await connect()).frames[0].agents.map((z: any) => z.id)).toEqual([bad.id]);
  });

  it('a tmux failure announces nothing, keeps the agent, and replays a deferred exit as one status_change', async () => {
    const [x] = seed('x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail!: (e: unknown) => void;
    killMock.mockImplementationOnce(
      () =>
        new Promise((_res, rej) => {
          fail = rej;
        })
    );

    send(a, { type: 'agent:kill', agentId: x.id, killSession: true, confirm: true });
    await vi.waitFor(() => expect(killMock).toHaveBeenCalledTimes(1));
    capturedDrivers()[0].onExit(0); // exit while the kill is in flight: held back
    await pong(b);
    expect(ofType(b, baseB, 'agent:status_change')).toHaveLength(0);
    fail(new Error('tmux down'));

    await vi.waitFor(() => expect(ofType(b, baseB, 'agent:status_change')).toHaveLength(1));
    await pong(a, b);
    vi.mocked(console.error).mockRestore();
    vi.mocked(console.warn).mockRestore();
    expect(ofType(b, baseB, 'agent:status_change')[0]).toMatchObject({ agentId: x.id, status: 'disconnected' });
    expect(ofType(a, baseA, 'agent:removed')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:removed')).toHaveLength(0);
    expect(ofType(a, baseA, 'agent:error')).toHaveLength(1);
  });

  it('a driver exit during a successful kill is dropped: removed only, never a status_change', async () => {
    const [x] = seed('x');
    const a = await connect();
    const baseA = a.frames.length;
    let done!: () => void;
    killMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          done = () => res('killed');
        })
    );

    send(a, { type: 'agent:kill', agentId: x.id, killSession: true, confirm: true });
    await vi.waitFor(() => expect(killMock).toHaveBeenCalledTimes(1));
    capturedDrivers()[0].onExit(0);
    done();

    await vi.waitFor(() => expect(ofType(a, baseA, 'agent:removed')).toHaveLength(1));
    capturedDrivers()[0].onExit(0); // a late exit after removal is dropped too
    await pong(a);
    expect(ofType(a, baseA, 'agent:status_change')).toHaveLength(0);
  });

  it('a rename is announced as agent:updated and never as a snapshot', async () => {
    const [x] = seed('x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:update', agentId: x.id, name: 'Renamed' });

    await vi.waitFor(() => {
      expect(ofType(a, baseA, 'agent:updated')).toHaveLength(1);
      expect(ofType(b, baseB, 'agent:updated')).toHaveLength(1);
    });
    await pong(a, b);
    expect(ofType(b, baseB, 'agent:updated')[0]).toEqual({
      type: 'agent:updated',
      agentId: x.id,
      patch: { name: 'Renamed' },
    });
    expect(ofType(a, baseA, 'agent:init_list')).toHaveLength(0);
    expect(ofType(b, baseB, 'agent:init_list')).toHaveLength(0);
  });
});

describe('resync, ordering and exit persistence', () => {
  it('a long-lived client sees added, added, updated, removed in order; a fresh snapshot equals the registry', async () => {
    const old = await connect();

    send(old, create('A'));
    await vi.waitFor(() => expect(ofType(old, 0, 'agent:added')).toHaveLength(1));
    send(old, create('B'));
    await vi.waitFor(() => expect(ofType(old, 0, 'agent:added')).toHaveLength(2));
    const [idA, idB] = ofType(old, 0, 'agent:added').map((f) => f.agent.id);
    send(old, { type: 'agent:update', agentId: idA, name: 'A2', tags: ['t'] });
    await vi.waitFor(() => expect(ofType(old, 0, 'agent:updated')).toHaveLength(1));
    send(old, { type: 'agent:kill', agentId: idB });
    await vi.waitFor(() => expect(ofType(old, 0, 'agent:removed')).toHaveLength(1));

    const kinds = old.frames.map((f) => f.type).filter((t) => t.startsWith('agent:') && t !== 'agent:init_list');
    expect(kinds).toEqual(['agent:added', 'agent:added', 'agent:updated', 'agent:removed']);

    const fresh = await connect();
    const snap = fresh.frames[0];
    expect(snap.type).toBe('agent:init_list');
    expect(snap.agents.map((x: any) => x.id)).toEqual([idA]);
    expect(snap.agents[0]).toMatchObject({ name: 'A2', tags: ['t'] });
    expect(new Set(snap.agents.map((x: any) => x.id)).size).toBe(snap.agents.length);
    // The old connection's event-built view equals the fresh snapshot.
    expect(view(reduce([], old.frames))).toEqual(view(snap.agents));
  });

  it('a client that drops during the sequence reconnects to the snapshot only: no replay, no duplicates', async () => {
    const stay = await connect();
    const gone = await connect();
    send(stay, create('A'));
    await vi.waitFor(() => expect(ofType(gone, 0, 'agent:added')).toHaveLength(1));
    gone.ws.close();
    await vi.waitFor(() => expect(gone.ws.readyState).toBe(WebSocket.CLOSED));
    send(stay, create('B'));
    await vi.waitFor(() => expect(ofType(stay, 0, 'agent:added')).toHaveLength(2));
    const idA = ofType(stay, 0, 'agent:added')[0].agent.id;
    send(stay, { type: 'agent:kill', agentId: idA });
    await vi.waitFor(() => expect(ofType(stay, 0, 'agent:removed')).toHaveLength(1));

    const back = await connect();
    await pong(back);

    expect(back.frames[0].type).toBe('agent:init_list');
    expect(back.frames[0].agents.map((x: any) => x.name)).toEqual(['B']);
    expect(back.frames.filter((f) => f.type !== 'agent:init_list' && f.type !== 'pong')).toEqual([]);
    expect(view(reduce([], stay.frames))).toEqual(view(back.frames[0].agents));
  });

  it('a driver exit leaves the agent listed as disconnected, announced by status_change only', async () => {
    const [x] = [handle.sessionManager.createAgent('mortal', 'tmux', 'qa_mortal')];
    const a = await connect();
    const base = a.frames.length;

    capturedDrivers()[0].onExit(0);

    await vi.waitFor(() => expect(ofType(a, base, 'agent:status_change')).toHaveLength(1));
    await pong(a);
    expect(ofType(a, base, 'agent:status_change')[0]).toMatchObject({ agentId: x.id, status: 'disconnected' });
    expect(ofType(a, base, 'agent:removed')).toHaveLength(0);
    expect(ofType(a, base, 'agent:init_list')).toHaveLength(0);
    const late = await connect();
    expect(late.frames[0].agents.find((z: any) => z.id === x.id)).toMatchObject({ status: 'disconnected' });
  });

  it('agent:updated carries only the supplied keys; an update of an unknown id announces nothing', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:update', agentId: x.id, group: 'g1' });
    await vi.waitFor(() => expect(ofType(b, baseB, 'agent:updated')).toHaveLength(1));
    send(a, { type: 'agent:update', agentId: 'ghost', name: 'nope' });
    await vi.waitFor(() => expect(ofType(a, baseA, 'agent:error')).toHaveLength(1));
    await pong(a, b);

    expect(ofType(b, baseB, 'agent:updated')[0]).toEqual({
      type: 'agent:updated',
      agentId: x.id,
      patch: { group: 'g1' },
    });
    expect(ofType(a, baseA, 'agent:error')[0]).toMatchObject({ code: 'NOT_FOUND', agentId: 'ghost' });
    expect(ofType(a, baseA, 'agent:updated')).toHaveLength(1);
    expect(ofType(b, baseB, 'agent:updated')).toHaveLength(1);
  });

  it('20 creates and 20 closes leave an empty registry and a consistent view for every client', async () => {
    const a = await connect();
    const b = await connect();

    for (let i = 0; i < 20; i++) send(a, create(`n${i}`));
    await vi.waitFor(() => expect(ofType(b, 0, 'agent:added')).toHaveLength(20), { timeout: 5000 });
    const mid = await connect();
    expect(view(reduce([], b.frames))).toEqual(view(mid.frames[0].agents));
    expect(mid.frames[0].agents).toHaveLength(20);

    const ids = ofType(a, 0, 'agent:added').map((f) => f.agent.id);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) send(a, { type: 'agent:kill', agentId: id });
    await vi.waitFor(() => expect(ofType(b, 0, 'agent:removed')).toHaveLength(20), { timeout: 5000 });
    await pong(a, b);

    const fin = await connect();
    expect(fin.frames[0].agents).toEqual([]);
    expect(reduce([], a.frames)).toEqual([]);
    expect(reduce([], b.frames)).toEqual([]);
    expect(handle.sessionManager.getAgentCount()).toBe(0);
    expect(capturedDrivers().every((d) => d.close.mock.calls.length === 1)).toBe(true);
  });
});
