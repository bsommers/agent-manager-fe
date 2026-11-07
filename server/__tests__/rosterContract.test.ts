// Characterization tests for the roster messages the frontend depends on
// (phase 10, plan 10-02). They run against the unmodified gateway; Phase 6
// replaces the snapshot semantics pinned here, and must update these on purpose.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

interface CapturedDriver {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}

const drivers = vi.hoisted(() => [] as unknown[]);

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
    const driver = { write: vi.fn(), resize: vi.fn(), close: vi.fn(), onData, onExit };
    drivers.push(driver);
    return driver;
  }),
}));

import { bootstrap } from '../src/index.js';
import { WebSocket } from 'ws';

type Handle = Awaited<ReturnType<typeof bootstrap>>;
type Frame = { type: string; [key: string]: any };

interface Client {
  ws: WebSocket;
  frames: Frame[];
}

const capturedDrivers = () => drivers as CapturedDriver[];

let handle: Handle;
let port: number;
const clients: Client[] = [];

async function connect(): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const client: Client = { ws, frames: [] };
  // Attach before open so the first frame can never be missed.
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

const lastSnapshot = (c: Client): Frame | undefined =>
  [...c.frames].reverse().find((f) => f.type === 'agent:init_list');

const snapshotsAfter = (c: Client, from: number) =>
  c.frames.slice(from).filter((f) => f.type === 'agent:init_list');

beforeEach(async () => {
  drivers.length = 0;
  handle = await bootstrap(0, '127.0.0.1');
  port = (handle.server.address() as AddressInfo).port;
});

afterEach(async () => {
  while (clients.length) {
    const c = clients.pop()!;
    c.ws.removeAllListeners('message');
    if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) {
      c.ws.terminate();
    }
  }
  handle.wss.close();
  await new Promise<void>((resolve) => handle.server.close(() => resolve()));
});

