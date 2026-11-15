// WebSocket authentication over a real server (plan 08-02). Drivers and tmux are mocked; the port is 0.
import { describe, it, expect, afterEach, vi } from 'vitest';

const drivers = vi.hoisted(() => [] as Array<{ onData: (data: string) => void }>);

vi.mock('../src/services/TmuxDiscovery.js', () => ({
  discoverTmuxSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/TmuxDriver.js', () => ({
  TmuxDriver: vi.fn().mockImplementation(function (
    _session: string,
    _cols: number,
    _rows: number,
    onData: (data: string) => void,
    _onExit: (code: number) => void
  ) {
    const driver = { write: vi.fn(), resize: vi.fn(), close: vi.fn(), onData };
    drivers.push(driver);
    return driver;
  }),
}));

vi.mock('../src/services/tmuxKill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/tmuxKill.js')>();
  return { ...actual, killTmuxSession: vi.fn().mockResolvedValue('killed') };
});

import { CONTRACT_VERSION, parseServerMessage } from '@agent-manager/protocol';
import {
  TOKEN,
  WRONG_SAME_LENGTH,
  makeClock,
  tinyThrottle,
  authenticate,
  bearer,
  closeAllClients,
  closeAllGateways,
  hello,
  installConsoleSpies,
  openClient,
  quiet,
  request,
  restoreConsole,
  startGateway,
} from './helpers/authHarness.js';

afterEach(async () => {
  closeAllClients();
  await closeAllGateways();
  restoreConsole();
  delete process.env.AGENT_MANAGER_TOKEN;
  drivers.length = 0;
});

