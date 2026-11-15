// Shared helpers for the auth tests (plan 08-02). Each test file declares its own hoisted vi.mock
// calls for TmuxDiscovery, TmuxDriver and tmuxKill; nothing here mocks anything.
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';
import { WebSocket } from 'ws';
import { bootstrap } from '../../src/index.js';
import type { BootstrapOptions } from '../../src/index.js';

export const TOKEN = 'tok-0123456789abcdef-0123456789ab';
export const CANARY = 'CANARY-s3cr3t-Zk9qWx7PvLm2Rt8Bn4Yd';
export const CANARY_HEX = createHash('sha256').update(CANARY, 'utf8').digest('hex');
export const CANARY_PREFIX = CANARY.slice(0, 12);
export const WRONG_SAME_LENGTH = 'x'.repeat(TOKEN.length);

export type Handle = Awaited<ReturnType<typeof bootstrap>>;
export type Frame = { type: string; [key: string]: any };

export interface Gateway {
  handle: Handle;
  port: number;
  close: () => Promise<void>;
}

const open: Gateway[] = [];

/** Starts a gateway on port 0. Pass `{ token: undefined }` explicitly for the no-auth mode. */
export async function startGateway(options: BootstrapOptions = {}, host = '127.0.0.1'): Promise<Gateway> {
  const handle = await bootstrap(0, host, options);
  const port = (handle.server.address() as AddressInfo).port;
  const gw: Gateway = {
    handle,
    port,
    close: async () => {
      for (const c of handle.wss.clients) c.terminate();
      await new Promise<void>((resolve) => handle.wss.close(() => resolve()));
      await new Promise<void>((resolve) => handle.server.close(() => resolve()));
    },
  };
  open.push(gw);
  return gw;
}

export async function closeAllGateways(): Promise<void> {
  while (open.length) await open.pop()!.close();
}

export interface CloseInfo {
  code: number;
  reason: string;
}

export interface TestClient {
  ws: WebSocket;
  frames: Frame[];
  raw: string[];
  /** Resolves when the socket closes. */
  closed: Promise<CloseInfo>;
  opened: Promise<void>;
  send: (msg: object | string) => void;
}

const clients: TestClient[] = [];

/** Opens a socket without waiting for any frame. Frames and the close event are recorded. */
export function openClient(
  port: number,
  opts: { headers?: Record<string, string>; path?: string } = {}
): TestClient {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? '/ws'}`, { headers: opts.headers });
  const frames: Frame[] = [];
  const raw: string[] = [];
  ws.on('message', (data) => {
    const text = data.toString();
    raw.push(text);
    frames.push(JSON.parse(text));
  });
  const closed = new Promise<CloseInfo>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  opened.catch(() => {});
  const client: TestClient = {
    ws,
    frames,
    raw,
    closed,
    opened,
    send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
  };
  clients.push(client);
  return client;
}

export function closeAllClients(): void {
  while (clients.length) {
    const c = clients.pop()!;
    if (c.ws.readyState !== WebSocket.CLOSED) c.ws.terminate();
  }
}

export const hello = (token?: string, contract = 1) =>
  token === undefined ? { type: 'hello', contract } : { type: 'hello', contract, token };

/** Opens, sends a hello and waits for the first two frames (hello_ack, agent:init_list). */
export async function authenticate(
  port: number,
  token: string = TOKEN,
  opts: { headers?: Record<string, string> } = {}
): Promise<TestClient> {
  const c = openClient(port, opts);
  await c.opened;
  c.send(hello(token));
  await vi.waitFor(
    () => {
      if (c.frames.length < 2) throw new Error(`waiting for hello_ack + roster, have ${c.frames.length}`);
    },
    { timeout: 2000 }
  );
  return c;
}

/** A short pause used to prove that nothing arrives. */
export const quiet = (ms = 120) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

/** One raw HTTP request; adds no headers of its own beyond Host. */
export function request(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string | Buffer } = {}
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: opts.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any;
          try {
            json = text === '' ? undefined : JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A manually advanced clock for the throttle. */
export function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Tiny throttle limits with an injected clock. */
export function tinyThrottle(clock: { now: () => number }) {
  return { maxFailures: 3, windowMs: 60_000, lockMs: 1000, maxLockMs: 8000, now: clock.now };
}

const installed: Array<{ mockRestore: () => void }> = [];

/** Restores every console spy installed by installConsoleSpies (leaves the file's tmux mocks alone). */
export function restoreConsole(): void {
  while (installed.length) installed.pop()!.mockRestore();
}

/** Spies on every console method and exposes one string dump of all calls. */
export function installConsoleSpies() {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  installed.push(...spies);
  const stringify = (arg: unknown): string => {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg) ?? String(arg);
    } catch {
      return String(arg);
    }
  };
  return {
    spies,
    dump: () =>
      spies
        .flatMap((s) => s.mock.calls)
        .map((call) => call.map(stringify).join(' '))
        .join('\n'),
    calls: (method: (typeof methods)[number]) => spies[methods.indexOf(method)].mock.calls,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

/** Which of the canary, its SHA-256 hex and its 12-character prefix appear in the text. */
export function secretsIn(text: string): string[] {
  const found: string[] = [];
  for (const [label, needle] of [
    ['canary', CANARY],
    ['hex', CANARY_HEX],
    ['prefix', CANARY_PREFIX],
  ] as const) {
    if (text.includes(needle)) found.push(label);
  }
  return found;
}