describe('gateway roster contract (what the frontend reconciles against)', () => {
  it('sends the full roster as the first frame on connect', async () => {
    handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
    handle.sessionManager.createAgent('beta', 'tmux', 'qa_b');

    const c = await connect();

    const first = c.frames[0];
    expect(first.type).toBe('agent:init_list');
    expect(first.agents).toHaveLength(2);
    expect(first.agents.map((a: any) => [a.name, a.mode, a.targetHost, a.status])).toEqual([
      ['alpha', 'tmux', 'qa_a', 'running'],
      ['beta', 'tmux', 'qa_b', 'running'],
    ]);
    const ids = first.agents.map((a: any) => a.id);
    ids.forEach((id: unknown) => {
      expect(typeof id).toBe('string');
      expect((id as string).length).toBeGreaterThan(0);
    });
    expect(new Set(ids).size).toBe(2);
  });

  it('announces a create to every client, sender included, as a full snapshot', async () => {
    handle.sessionManager.createAgent('existing', 'tmux', 'qa_x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:create', name: 'qa-new', mode: 'tmux', targetHost: 'qa_new' });

    await vi.waitFor(() => {
      expect(snapshotsAfter(a, baseA)).toHaveLength(1);
      expect(snapshotsAfter(b, baseB)).toHaveLength(1);
    });
    for (const [client, base] of [
      [a, baseA],
      [b, baseB],
    ] as const) {
      const snap = snapshotsAfter(client, base)[0];
      // The whole roster, not a delta.
      expect(snap.agents).toHaveLength(2);
      const created = snap.agents.find((x: any) => x.name === 'qa-new');
      expect(created).toMatchObject({ name: 'qa-new', mode: 'tmux', targetHost: 'qa_new' });
      expect(typeof created.id).toBe('string');
      expect(created.id.length).toBeGreaterThan(0);
      expect(snap.agents.some((x: any) => x.name === 'existing')).toBe(true);
    }
  });

  it('writes initialCmd followed by a newline to the new session', async () => {
    const a = await connect();

    send(a, {
      type: 'agent:create',
      name: 'cmd',
      mode: 'tmux',
      targetHost: 'qa_cmd',
      initialCmd: 'echo hi',
    });

    await vi.waitFor(() => expect(capturedDrivers()).toHaveLength(1));
    await vi.waitFor(() => expect(capturedDrivers()[0].write).toHaveBeenCalledWith('echo hi\n'), {
      timeout: 2000,
    });
  });

  it('creates two agents with different ids for identical creates', async () => {
    const a = await connect();
    const base = a.frames.length;
    const create = { type: 'agent:create', name: 'twin', mode: 'tmux', targetHost: 'qa_twin' };

    send(a, create);
    send(a, create);

    await vi.waitFor(() => expect(snapshotsAfter(a, base)).toHaveLength(2));
    const snap = lastSnapshot(a)!;
    const twins = snap.agents.filter((x: any) => x.name === 'twin');
    expect(twins).toHaveLength(2);
    expect(twins[0].id).not.toBe(twins[1].id);
  });

  it('answers a kill with a snapshot without that agent, and closes its driver', async () => {
    const first = handle.sessionManager.createAgent('keep', 'tmux', 'qa_keep');
    const second = handle.sessionManager.createAgent('drop', 'tmux', 'qa_drop');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:kill', agentId: second.id });

    await vi.waitFor(() => {
      expect(snapshotsAfter(a, baseA)).toHaveLength(1);
      expect(snapshotsAfter(b, baseB)).toHaveLength(1);
    });
    for (const [client, base] of [
      [a, baseA],
      [b, baseB],
    ] as const) {
      const ids = snapshotsAfter(client, base)[0].agents.map((x: any) => x.id);
      expect(ids).toEqual([first.id]);
    }
    expect(capturedDrivers()[1].close).toHaveBeenCalled();
    expect(capturedDrivers()[0].close).not.toHaveBeenCalled();
  });

  it('answers a kill of an unknown id with an unchanged snapshot to every client', async () => {
    const known = handle.sessionManager.createAgent('stay', 'tmux', 'qa_stay');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:kill', agentId: 'agent-does-not-exist' });

    await vi.waitFor(() => {
      expect(snapshotsAfter(a, baseA)).toHaveLength(1);
      expect(snapshotsAfter(b, baseB)).toHaveLength(1);
    });
    expect(snapshotsAfter(a, baseA)[0].agents.map((x: any) => x.id)).toEqual([known.id]);
    expect(snapshotsAfter(b, baseB)[0].agents.map((x: any) => x.id)).toEqual([known.id]);
  });

  it('resyncs a reconnecting client with the roster exactly once, with unique ids', async () => {
    const a = await connect();
    const base = a.frames.length;
    send(a, { type: 'agent:create', name: 'persist', mode: 'tmux', targetHost: 'qa_persist' });
    await vi.waitFor(() => expect(snapshotsAfter(a, base)).toHaveLength(1));
    a.ws.close();
    await vi.waitFor(() => expect(a.ws.readyState).toBe(WebSocket.CLOSED));

    const c = await connect();

    expect(c.frames[0].type).toBe('agent:init_list');
    const matching = c.frames[0].agents.filter((x: any) => x.name === 'persist');
    expect(matching).toHaveLength(1);
    const ids = c.frames[0].agents.map((x: any) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports a driver exit as status_change disconnected and persists it into later snapshots', async () => {
    const agent = handle.sessionManager.createAgent('mortal', 'tmux', 'qa_mortal');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    capturedDrivers()[0].onExit(0);

    const isStatus = (f: Frame) =>
      f.type === 'agent:status_change' && f.agentId === agent.id && f.status === 'disconnected';
    await vi.waitFor(() => {
      expect(a.frames.slice(baseA).some(isStatus)).toBe(true);
      expect(b.frames.slice(baseB).some(isStatus)).toBe(true);
    });

    const late = await connect();
    const seen = late.frames[0].agents.find((x: any) => x.id === agent.id);
    expect(seen.status).toBe('disconnected');
  });

  it('ignores agent:update today (pins the Phase 6 deferral of rename, tags and group)', async () => {
    const agent = handle.sessionManager.createAgent('original', 'tmux', 'qa_orig');
    const a = await connect();
    const base = a.frames.length;

    // No timing window: send the update, then an unknown-id kill as a sentinel, then a
    // ping. The gateway handles one socket's frames in order and replies synchronously,
    // so the pong proves every frame caused by the first two has already arrived.
    send(a, { type: 'agent:update', agentId: agent.id, name: 'Renamed' });
    send(a, { type: 'agent:kill', agentId: 'agent-sentinel-unknown' });
    send(a, { type: 'ping', t: 42 });

    await vi.waitFor(() => expect(a.frames.slice(base).some((f) => f.type === 'pong')).toBe(true));
    const between = a.frames.slice(base);
    expect(between.map((f) => f.type)).toEqual(['agent:init_list', 'pong']);
    // The one snapshot is the one caused by the sentinel kill, and the name is unchanged.
    expect(between[0].agents).toHaveLength(1);
    expect(between[0].agents[0]).toMatchObject({ id: agent.id, name: 'original' });

    const late = await connect();
    expect(late.frames[0].agents[0].name).toBe('original');
  });
});
