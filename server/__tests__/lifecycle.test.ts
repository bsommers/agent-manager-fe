// Agent lifecycle over a real WebSocket (plan 06-02): reqId acks, typed errors, frame validation.
// Drivers and tmux are mocked: no real tmux session is ever touched, and the port is 0.
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

const capturedDrivers = () => drivers as CapturedDriver[];
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
const sendRaw = (c: Client, text: string) => c.ws.send(text);

const spies: Array<{ mockRestore: () => void }> = [];
const spyConsole = (method: 'error' | 'warn' | 'log') => {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  spies.push(spy);
  return spy;
};

let pingSeq = 100;
/** The gateway handles one socket's frames in order, so the pong proves earlier replies have arrived. */
async function settle(...cs: Client[]): Promise<void> {
  for (const c of cs) {
    const t = ++pingSeq;
    send(c, { type: 'ping', t });
    await vi.waitFor(() => expect(c.frames.some((f) => f.type === 'pong' && f.t === t)).toBe(true), {
      timeout: 2000,
    });
  }
}

const ofType = (c: Client, from: number, type: string) => c.frames.slice(from).filter((f) => f.type === type);
const acksAfter = (c: Client, from: number) => ofType(c, from, 'agent:ack');
const errorsAfter = (c: Client, from: number) => ofType(c, from, 'agent:error');
const snapshotsAfter = (c: Client, from: number) => ofType(c, from, 'agent:init_list');
const updatesAfter = (c: Client, from: number) => ofType(c, from, 'agent:updated');

/** A fresh connection's first frame is the roster; it replaces the old unknown-id kill sentinel. */
async function rosterNow(): Promise<Frame> {
  const fresh = await connect();
  return fresh.frames[0];
}

beforeEach(async () => {
  drivers.length = 0;
  killMock.mockClear();
  handle = await bootstrap(0, '127.0.0.1');
  port = (handle.server.address() as AddressInfo).port;
});

