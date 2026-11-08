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

// Task 2 and 3 cases are appended below.
void capturedDrivers;
void view;
void reduce;