describe('tracer: hello with a token yields hello_ack then the roster', () => {
  it('sends nothing before the hello, then hello_ack FIRST and agent:init_list second', async () => {
    const gw = await startGateway({ token: TOKEN, epoch: 'ep-test' });
    const c = openClient(gw.port);
    await c.opened;
    await quiet();
    expect(c.frames).toEqual([]);

    c.send(hello(TOKEN));
    await vi.waitFor(() => expect(c.frames.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(c.frames.map((f) => f.type).slice(0, 2)).toEqual(['hello_ack', 'agent:init_list']);

    const ack = c.frames[0];
    expect(parseServerMessage(ack).ok).toBe(true);
    expect(ack.contract).toBe(CONTRACT_VERSION);
    expect(ack.auth).toEqual({ required: true });
    expect(ack.epoch).toBe('ep-test');
    expect(c.frames.filter((f) => f.type === 'agent:init_list')).toHaveLength(1);
  });

  it('reports the same epoch over GET /api/health', async () => {
    const gw = await startGateway({ token: TOKEN, epoch: 'ep-test' });
    const res = await request(gw.port, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.json.epoch).toBe('ep-test');
  });

  it('shares one random epoch between hello_ack and health when none is given', async () => {
    const gw = await startGateway({ token: TOKEN });
    const c = await authenticate(gw.port);
    const res = await request(gw.port, 'GET', '/api/health', { headers: bearer(TOKEN) });
    expect(typeof c.frames[0].epoch).toBe('string');
    expect(res.json.epoch).toBe(c.frames[0].epoch);
  });

  it.each([
    ['same length', WRONG_SAME_LENGTH],
    ['shorter', 'short'],
    ['longer', TOKEN + 'more'],
  ])('closes 4401 unauthenticated for a wrong token (%s) with zero frames', async (_label, wrong) => {
    const gw = await startGateway({ token: TOKEN });
    const c = openClient(gw.port);
    await c.opened;
    c.send(hello(wrong));
    const closed = await c.closed;
    expect(closed).toEqual({ code: 4401, reason: 'unauthenticated' });
    expect(c.frames).toEqual([]);
  });
});

describe('no token configured', () => {
  it('sends agent:init_list at once and answers a hello with hello_ack and no second roster', async () => {
    const gw = await startGateway({ token: undefined });
    const c = openClient(gw.port);
    await c.opened;
    await vi.waitFor(() => expect(c.frames.length).toBe(1), { timeout: 2000 });
    expect(c.frames[0].type).toBe('agent:init_list');

    c.send(hello());
    await vi.waitFor(() => expect(c.frames.length).toBe(2), { timeout: 2000 });
    expect(c.frames[1].type).toBe('hello_ack');
    expect(c.frames[1].auth).toEqual({ required: false });
    await quiet();
    expect(c.frames.filter((f) => f.type === 'agent:init_list')).toHaveLength(1);
  });

  it('an explicit undefined token beats a valid AGENT_MANAGER_TOKEN in the environment', async () => {
    process.env.AGENT_MANAGER_TOKEN = TOKEN;
    const gw = await startGateway({ token: undefined });
    const c = openClient(gw.port);
    await c.opened;
    await vi.waitFor(() => expect(c.frames.length).toBe(1), { timeout: 2000 });
    expect(c.frames[0].type).toBe('agent:init_list');
    const res = await request(gw.port, 'GET', '/api/agents');
    expect(res.status).toBe(200);
  });
});

describe('token from the environment', () => {
  it('enforces auth when options carry no token key and AGENT_MANAGER_TOKEN is valid', async () => {
    process.env.AGENT_MANAGER_TOKEN = TOKEN;
    const gw = await startGateway();
    const c = openClient(gw.port);
    await c.opened;
    await quiet();
    expect(c.frames).toEqual([]);
    c.send(hello(TOKEN));
    await vi.waitFor(() => expect(c.frames.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(c.frames[0].type).toBe('hello_ack');
  });

  it('rejects an invalid environment token naming the variable and never the value', async () => {
    const bad = 'b'.repeat(23);
    process.env.AGENT_MANAGER_TOKEN = bad;
    const err = await startGateway().then(
      () => undefined,
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('AGENT_MANAGER_TOKEN');
    expect(err!.message).not.toContain(bad);
  });

  it.each([['unset', undefined], ['empty', '']])('behaves as no auth when the variable is %s', async (_l, value) => {
    if (value !== undefined) process.env.AGENT_MANAGER_TOKEN = value;
    const gw = await startGateway();
    const c = openClient(gw.port);
    await c.opened;
    await vi.waitFor(() => expect(c.frames.length).toBe(1), { timeout: 2000 });
    expect(c.frames[0].type).toBe('agent:init_list');
  });
});

describe('bind policy', () => {
  it('refuses a non-loopback HOST without a token', async () => {
    const err = await startGateway({ token: undefined }, '0.0.0.0').then(
      () => undefined,
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/HOST/);
    expect(err!.message).toMatch(/AGENT_MANAGER_TOKEN/);
  });

  it('refuses a non-loopback HOST with an invalid token', async () => {
    await expect(startGateway({ token: 'b'.repeat(23) }, '0.0.0.0')).rejects.toThrow(/AGENT_MANAGER_TOKEN/);
  });

  it('allows a non-loopback HOST with a valid token', async () => {
    const gw = await startGateway({ token: TOKEN }, '0.0.0.0');
    expect(gw.port).toBeGreaterThan(0);
  });

  it('never needs a token on loopback', async () => {
    const gw = await startGateway({ token: undefined }, '127.0.0.1');
    expect(gw.port).toBeGreaterThan(0);
  });
});

describe('post-auth hello', () => {
  it('answers another hello_ack in token mode with no extra roster and no token re-check', async () => {
    const gw = await startGateway({ token: TOKEN, epoch: 'ep-x' });
    const c = await authenticate(gw.port);
    const base = c.frames.length;
    c.send(hello(undefined));
    await vi.waitFor(() => expect(c.frames.length).toBe(base + 1), { timeout: 2000 });
    expect(c.frames[base].type).toBe('hello_ack');
    expect(c.frames[base].epoch).toBe('ep-x');
    expect(c.ws.readyState).toBe(c.ws.OPEN);
    await quiet();
    expect(c.frames.filter((f) => f.type === 'agent:init_list')).toHaveLength(1);
  });

  it('answers a hello for another contract with the gateway contract and does not close', async () => {
    const gw = await startGateway({ token: TOKEN });
    const c = await authenticate(gw.port);
    const base = c.frames.length;
    c.send(hello(TOKEN, 99));
    await vi.waitFor(() => expect(c.frames.length).toBe(base + 1), { timeout: 2000 });
    expect(c.frames[base].type).toBe('hello_ack');
    expect(c.frames[base].contract).toBe(CONTRACT_VERSION);
    expect(c.ws.readyState).toBe(c.ws.OPEN);
  });

  it('replies with agent:error USAGE for a hello that fails the validator, without closing', async () => {
    const gw = await startGateway({ token: TOKEN });
    const c = await authenticate(gw.port);
    const base = c.frames.length;
    c.send({ type: 'hello' });
    await vi.waitFor(() => expect(c.frames.length).toBe(base + 1), { timeout: 2000 });
    expect(c.frames[base].type).toBe('agent:error');
    expect(c.frames[base].code).toBe('USAGE');
    expect(c.ws.readyState).toBe(c.ws.OPEN);
  });

  it('keeps answering pings after authentication', async () => {
    const gw = await startGateway({ token: TOKEN });
    const c = await authenticate(gw.port);
    c.send({ type: 'ping', t: 7 });
    await vi.waitFor(() => expect(c.frames.some((f) => f.type === 'pong' && f.t === 7)).toBe(true), {
      timeout: 2000,
    });
  });
});

describe('log shape', () => {
  it('logs a non-JSON frame with the original first argument and an Error second argument', async () => {
    const gw = await startGateway({ token: undefined });
    const spies = installConsoleSpies();
    const c = openClient(gw.port);
    await c.opened;
    await vi.waitFor(() => expect(c.frames.length).toBe(1), { timeout: 2000 });
    c.send('not json');
    await vi.waitFor(() => expect(spies.calls('error').length).toBe(1), { timeout: 2000 });
    expect(spies.calls('error')[0][0]).toBe('Invalid WebSocket message received:');
    expect(spies.calls('error')[0][1]).toBeInstanceOf(Error);
  });
});

describe('hello deadline', () => {
  it('closes a silent client 4401 near the deadline with zero frames', async () => {
    const gw = await startGateway({ token: TOKEN, helloTimeoutMs: 150 });
    const started = Date.now();
    const c = openClient(gw.port);
    await c.opened;
    const closed = await c.closed;
    expect(closed).toEqual({ code: 4401, reason: 'unauthenticated' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(c.frames).toEqual([]);
  });

  it('does not close a client that authenticated in time', async () => {
    const gw = await startGateway({ token: TOKEN, helloTimeoutMs: 150 });
    const c = await authenticate(gw.port);
    await quiet(350);
    expect(c.ws.readyState).toBe(c.ws.OPEN);
  });

  it('leaves no error output and no stray socket when the client closes before the deadline', async () => {
    const spies = installConsoleSpies();
    const gw = await startGateway({ token: TOKEN, helloTimeoutMs: 150 });
    const c = openClient(gw.port);
    await c.opened;
    c.ws.close(1000);
    await c.closed;
    await quiet(300);
    expect(spies.calls('error')).toHaveLength(0);
    expect(gw.handle.wss.clients.size).toBe(0);
  });
});

const preAuthFrames: Array<[string, () => string]> = [
  ['a ping first', () => JSON.stringify({ type: 'ping', t: 1 })],
  [
    'an agent:create first',
    () => JSON.stringify({ type: 'agent:create', name: 'pre', mode: 'tmux', targetHost: 'qa_pre' }),
  ],
  ['malformed JSON', () => '{"type":"hello",'],
  ['the JSON text null', () => 'null'],
  ['an array', () => '[1,2,3]'],
  ['an object with no type', () => '{"contract":1}'],
  ['a hello with no contract', () => JSON.stringify({ type: 'hello', token: TOKEN })],
  ['a hello with a 513 character token', () => JSON.stringify(hello('t'.repeat(513)))],
  ['a hello whose token has a control character', () => JSON.stringify(hello(`${TOKEN}\u0001`))],
  ['an oversize but otherwise perfect hello', () => JSON.stringify(hello(TOKEN)) + ' '.repeat(16385)],
];

describe('pre-auth rules', () => {
  it.each(preAuthFrames)('closes 4401 with no frame for %s', async (_label, make) => {
    const gw = await startGateway({ token: TOKEN });
    const c = openClient(gw.port);
    await c.opened;
    c.send(make());
    expect(await c.closed).toEqual({ code: 4401, reason: 'unauthenticated' });
    expect(c.frames).toEqual([]);
    expect(gw.handle.sessionManager.getAgentCount()).toBe(0);
  });

  it('accepts a hello of exactly 16384 bytes', async () => {
    const gw = await startGateway({ token: TOKEN });
    const base = JSON.stringify(hello(TOKEN));
    const c = openClient(gw.port);
    await c.opened;
    c.send(base + ' '.repeat(16384 - Buffer.byteLength(base)));
    await vi.waitFor(() => expect(c.frames.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(c.frames[0].type).toBe('hello_ack');
  });

  it('ignores every further frame once a reject has started the close', async () => {
    const gw = await startGateway({ token: TOKEN });
    const spies = installConsoleSpies();
    const c = openClient(gw.port);
    await c.opened;
    for (let i = 0; i < 20; i++) c.send('junk');
    expect(await c.closed).toEqual({ code: 4401, reason: 'unauthenticated' });
    expect(spies.dump()).toBe('');
  });
});

describe('silence before auth', () => {
  it('shows an unauthenticated socket nothing of what an authenticated client does', async () => {
    const gw = await startGateway({ token: TOKEN, helloTimeoutMs: 600 });
    const a = await authenticate(gw.port);
    const b = openClient(gw.port);
    await b.opened;

    a.send({ type: 'agent:create', name: 'sil', mode: 'tmux', targetHost: 'qa_sil' });
    await vi.waitFor(() => expect(a.frames.some((f) => f.type === 'agent:added')).toBe(true), { timeout: 2000 });
    await vi.waitFor(() => expect(drivers.length).toBe(1), { timeout: 2000 });
    drivers[0].onData('secret terminal output');
    await vi.waitFor(() => expect(a.frames.some((f) => f.type === 'agent:output')).toBe(true), {
      timeout: 2000,
    });

    expect(b.frames).toEqual([]);
    expect(gw.handle.sessionManager.getAgentCount()).toBe(1);
    expect(await b.closed).toEqual({ code: 4401, reason: 'unauthenticated' });
    expect(b.frames).toEqual([]);
  });
});

describe('token in the upgrade URL', () => {
  it('is ignored: no hello means zero frames and 4401', async () => {
    const gw = await startGateway({ token: TOKEN, helloTimeoutMs: 150 });
    const c = openClient(gw.port, { path: `/ws?token=${TOKEN}` });
    await c.opened;
    expect(await c.closed).toEqual({ code: 4401, reason: 'unauthenticated' });
    expect(c.frames).toEqual([]);
  });

  it('does not rescue a hello carrying a wrong token', async () => {
    const gw = await startGateway({ token: TOKEN });
    const c = openClient(gw.port, { path: `/ws?token=${TOKEN}` });
    await c.opened;
    c.send(hello(WRONG_SAME_LENGTH));
    expect((await c.closed).code).toBe(4401);
    expect(c.frames).toEqual([]);
  });
});

describe('throttle', () => {
  async function failOnce(port: number, headers?: Record<string, string>, token = WRONG_SAME_LENGTH) {
    const c = openClient(port, { headers });
    await c.opened;
    c.send(hello(token));
    return c.closed;
  }

  /** Connects and tries a hello; resolves with the close info, or undefined when the socket stayed open. */
  async function attempt(port: number, token: string, headers?: Record<string, string>) {
    const c = openClient(port, { headers });
    await c.opened;
    if (c.ws.readyState === c.ws.OPEN) {
      try {
        c.send(hello(token));
      } catch {
        // already closing
      }
    }
    const first = await Promise.race([c.closed, quiet(300).then(() => undefined)]);
    return { c, closed: first };
  }

  it('locks the key after maxFailures: 4429 with retry-after-ms, even for the right token', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) expect((await failOnce(gw.port)).code).toBe(4401);

    const { c, closed } = await attempt(gw.port, TOKEN);
    expect(closed?.code).toBe(4429);
    expect(closed?.reason).toMatch(/^retry-after-ms=[1-9]\d*$/);
    expect(c.frames).toEqual([]);
  });

  it('lets a correct hello succeed after the lock lapses and resets the key', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) await failOnce(gw.port);
    clock.advance(1500);
    const ok = await authenticate(gw.port);
    expect(ok.frames[0].type).toBe('hello_ack');
    // the success reset the key: two more wrong tokens do not lock it
    await failOnce(gw.port);
    await failOnce(gw.port);
    const again = await authenticate(gw.port);
    expect(again.frames[0].type).toBe('hello_ack');
  });

  it('does not count missing tokens, malformed frames or deadline expiries', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock), helloTimeoutMs: 40 });
    for (let i = 0; i < 4; i++) {
      const missing = openClient(gw.port);
      await missing.opened;
      missing.send(hello(undefined));
      expect((await missing.closed).code).toBe(4401);

      const junk = openClient(gw.port);
      await junk.opened;
      junk.send('{{{');
      expect((await junk.closed).code).toBe(4401);

      const silent = openClient(gw.port);
      await silent.opened;
      expect((await silent.closed).code).toBe(4401);
    }
    const ok = await authenticate(gw.port);
    expect(ok.frames[0].type).toBe('hello_ack');
  });

  it('keys per source with trustProxy on: the last X-Forwarded-For entry decides', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, trustProxy: true, throttle: tinyThrottle(clock) });
    const A = { 'x-forwarded-for': '203.0.113.7' };
    const B = { 'x-forwarded-for': '198.51.100.9' };
    for (let i = 0; i < 3; i++) await failOnce(gw.port, A);
    expect((await attempt(gw.port, TOKEN, A)).closed?.code).toBe(4429);
    const b = await authenticate(gw.port, TOKEN, { headers: B });
    expect(b.frames[0].type).toBe('hello_ack');
    // a client cannot dodge its own lock by prepending an entry
    const spoof = { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' };
    expect((await attempt(gw.port, TOKEN, spoof)).closed?.code).toBe(4429);
  });

  it('ignores the forwarded header with trustProxy off: both values share one key', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, trustProxy: false, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) await failOnce(gw.port, { 'x-forwarded-for': '203.0.113.7' });
    const { closed } = await attempt(gw.port, TOKEN, { 'x-forwarded-for': '198.51.100.9' });
    expect(closed?.code).toBe(4429);
  });

  it('closes 4429 with no unhandled error and no console output', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) await failOnce(gw.port);
    const spies = installConsoleSpies();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    process.on('uncaughtException', unhandled);
    try {
      const { closed } = await attempt(gw.port, TOKEN);
      expect(closed?.code).toBe(4429);
      await quiet(100);
    } finally {
      process.off('unhandledRejection', unhandled);
      process.off('uncaughtException', unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
    expect(spies.dump()).toBe('');
  });
});