afterEach(async () => {
  while (spies.length) spies.pop()!.mockRestore();
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

describe('agent:create with a reqId', () => {
  it('acks the requester once with the created agent, and nobody else', async () => {
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:create', name: 'qa-new', mode: 'tmux', targetHost: 'qa_new', reqId: 'r1' });

    await vi.waitFor(() => expect(acksAfter(a, baseA)).toHaveLength(1));
    await settle(a, b);
    const ack = acksAfter(a, baseA)[0];
    expect(ack).toMatchObject({ type: 'agent:ack', reqId: 'r1', op: 'create', ok: true });
    expect(ack.agent).toMatchObject({ name: 'qa-new', mode: 'tmux', targetHost: 'qa_new' });
    expect(parseServerMessage(ack).ok).toBe(true);
    expect(acksAfter(a, baseA)).toHaveLength(1);
    expect(acksAfter(b, baseB)).toHaveLength(0);

    // Every connection learns of the create from agent:added (06-04), the other client included.
    await vi.waitFor(() => expect(ofType(b, baseB, 'agent:added')).toHaveLength(1));
    expect(ofType(b, baseB, 'agent:added')[0].agent.id).toBe(ack.agent.id);
    expect(snapshotsAfter(b, baseB)).toHaveLength(0);
  });

  it('sends no ack when the create carries no reqId', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:create', name: 'plain', mode: 'tmux', targetHost: 'qa_plain' });

    await vi.waitFor(() => expect(ofType(a, base, 'agent:added')).toHaveLength(1));
    await settle(a);
    expect(acksAfter(a, base)).toHaveLength(0);
    expect(errorsAfter(a, base)).toHaveLength(0);
  });
});

describe('agent:kill with a reqId', () => {
  it('acks a close with op kill and no agent, and closes the driver', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:kill', agentId: x.id, reqId: 'k1' });

    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(1));
    const ack = acksAfter(a, base)[0];
    expect(ack).toMatchObject({ reqId: 'k1', op: 'kill', ok: true });
    expect(ack.agent).toBeUndefined();
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
    expect(killMock).not.toHaveBeenCalled();
    expect(parseServerMessage(ack).ok).toBe(true);
  });

  it('acks a confirmed killSession after the tmux call', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:kill', agentId: x.id, killSession: true, confirm: true, reqId: 'k2' });

    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(1));
    expect(killMock).toHaveBeenCalledWith('qa_x');
    expect(acksAfter(a, base)[0]).toMatchObject({ reqId: 'k2', op: 'kill', ok: true });
    expect(errorsAfter(a, base)).toHaveLength(0);
  });

  it('refuses a missing confirm with USAGE before looking at the id, echoing the reqId', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:kill', agentId: 'ghost', killSession: true, reqId: 'k3' });

    await vi.waitFor(() => expect(errorsAfter(a, base)).toHaveLength(1));
    expect(errorsAfter(a, base)[0]).toMatchObject({ code: 'USAGE', agentId: 'ghost', reqId: 'k3' });
    expect(killMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a plain kill', { type: 'agent:kill', agentId: 'agent-ghost' }],
    ['a confirmed killSession', { type: 'agent:kill', agentId: 'agent-ghost', killSession: true, confirm: true }],
    ['an update', { type: 'agent:update', agentId: 'agent-ghost', name: 'n' }],
  ])('answers %s of an unknown id with NOT_FOUND to the requester only and no snapshot', async (_n, frame) => {
    handle.sessionManager.createAgent('stay', 'tmux', 'qa_stay');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { ...frame, reqId: 'nf1' });

    await vi.waitFor(() => expect(errorsAfter(a, baseA)).toHaveLength(1));
    await settle(a, b);
    const err = errorsAfter(a, baseA)[0];
    expect(err).toMatchObject({ code: 'NOT_FOUND', agentId: 'agent-ghost', reqId: 'nf1', retryable: false });
    expect(parseServerMessage(err).ok).toBe(true);
    expect(snapshotsAfter(a, baseA)).toHaveLength(0);
    expect(snapshotsAfter(b, baseB)).toHaveLength(0);
    expect(errorsAfter(b, baseB)).toHaveLength(0);
    expect(killMock).not.toHaveBeenCalled();
  });

  it('omits the reqId on a NOT_FOUND when the request had none', async () => {
    const a = await connect();
    const base = a.frames.length;
    send(a, { type: 'agent:kill', agentId: 'agent-ghost' });
    await vi.waitFor(() => expect(errorsAfter(a, base)).toHaveLength(1));
    expect('reqId' in errorsAfter(a, base)[0]).toBe(false);
  });
});

describe('agent:update', () => {
  it('renames an agent, acks the requester and announces agent:updated to every client', async () => {
    const x = handle.sessionManager.createAgent('original', 'tmux', 'qa_orig');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:update', agentId: x.id, name: 'Renamed', reqId: 'u1' });

    await vi.waitFor(() => {
      expect(acksAfter(a, baseA)).toHaveLength(1);
      expect(updatesAfter(a, baseA)).toHaveLength(1);
      expect(updatesAfter(b, baseB)).toHaveLength(1);
    });
    await settle(a, b);
    const ack = acksAfter(a, baseA)[0];
    expect(ack).toMatchObject({ reqId: 'u1', op: 'update', ok: true });
    expect(ack.agent).toMatchObject({ id: x.id, name: 'Renamed' });
    expect(acksAfter(b, baseB)).toHaveLength(0);
    for (const [c, base] of [
      [a, baseA],
      [b, baseB],
    ] as const) {
      expect(updatesAfter(c, base)[0]).toMatchObject({
        agentId: x.id,
        patch: { name: 'Renamed' },
      });
    }

    const roster = await rosterNow();
    expect(roster.agents[0].name).toBe('Renamed');
  });

  it('updates without a reqId silently, still announcing the change', async () => {
    const x = handle.sessionManager.createAgent('o', 'tmux', 'qa_o');
    const a = await connect();
    const base = a.frames.length;
    send(a, { type: 'agent:update', agentId: x.id, tags: ['t1'] });
    await vi.waitFor(() => expect(updatesAfter(a, base)).toHaveLength(1));
    await settle(a);
    expect(acksAfter(a, base)).toHaveLength(0);
    expect(updatesAfter(a, base)[0].patch).toEqual({ tags: ['t1'] });
  });
});

