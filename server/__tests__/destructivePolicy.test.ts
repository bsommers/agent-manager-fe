// Destructive-operation policy over the real gateway (plan 06-07). tmux and the drivers are mocked,
// the port is always 0, and no real tmux session is ever touched. The walk iterates the operations
// catalog, so a second destructive operation is exercised without editing it.
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
import { listOperations } from '@agent-manager/protocol';
import type { OperationName, OperationSpec } from '@agent-manager/protocol';
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

const spies: Array<{ mockRestore: () => void }> = [];
const spyConsole = (method: 'warn' | 'log' | 'error') => {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  spies.push(spy);
  return spy;
};

let pingSeq = 5000;
async function pong(c: Client): Promise<void> {
  const t = ++pingSeq;
  send(c, { type: 'ping', t });
  await vi.waitFor(() => expect(c.frames.some((f) => f.type === 'pong' && f.t === t)).toBe(true), {
    timeout: 2000,
  });
}

/** A fresh connection's first frame is the current roster (agent:init_list). */
async function rosterIds(): Promise<string[]> {
  const fresh = await connect();
  return fresh.frames[0].agents.map((a: any) => a.id);
}

/** Every destructive operation in the catalog, with its confirm parameter. */
const destructive = (): Array<[OperationName, OperationSpec]> =>
  listOperations().filter(([, op]) => op.destructive);

/** The WS message for a destructive operation, built from its ws binding. */
function wsMessage(op: OperationSpec, agentId: string, confirm?: unknown): Record<string, unknown> | null {
  const ws = op.ws;
  if ('none' in ws) return null;
  const msg: Record<string, unknown> = { type: ws.type, agentId };
  if (ws.when !== undefined) msg[ws.when.field] = ws.when.is;
  if (confirm !== undefined) msg[op.confirmParam as string] = confirm;
  return msg;
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
    if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) c.ws.terminate();
  }
  handle.wss.close();
  await new Promise<void>((resolve) => handle.server.close(() => resolve()));
});

describe('catalog walk: destructive operations over WS', () => {
  it('finds at least one destructive operation, each with a confirmParam', () => {
    expect(destructive().length).toBeGreaterThan(0);
    for (const [, op] of destructive()) expect(typeof op.confirmParam).toBe('string');
  });

  for (const [name, op] of destructive()) {
    if ('none' in op.ws) continue;

    describe(`${name}`, () => {
      it.each([
        ['absent', undefined],
        ['false', false],
        ['the string "true"', 'true'],
        ['the number 1', 1],
      ])('refuses confirm %s: one USAGE agent:error to the requester only, nothing runs', async (_n, confirm) => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        const warn = spyConsole('warn');
        const c1 = await connect();
        const c2 = await connect();
        const base1 = c1.frames.length;
        const base2 = c2.frames.length;

        send(c1, wsMessage(op, a.id, confirm)!);
        await vi.waitFor(() => expect(c1.frames.filter((f) => f.type === 'agent:error')).toHaveLength(1), {
          timeout: 2000,
        });
        await pong(c1);
        await pong(c2);

        const errors = c1.frames.slice(base1).filter((f) => f.type === 'agent:error');
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'USAGE', agentId: a.id });
        expect(c2.frames.slice(base2).filter((f) => f.type === 'agent:error')).toHaveLength(0);
        expect(c1.frames.slice(base1).filter((f) => f.type === 'agent:removed')).toHaveLength(0);
        expect(killMock).not.toHaveBeenCalled();
        expect(capturedDrivers()[0].close).not.toHaveBeenCalled();
        expect(await rosterIds()).toEqual([a.id]);
      });

      it('refuses with exactly one warning line that does not carry the full 128-character id', async () => {
        const warn = spyConsole('warn');
        const c1 = await connect();
        const longId = 'w'.repeat(128);
        send(c1, wsMessage(op, longId)!);
        await vi.waitFor(() => expect(c1.frames.some((f) => f.type === 'agent:error')).toBe(true), { timeout: 2000 });
        await pong(c1);
        const policyLines = warn.mock.calls.map((x) => String(x[0]));
        expect(policyLines).toHaveLength(1);
        expect(policyLines[0]).toContain('w'.repeat(64));
        expect(policyLines[0]).not.toContain('w'.repeat(65));
      });

      it('with an unknown agent id the gate comes first: USAGE without confirm, NOT_FOUND with it', async () => {
        spyConsole('warn');
        const c1 = await connect();
        send(c1, wsMessage(op, 'agent-ghost')!);
        send(c1, wsMessage(op, 'agent-ghost', true)!);
        await vi.waitFor(() => expect(c1.frames.filter((f) => f.type === 'agent:error')).toHaveLength(2), {
          timeout: 2000,
        });
        const codes = c1.frames.filter((f) => f.type === 'agent:error').map((f) => f.code);
        expect(codes).toEqual(['USAGE', 'NOT_FOUND']);
        expect(killMock).not.toHaveBeenCalled();
      });

      it('does not cache a refusal: the same reqId then succeeds with confirm true', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        spyConsole('warn');
        spyConsole('log');
        const c1 = await connect();
        const base = c1.frames.length;
        send(c1, { ...wsMessage(op, a.id)!, reqId: 'req-walk-1' });
        await vi.waitFor(() => expect(c1.frames.slice(base).some((f) => f.type === 'agent:error')).toBe(true), {
          timeout: 2000,
        });
        expect(killMock).not.toHaveBeenCalled();
        send(c1, { ...wsMessage(op, a.id, true)!, reqId: 'req-walk-1' });
        await vi.waitFor(() => expect(killMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
        await vi.waitFor(() => expect(c1.frames.slice(base).some((f) => f.type === 'agent:ack')).toBe(true), {
          timeout: 2000,
        });
      });

      it('with confirm true ends the session, closes the driver and removes only that agent', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        const b = handle.sessionManager.createAgent('beta', 'tmux', 'qa_b');
        spyConsole('log');
        const c1 = await connect();
        const base = c1.frames.length;
        send(c1, wsMessage(op, a.id, true)!);
        await vi.waitFor(
          () => expect(c1.frames.slice(base).filter((f) => f.type === 'agent:removed')).toHaveLength(1),
          { timeout: 2000 }
        );
        expect(killMock).toHaveBeenCalledTimes(1);
        expect(killMock).toHaveBeenCalledWith('qa_a');
        expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
        expect(capturedDrivers()[1].close).not.toHaveBeenCalled();
        expect(await rosterIds()).toEqual([b.id]);
      });
    });
  }

  it('a plain close (non-destructive agent.kill sibling) needs no confirm and never touches tmux', async () => {
    const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
    const c1 = await connect();
    const base = c1.frames.length;
    send(c1, { type: 'agent:kill', agentId: a.id });
    await vi.waitFor(
      () => expect(c1.frames.slice(base).filter((f) => f.type === 'agent:removed')).toHaveLength(1),
      { timeout: 2000 }
    );
    expect(killMock).not.toHaveBeenCalled();
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
  });
});