describe('startup lines', () => {
  const trustHintLines = (calls: unknown[][]) =>
    calls.filter((c) => c.some((a) => typeof a === 'string' && a.includes('AGENT_MANAGER_TRUST_PROXY')));
  const wasNotTest = () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    return () => {
      process.env.NODE_ENV = prev;
    };
  };

  it('logs one proxy hint with a token and trust off, and no line contains the token', async () => {
    const spies = installConsoleSpies();
    const restoreEnv = wasNotTest();
    try {
      await startGateway({ token: TOKEN, trustProxy: false });
    } finally {
      restoreEnv();
    }
    const all = [...spies.calls('log'), ...spies.calls('info'), ...spies.calls('warn')];
    const hints = trustHintLines(all);
    expect(hints).toHaveLength(1);
    expect(String(hints[0][0])).toMatch(/proxy/i);
    expect(String(hints[0][0])).toMatch(/throttle/i);
    expect(spies.dump()).not.toContain(TOKEN);
    expect(spies.dump()).not.toContain(TOKEN.slice(0, 12));
  });

  it('logs no proxy hint with trust on or without a token', async () => {
    const spies = installConsoleSpies();
    const restoreEnv = wasNotTest();
    try {
      await startGateway({ token: TOKEN, trustProxy: true });
      await startGateway({ token: undefined, trustProxy: false });
    } finally {
      restoreEnv();
    }
    const all = [...spies.calls('log'), ...spies.calls('info'), ...spies.calls('warn')];
    expect(trustHintLines(all)).toHaveLength(0);
  });
});
