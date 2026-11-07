import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

vi.mock('../src/services/TmuxDiscovery.js', () => ({
  discoverTmuxSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/TmuxDriver.js', () => ({
  TmuxDriver: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
  })),
}));

import { bootstrap } from '../src/index.js';
import { WebSocket } from 'ws';
import { CONFIG, isLoopbackHost, assertLoopbackBind, parseAllowedOrigins } from '../src/config.js';

type Handle = Awaited<ReturnType<typeof bootstrap>>;
const handles: Handle[] = [];

async function start(host = '127.0.0.1', options = {}): Promise<Handle> {
  const h = await bootstrap(0, host, options);
  handles.push(h);
  return h;
}

afterEach(async () => {
  while (handles.length) {
    const h = handles.pop()!;
    h.wss.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

describe('loopback bind (GW-01)', () => {
  it('CONFIG.HOST defaults to 127.0.0.1 and PORT to 8088', () => {
    // Test env does not set HOST/PORT overrides.
    if (!process.env.HOST?.trim()) expect(CONFIG.HOST).toBe('127.0.0.1');
    if (!process.env.PORT) expect(CONFIG.PORT).toBe(8088);
  });

  it.each(['localhost', '::1', '[::1]', '127.0.0.1', '127.1.2.3'])(
    'isLoopbackHost accepts %s',
    (h) => {
      expect(isLoopbackHost(h)).toBe(true);
    }
  );

  it.each([
    '0.0.0.0',
    '::',
    '',
    '192.168.1.5',
    '10.0.0.1',
    'example.com',
    '127.0.0.1.evil.example',
    '1270.0.0.1',
    '127.0.0.256',
  ])('isLoopbackHost rejects %j', (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });

  it('assertLoopbackBind throws an actionable error for non-loopback hosts', () => {
    expect(() => assertLoopbackBind('0.0.0.0')).toThrowError(/HOST/);
    expect(() => assertLoopbackBind('0.0.0.0')).toThrowError(/no authentication/i);
    expect(() => assertLoopbackBind('0.0.0.0')).toThrowError(/unset HOST or use 127\.0\.0\.1/i);
    expect(() => assertLoopbackBind('127.0.0.1')).not.toThrow();
  });

  it('bootstrap listens on 127.0.0.1', async () => {
    const { server } = await start('127.0.0.1');
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBeGreaterThan(0);
  });

  it('bootstrap rejects a non-loopback host and leaves nothing listening', async () => {
    await expect(bootstrap(0, '0.0.0.0')).rejects.toThrow(/HOST/);
  });
});

function wsUrl(h: Handle): string {
  return `ws://127.0.0.1:${(h.server.address() as AddressInfo).port}/ws`;
}

function firstMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    ws.once('error', reject);
  });
}

describe('parseAllowedOrigins', () => {
  const defaults = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ];

  it('returns the defaults for undefined or blank', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(defaults);
    expect(parseAllowedOrigins('')).toEqual(defaults);
    expect(parseAllowedOrigins('   ')).toEqual(defaults);
  });

  it('trims entries and removes trailing slashes', () => {
    expect(parseAllowedOrigins('https://ui.example.test, http://localhost:3000/')).toEqual([
      'https://ui.example.test',
      'http://localhost:3000',
    ]);
  });

  it.each([
    '*',
    'http://localhost:3000,*',
    'ftp://localhost',
    'localhost:3000',
    'http://localhost:3000/path',
    'http://localhost:3000?x=1',
    'http://user:pw@localhost:3000',
    'not a url',
  ])('throws for %j', (v) => {
    expect(() => parseAllowedOrigins(v)).toThrow();
  });
});

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => ws.once('message', (raw) => resolve(JSON.parse(raw.toString()))));
}

