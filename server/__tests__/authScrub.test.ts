// The token never reaches a log, frame, close reason, body or header (plan 08-02, criterion 3, D-13).
// The gateway token IS the canary; hostile flows embed it (and near misses of it) in malformed input.
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/services/TmuxDiscovery.js', () => ({
  discoverTmuxSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/TmuxDriver.js', () => ({
  TmuxDriver: vi.fn().mockImplementation(function () {
    return { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
  }),
}));

vi.mock('../src/services/tmuxKill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/tmuxKill.js')>();
  return { ...actual, killTmuxSession: vi.fn().mockResolvedValue('killed') };
});

import {
  CANARY,
  CANARY_HEX,
  CANARY_PREFIX,
  authenticate,
  bearer,
  closeAllClients,
  closeAllGateways,
  hello,
  installConsoleSpies,
  makeClock,
  openClient,
  quiet,
  request,
  restoreConsole,
  secretsIn,
  startGateway,
  tinyThrottle,
} from './helpers/authHarness.js';
import type { Res, TestClient } from './helpers/authHarness.js';

afterEach(async () => {
  closeAllClients();
  await closeAllGateways();
  restoreConsole();
});

const NEAR_MISS = `${CANARY}x`;

/** Sends the frame pre-auth and returns the close info; asserts the socket saw no frame. */
async function hostile(port: number, frame: string | object) {
  const c = openClient(port);
  await c.opened;
  c.send(frame);
  const closed = await c.closed;
  return { c, closed };
}

function expectClean(sinks: string[]) {
  for (const sink of sinks) expect(secretsIn(sink)).toEqual([]);
}

describe('scrub: WebSocket', () => {
  it('the canary helpers are what the assertions look for', () => {
    expect(CANARY.length).toBeGreaterThanOrEqual(24);
    expect(CANARY_HEX).toMatch(/^[0-9a-f]{64}$/);
    expect(CANARY_PREFIX).toBe(CANARY.slice(0, 12));
  });

  it('a pre-auth-only run of hostile frames produces no console output at all', async () => {
    const gw = await startGateway({ token: CANARY, throttle: tinyThrottle(makeClock()) });
    const spies = installConsoleSpies();
    const reasons: string[] = [];
    const frames: string[] = [];
    const flows: Array<string | object> = [
      `x{"type":"hello","token":"${CANARY}"}`,
      `{"type":"hello","contract":1,"token":"${CANARY}`,
      JSON.stringify(hello(CANARY)) + ' '.repeat(20000),
      JSON.stringify(hello(`${CANARY}\u0001`)),
      { type: 'hello', token: CANARY },
      hello(NEAR_MISS),
    ];
    for (const flow of flows) {
      const { c, closed } = await hostile(gw.port, flow);
      reasons.push(closed.reason);
      frames.push(...c.raw);
    }
    await quiet(50);
    expect(spies.dump()).toBe('');
    expectClean([...reasons, ...frames]);
    for (const r of reasons) expect(r).toBe('unauthenticated');
    expect(frames).toEqual([]);
  });

  it('a leading-garbage frame carrying the canary is silent and leaves no trace in the reason', async () => {
    const gw = await startGateway({ token: CANARY });
    const spies = installConsoleSpies();
    const { closed, c } = await hostile(gw.port, `garbage${JSON.stringify(hello(CANARY))}`);
    expect(closed).toEqual({ code: 4401, reason: 'unauthenticated' });
    expect(c.raw).toEqual([]);
    expect(spies.dump()).toBe('');
  });

  it('a throttled connection (4429) carries no secret in its reason, frames or logs', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: CANARY, throttle: tinyThrottle(clock) });
    const spies = installConsoleSpies();
    for (let i = 0; i < 3; i++) await hostile(gw.port, hello(NEAR_MISS));
    const c = openClient(gw.port);
    await c.opened;
    const closed = await c.closed;
    expect(closed.code).toBe(4429);
    expectClean([closed.reason, ...c.raw, spies.dump()]);
    expect(spies.dump()).toBe('');
  });

  it('a malformed frame after authentication logs exactly one line with a fixed Error message', async () => {
    const gw = await startGateway({ token: CANARY });
    const c: TestClient = await authenticate(gw.port, CANARY);
    const spies = installConsoleSpies();
    c.send(`x{"type":"hello","token":"${CANARY}"}`);
    await vi.waitFor(() => expect(spies.calls('error').length).toBe(1), { timeout: 2000 });
    const [first, second] = spies.calls('error')[0];
    expect(first).toBe('Invalid WebSocket message received:');
    expect(second).toBeInstanceOf(Error);
    expect((second as Error).message).toBe('frame is not valid JSON');
    await quiet(50);
    expectClean([spies.dump(), ...c.raw]);
  });

  it('a truncated post-auth frame and a non-object frame log nothing secret', async () => {
    const gw = await startGateway({ token: CANARY });
    const c = await authenticate(gw.port, CANARY);
    const spies = installConsoleSpies();
    c.send(`{"type":"agent:input","data":"${CANARY}`);
    c.send(JSON.stringify([CANARY]));
    await vi.waitFor(() => expect(spies.calls('error').length).toBe(2), { timeout: 2000 });
    expectClean([spies.dump(), ...c.raw]);
  });

  it('the happy path leaks the token nowhere: hello_ack, roster and a ping reply', async () => {
    const gw = await startGateway({ token: CANARY });
    const spies = installConsoleSpies();
    const c = await authenticate(gw.port, CANARY);
    c.send({ type: 'ping', t: 5 });
    await vi.waitFor(() => expect(c.frames.some((f) => f.type === 'pong')).toBe(true), { timeout: 2000 });
    expectClean([...c.raw, spies.dump()]);
  });
});