describe('frame validation', () => {
  it.each([
    ['an empty name', { type: 'agent:create', name: '', mode: 'tmux', targetHost: 'h' }, 'name'],
    ['cols 0', { type: 'agent:resize', agentId: 'a1', cols: 0, rows: 24 }, 'cols'],
    ['a non-boolean killSession', { type: 'agent:kill', agentId: 'a1', killSession: 'yes' }, 'killSession'],
    ['a non-string data', { type: 'agent:input', agentId: 'a1', data: 5 }, 'data'],
  ])('answers %s with USAGE naming the field, to the requester only', async (_n, frame, field) => {
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, frame);

    await vi.waitFor(() => expect(errorsAfter(a, baseA)).toHaveLength(1));
    await settle(a, b);
    const err = errorsAfter(a, baseA)[0];
    expect(err).toMatchObject({ code: 'USAGE', retryable: false, message: `invalid field: ${field}` });
    expect(parseServerMessage(err).ok).toBe(true);
    expect(errorsAfter(b, baseB)).toHaveLength(0);
    expect(snapshotsAfter(a, baseA)).toHaveLength(0);
  });

  it('echoes reqId and agentId only when they are valid ids', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:resize', agentId: 'a1', cols: 0, rows: 24, reqId: 'req-1' });
    send(a, { type: 'agent:resize', agentId: 'x'.repeat(200), cols: 0, rows: 24, reqId: 7 });

    await vi.waitFor(() => expect(errorsAfter(a, base)).toHaveLength(2));
    const [first, second] = errorsAfter(a, base);
    expect(first).toMatchObject({ agentId: 'a1', reqId: 'req-1' });
    expect('agentId' in second).toBe(false);
    expect('reqId' in second).toBe(false);
  });

  it('never echoes a rejected value back', async () => {
    const a = await connect();
    const base = a.frames.length;
    send(a, { type: 'agent:create', name: '<script>alert(1)</script>'.repeat(20), mode: 'nope', targetHost: 'h' });
    await vi.waitFor(() => expect(errorsAfter(a, base)).toHaveLength(1));
    const text = JSON.stringify(errorsAfter(a, base)[0]);
    expect(text).not.toContain('script');
    expect(text).not.toContain('nope');
  });

  it('ignores an unknown type without any frame or console output', async () => {
    const err = spyConsole('error');
    const warn = spyConsole('warn');
    const log = spyConsole('log');
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:frobnicate', agentId: 'a1', reqId: 'r' });
    await settle(a);

    expect(a.frames.slice(base).map((f) => f.type)).toEqual(['pong']);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('logs a non-object frame exactly once and sends nothing', async () => {
    const err = spyConsole('error');
    const a = await connect();
    const base = a.frames.length;

    sendRaw(a, '[1,2,3]');
    await settle(a);

    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][1])).toContain('Client frame must be a JSON object');
    expect(a.frames.slice(base).map((f) => f.type)).toEqual(['pong']);
  });

  it('accepts a hello and ignores it', async () => {
    const err = spyConsole('error');
    const a = await connect();
    const base = a.frames.length;
    send(a, { type: 'hello', contract: 1 });
    await settle(a);
    expect(a.frames.slice(base).map((f) => f.type)).toEqual(['pong']);
    expect(err).not.toHaveBeenCalled();
  });
});