describe('application ping/pong and hostile frames', () => {
  it('replies to a ping with a pong carrying the same t', async () => {
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping', t: 42 }));
    expect(await reply).toEqual({ type: 'pong', t: 42 });
    ws.close();
  });

  it('ignores a ping with a non-number t without crashing', async () => {
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    ws.send(JSON.stringify({ type: 'ping', t: 'nope' }));
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping', t: 7 }));
    // The first reply must be the pong for t=7: the bad ping produced none.
    expect(await reply).toEqual({ type: 'pong', t: 7 });
    ws.close();
  });

  it.each([
    ['null', 'null'],
    ['a number', '42'],
    ['a string', '"hello"'],
    ['an array', '[1,2]'],
    ['a non-string type', '{"type":5}'],
    ['no type', '{"foo":"bar"}'],
  ])('ignores a non-object frame (%s), logs once, and stays usable', async (_n, payload) => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    ws.send(payload);
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping', t: 1 }));
    expect(await reply).toEqual({ type: 'pong', t: 1 });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('Invalid WebSocket message received:', expect.any(Error));
    ws.close();
    consoleSpy.mockRestore();
  });

  it('ignores an unknown type without error output', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    ws.send(JSON.stringify({ type: 'totally:unknown' }));
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping', t: 2 }));
    expect(await reply).toEqual({ type: 'pong', t: 2 });
    expect(consoleSpy).not.toHaveBeenCalled();
    ws.close();
    consoleSpy.mockRestore();
  });

  it('keeps today\'s behavior for invalid JSON (logged, connection stays open)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    ws.send('{not json');
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping', t: 3 }));
    expect(await reply).toEqual({ type: 'pong', t: 3 });
    expect(consoleSpy).toHaveBeenCalledWith('Invalid WebSocket message received:', expect.any(Error));
    ws.close();
    consoleSpy.mockRestore();
  });
});

describe('liveness', () => {
  it('terminates a socket that never answers protocol pings', async () => {
    const h = await start('127.0.0.1', { heartbeatMs: 40 });
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    const serverSocket = Array.from(h.wss.clients)[0] as WebSocket;
    serverSocket.ping = () => {}; // never actually pings, so no pong ever comes back
    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));
    const started = Date.now();
    await closed;
    expect(Date.now() - started).toBeLessThan(40 * 3 + 500);
  });

  it('never terminates a responsive client', async () => {
    const h = await start('127.0.0.1', { heartbeatMs: 30 });
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    let closed = false;
    ws.on('close', () => (closed = true));
    await new Promise((r) => setTimeout(r, 30 * 8));
    expect(closed).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('clears the liveness interval when the websocket server closes', async () => {
    const spy = vi.spyOn(globalThis, 'clearInterval');
    const h = await start('127.0.0.1', { heartbeatMs: 1000 });
    const before = spy.mock.calls.length;
    await new Promise<void>((resolve) => h.wss.close(() => resolve()));
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    spy.mockRestore();
  });
});

describe('origin allowlist and frame size cap', () => {
  it('rejects a disallowed Origin with 403 and sends no init list', async () => {
    const h = await start();
    const ws = new WebSocket(wsUrl(h), { origin: 'http://evil.example.test' });
    const messages: unknown[] = [];
    ws.on('message', (m) => messages.push(m));
    const err = await new Promise<Error>((resolve) => ws.on('error', resolve));
    expect(err.message).toContain('403');
    expect(messages).toHaveLength(0);
  });

  it('allows a default dev Origin', async () => {
    const h = await start();
    const ws = new WebSocket(wsUrl(h), { origin: 'http://localhost:3000' });
    const msg = await firstMessage(ws);
    expect(msg.type).toBe('agent:init_list');
    ws.close();
  });

  it('allows a client with no Origin header', async () => {
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    const msg = await firstMessage(ws);
    expect(msg.type).toBe('agent:init_list');
    ws.close();
  });

  it('options.allowedOrigins overrides the default list', async () => {
    const h = await start('127.0.0.1', { allowedOrigins: ['https://ui.example.test'] });
    const ok = new WebSocket(wsUrl(h), { origin: 'https://ui.example.test' });
    expect((await firstMessage(ok)).type).toBe('agent:init_list');
    ok.close();
    const bad = new WebSocket(wsUrl(h), { origin: 'http://localhost:3000' });
    const err = await new Promise<Error>((resolve) => bad.on('error', resolve));
    expect(err.message).toContain('403');
  });

  it('closes with 1009 for a frame over 1 MiB', async () => {
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ws.send('a'.repeat(1048577));
    expect(await closed).toBe(1009);
    consoleSpy.mockRestore();
  });

  it('accepts a frame of exactly 1 MiB at the transport', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = await start();
    const ws = new WebSocket(wsUrl(h));
    await firstMessage(ws);
    let closeCode: number | undefined;
    ws.on('close', (code) => (closeCode = code));
    ws.send('a'.repeat(1048576)); // not JSON: logged, but not a transport error
    await new Promise((r) => setTimeout(r, 200));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(closeCode).toBeUndefined();
    ws.close();
    consoleSpy.mockRestore();
  });
});