describe('scrub: HTTP', () => {
  const JSON_HEADERS = { 'content-type': 'application/json' };

  /** Every response body and every response header joined into one string. */
  const sink = (res: Res) => `${res.text}\n${JSON.stringify(res.headers)}`;

  it('a wrong Bearer carrying the canary is a plain 401 that echoes nothing', async () => {
    const gw = await startGateway({ token: CANARY });
    const spies = installConsoleSpies();
    const res = await request(gw.port, 'GET', '/api/agents', { headers: bearer(NEAR_MISS) });
    expect(res.status).toBe(401);
    expectClean([sink(res), spies.dump()]);
  });

  it('the canary in the query string, the path and a cookie is never echoed or logged', async () => {
    const gw = await startGateway({ token: CANARY });
    const spies = installConsoleSpies();
    const responses = [
      await request(gw.port, 'GET', `/api/agents?token=${CANARY}`),
      await request(gw.port, 'GET', `/api/agents/${CANARY}`),
      await request(gw.port, 'GET', `/api/${CANARY}`),
      await request(gw.port, 'GET', '/api/agents', { headers: { cookie: `token=${CANARY}` } }),
    ];
    for (const res of responses) expect(res.status).toBe(401);
    expectClean([...responses.map(sink), spies.dump()]);
  });

  it('the canary in an invalid JSON body is not echoed, unauthenticated or authenticated', async () => {
    const gw = await startGateway({ token: CANARY });
    const spies = installConsoleSpies();
    const bad = `{"token":"${CANARY}"`;
    const anon = await request(gw.port, 'POST', '/api/agents', { headers: JSON_HEADERS, body: bad });
    const authed = await request(gw.port, 'POST', '/api/agents', {
      headers: { ...JSON_HEADERS, ...bearer(CANARY) },
      body: bad,
    });
    expect(anon.status).toBe(401);
    expect(authed.status).toBe(400);
    expectClean([sink(anon), sink(authed), spies.dump()]);
  });

  it('a throttled HTTP request (429) carries no secret in body, headers or logs', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: CANARY, throttle: tinyThrottle(clock) });
    const spies = installConsoleSpies();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(sink(await request(gw.port, 'GET', '/api/agents', { headers: bearer(NEAR_MISS) })));
    }
    const locked = await request(gw.port, 'GET', `/api/agents?token=${CANARY}`, { headers: bearer(CANARY) });
    expect(locked.status).toBe(429);
    expectClean([...seen, sink(locked), spies.dump()]);
  });

  it('a foreign Origin or Host refusal does not echo the request', async () => {
    const gw = await startGateway({ token: CANARY });
    const spies = installConsoleSpies();
    const origin = await request(gw.port, 'POST', '/api/agents', {
      headers: { ...JSON_HEADERS, origin: `http://${CANARY}.example`, ...bearer(CANARY) },
      body: '{}',
    });
    const host = await request(gw.port, 'GET', '/api/agents', { headers: { host: `${CANARY}.example` } });
    expect(origin.status).toBe(403);
    expect(host.status).toBe(403);
    expectClean([sink(origin), sink(host), spies.dump()]);
  });

  it('an authenticated request leaks nothing: bodies, headers and logs stay clean', async () => {
    const gw = await startGateway({ token: CANARY });
    const spies = installConsoleSpies();
    const res = await request(gw.port, 'GET', '/api/health', { headers: bearer(CANARY) });
    const legacy = await request(gw.port, 'GET', '/health');
    expect(res.status).toBe(200);
    expectClean([sink(res), sink(legacy), spies.dump()]);
  });
});