describe('input, resize and broadcast', () => {
  it('never replies to input or resize for an unknown agent', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:input', agentId: 'agent-ghost', data: 'x' });
    send(a, { type: 'agent:resize', agentId: 'agent-ghost', cols: 80, rows: 24 });
    await settle(a);

    expect(a.frames.slice(base).map((f) => f.type)).toEqual(['pong']);
  });

  it('writes input and resize through to the driver without a reply', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const base = a.frames.length;
    send(a, { type: 'agent:input', agentId: x.id, data: 'ls\r' });
    send(a, { type: 'agent:resize', agentId: x.id, cols: 100, rows: 30 });
    await settle(a);
    expect(capturedDrivers()[0].write).toHaveBeenCalledWith('ls\r');
    expect(capturedDrivers()[0].resize).toHaveBeenCalledWith(100, 30);
    expect(a.frames.slice(base).map((f) => f.type)).toEqual(['pong']);
  });

  it('runs a broadcast through the service to every target and sends no ack, even with a reqId', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const y = handle.sessionManager.createAgent('y', 'tmux', 'qa_y');
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:broadcast', targetAgentIds: [x.id, y.id], data: 'echo\r', reqId: 'b1' });
    await vi.waitFor(() => {
      expect(capturedDrivers()[0].write).toHaveBeenCalledWith('echo\r');
      expect(capturedDrivers()[1].write).toHaveBeenCalledWith('echo\r');
    });
    await settle(a);

    expect(acksAfter(a, base)).toHaveLength(0);
    expect(errorsAfter(a, base)).toHaveLength(0);
  });
});

describe('the confirm gate through the validator', () => {
  it.each([
    ['absent', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['the number 1', 1],
  ])('answers killSession with confirm %s with one USAGE to the requester only', async (_n, confirm) => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;
    const frame: Record<string, unknown> = { type: 'agent:kill', agentId: x.id, killSession: true };
    if (confirm !== undefined) frame.confirm = confirm;

    send(a, frame);

    await vi.waitFor(() => expect(errorsAfter(a, baseA)).toHaveLength(1));
    await settle(a, b);
    const err = errorsAfter(a, baseA)[0];
    expect(err).toMatchObject({ code: 'USAGE', retryable: false, agentId: x.id });
    expect(parseServerMessage(err).ok).toBe(true);
    expect(errorsAfter(a, baseA)).toHaveLength(1);
    expect(errorsAfter(b, baseB)).toHaveLength(0);
    expect(killMock).not.toHaveBeenCalled();
    expect(capturedDrivers()[0].close).not.toHaveBeenCalled();
  });
});

describe('hostile frames over a real WebSocket', () => {
  it('stays usable after a stream of 50 invalid frames and raises no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const a = await connect();
      const base = a.frames.length;
      for (let i = 0; i < 50; i++) {
        send(a, { type: 'agent:resize', agentId: 'a1', cols: -i, rows: 24, reqId: `bad-${i}` });
      }
      await settle(a);

      expect(errorsAfter(a, base)).toHaveLength(50);
      expect(errorsAfter(a, base).every((e) => e.code === 'USAGE')).toBe(true);
      expect(a.ws.readyState).toBe(WebSocket.OPEN);
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('answers an oversized input with PAYLOAD_TOO_LARGE to the requester only, and writes nothing', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, { type: 'agent:input', agentId: x.id, data: 'y'.repeat(65537) });
    await vi.waitFor(() => expect(errorsAfter(a, baseA)).toHaveLength(1));
    await settle(b);

    expect(errorsAfter(a, baseA)[0]).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'invalid field: data',
      agentId: x.id,
      retryable: false,
    });
    expect(errorsAfter(b, baseB)).toHaveLength(0);
    expect(capturedDrivers()[0].write).not.toHaveBeenCalled();
  });

  it('counts rejected frames on the API stats', async () => {
    const a = await connect();
    send(a, { type: 'agent:resize', agentId: 'a1', cols: 0, rows: 24 });
    send(a, { type: 'agent:unknown' });
    await settle(a);
    expect(handle.sessionManager.api.stats.invalidFrames).toBe(1);
  });

  it('never echoes extra fields of an accepted frame into the service', async () => {
    const a = await connect();
    const base = a.frames.length;
    send(a, { type: 'agent:create', name: 'ok', mode: 'tmux', targetHost: 'qa_ok', reqId: 'x1', evil: '<b>', backend: undefined });
    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(1));
    expect(JSON.stringify(acksAfter(a, base)[0])).not.toContain('<b>');
  });
});

