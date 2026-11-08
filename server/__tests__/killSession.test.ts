// Gateway kill-session flow over a real WebSocket (plan 09.1-03). tmux is mocked:
// no real tmux session is ever touched.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

interface CapturedDriver {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  session: string;
}

const drivers = vi.hoisted(() => [] as unknown[]);

vi.mock('../src/services/TmuxDiscovery.js', () => ({
  discoverTmuxSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/TmuxDriver.js', () => ({
  TmuxDriver: vi.fn().mockImplementation(function (
    session: string,
    _cols: number,
    _rows: number,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ) {
    const driver = { write: vi.fn(), resize: vi.fn(), close: vi.fn(), onData, onExit, session };
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
const snapshotsAfter = (c: Client, from: number) =>
  c.frames.slice(from).filter((f) => f.type === 'agent:init_list');
const errorsAfter = (c: Client, from: number) =>
  c.frames.slice(from).filter((f) => f.type === 'agent:error');

// Sentinel: a plain kill of an unknown id yields a snapshot of the current roster.
async function rosterNow(c: Client): Promise<Frame> {
  const base = c.frames.length;
  send(c, { type: 'agent:kill', agentId: 'no-such-agent' });
  await vi.waitFor(() => expect(snapshotsAfter(c, base)).toHaveLength(1), { timeout: 2000 });
  return snapshotsAfter(c, base)[0];
}

beforeEach(async () => {
  drivers.length = 0;
  killMock.mockClear();
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

describe('agent:kill with killSession over a real WebSocket', () => {
  it('confirmed: ends the tmux session, closes the driver and announces one snapshot', async () => {
    const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
    const b = handle.sessionManager.createAgent('beta', 'tmux', 'qa_b');
    const c1 = await connect();
    const c2 = await connect();
    const base1 = c1.frames.length;
    const base2 = c2.frames.length;

    send(c1, { type: 'agent:kill', agentId: a.id, killSession: true, confirm: true });

    await vi.waitFor(() => expect(snapshotsAfter(c1, base1)).toHaveLength(1), { timeout: 2000 });
    await vi.waitFor(() => expect(snapshotsAfter(c2, base2)).toHaveLength(1), { timeout: 2000 });
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith('qa_a');
    const [da, db] = capturedDrivers();
    expect(da.close).toHaveBeenCalledTimes(1);
    expect(db.close).not.toHaveBeenCalled();
    expect(snapshotsAfter(c1, base1)[0].agents.map((x: any) => x.id)).toEqual([b.id]);
    expect(snapshotsAfter(c2, base2)[0].agents.map((x: any) => x.id)).toEqual([b.id]);
    expect(errorsAfter(c1, base1)).toHaveLength(0);
    expect(errorsAfter(c2, base2)).toHaveLength(0);
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['the number 1', 1],
  ])('refused when confirm is %s: typed USAGE to the requester only, nothing runs', async (_n, confirm) => {
    const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
    const c1 = await connect();
    const c2 = await connect();
    const base1 = c1.frames.length;
    const base2 = c2.frames.length;

    const frame: Record<string, unknown> = { type: 'agent:kill', agentId: a.id, killSession: true };
    if (confirm !== undefined) frame.confirm = confirm;
    send(c1, frame);

    await vi.waitFor(() => expect(errorsAfter(c1, base1)).toHaveLength(1), { timeout: 2000 });
    const err = errorsAfter(c1, base1)[0];
    expect(err.code).toBe('USAGE');
    expect(err.retryable).toBe(false);
    expect(err.agentId).toBe(a.id);
    expect(parseServerMessage(err).ok).toBe(true);

    // The sentinel proves nothing changed and gives the second client time to receive anything stray.
    const snap = await rosterNow(c1);
    expect(snap.agents.map((x: any) => x.id)).toEqual([a.id]);
    expect(errorsAfter(c1, base1)).toHaveLength(1);
    expect(errorsAfter(c2, base2)).toHaveLength(0);
    expect(snapshotsAfter(c1, base1)).toHaveLength(1); // only the sentinel's
    expect(killMock).not.toHaveBeenCalled();
    expect(capturedDrivers()[0].close).not.toHaveBeenCalled();
  });

  it('a plain kill never calls tmux and needs no confirm', async () => {
    const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
    const c1 = await connect();
    const base = c1.frames.length;

    send(c1, { type: 'agent:kill', agentId: a.id });

    await vi.waitFor(() => expect(snapshotsAfter(c1, base)).toHaveLength(1), { timeout: 2000 });
    expect(snapshotsAfter(c1, base)[0].agents).toEqual([]);
    expect(killMock).not.toHaveBeenCalled();
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
    expect(errorsAfter(c1, base)).toHaveLength(0);
  });

  it('confirm true without killSession is also a plain close', async () => {
    const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
    const c1 = await connect();
    const base = c1.frames.length;

    send(c1, { type: 'agent:kill', agentId: a.id, confirm: true });

    await vi.waitFor(() => expect(snapshotsAfter(c1, base)).toHaveLength(1), { timeout: 2000 });
    expect(snapshotsAfter(c1, base)[0].agents).toEqual([]);
    expect(killMock).not.toHaveBeenCalled();
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
  });
});