describe('idempotent reqId over real WebSockets', () => {
  const createFrame = { type: 'agent:create', name: 'once', mode: 'tmux', targetHost: 'qa_once', reqId: 'same' };

  it('creates one agent when the same frame is sent twice on one socket, and acks both sends', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, createFrame);
    send(a, createFrame);

    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(2));
    const [first, second] = acksAfter(a, base);
    expect(second.agent.id).toBe(first.agent.id);
    expect(capturedDrivers()).toHaveLength(1);
    expect((await rosterNow()).agents).toHaveLength(1);
  });

  it('creates one agent when two sockets send the same reqId, and acks each sender', async () => {
    const a = await connect();
    const b = await connect();
    const baseA = a.frames.length;
    const baseB = b.frames.length;

    send(a, createFrame);
    await vi.waitFor(() => expect(acksAfter(a, baseA)).toHaveLength(1));
    send(b, createFrame);
    await vi.waitFor(() => expect(acksAfter(b, baseB)).toHaveLength(1));

    expect(acksAfter(b, baseB)[0].agent.id).toBe(acksAfter(a, baseA)[0].agent.id);
    expect(capturedDrivers()).toHaveLength(1);
    expect((await rosterNow()).agents).toHaveLength(1);
  });

  it('refuses a reqId reused for a different request with CONFLICT carrying the reqId', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, createFrame);
    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(1));
    send(a, { ...createFrame, name: 'different' });

    await vi.waitFor(() => expect(errorsAfter(a, base)).toHaveLength(1));
    expect(errorsAfter(a, base)[0]).toMatchObject({ code: 'CONFLICT', reqId: 'same', retryable: false });
    expect(capturedDrivers()).toHaveLength(1);
  });

  it('replays a close ack without closing twice', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const base = a.frames.length;
    const frame = { type: 'agent:kill', agentId: x.id, reqId: 'kk' };

    send(a, frame);
    send(a, frame);

    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(2));
    expect(errorsAfter(a, base)).toHaveLength(0);
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
  });

  it('replays a confirmed kill ack without calling tmux twice', async () => {
    const x = handle.sessionManager.createAgent('x', 'tmux', 'qa_x');
    const a = await connect();
    const base = a.frames.length;
    const frame = { type: 'agent:kill', agentId: x.id, killSession: true, confirm: true, reqId: 'kd' };

    send(a, frame);
    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(1));
    send(a, frame);

    await vi.waitFor(() => expect(acksAfter(a, base)).toHaveLength(2));
    expect(killMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a create with a backend, or params, as UNSUPPORTED and creates nothing', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, { ...createFrame, reqId: 'u1', backend: 'docker' });
    send(a, { ...createFrame, reqId: 'u2', params: { image: 'x' } });

    await vi.waitFor(() => expect(errorsAfter(a, base)).toHaveLength(2));
    expect(errorsAfter(a, base).map((e) => [e.code, e.reqId])).toEqual([
      ['UNSUPPORTED', 'u1'],
      ['UNSUPPORTED', 'u2'],
    ]);
    expect(capturedDrivers()).toHaveLength(0);
  });

  it('refuses agent:history and agent:approve as UNSUPPORTED with the reqId echoed', async () => {
    const a = await connect();
    const base = a.frames.length;

    send(a, { type: 'agent:history', agentId: 'a1', beforeSeq: 10, reqId: 'h1' });
    send(a, { type: 'agent:approve', agentId: 'a1', gateId: 'g1', decision: 'approve', reqId: 'h2' });

    await vi.waitFor(() => expect(errorsAfter(a, base)).toHaveLength(2));
    expect(errorsAfter(a, base).map((e) => [e.code, e.reqId])).toEqual([
      ['UNSUPPORTED', 'h1'],
      ['UNSUPPORTED', 'h2'],
    ]);
  });
});
