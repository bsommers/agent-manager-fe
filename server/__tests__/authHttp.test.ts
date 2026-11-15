// Bearer authentication on /api over a real server (plan 08-02). Drivers and tmux are mocked; the port is 0.
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

import { CONTRACT_VERSION, parseHttpBody } from '@agent-manager/protocol';
import type { HttpKind } from '@agent-manager/protocol';
import {
  TOKEN,
  WRONG_SAME_LENGTH,
  authenticate,
  bearer,
  closeAllClients,
  closeAllGateways,
  hello,
  makeClock,
  openClient,
  request,
  startGateway,
  tinyThrottle,
} from './helpers/authHarness.js';
import type { Res } from './helpers/authHarness.js';

afterEach(async () => {
  closeAllClients();
  await closeAllGateways();
});

const JSON_HEADERS = { 'content-type': 'application/json' };
const CREATE = { name: 'qa-auth', mode: 'tmux', targetHost: 'qa_auth' };

function expectBody(kind: HttpKind, json: unknown): void {
  expect(parseHttpBody(kind, json).ok).toBe(true);
}

function expectUnauthenticated(res: Res): void {
  expect(res.status).toBe(401);
  expectBody('error', res.json);
  expect(res.json.error.code).toBe('UNAUTHENTICATED');
  expect(res.headers['www-authenticate']).toBe('Bearer');
  expect(res.headers['cache-control']).toBe('no-store');
}

describe('Bearer check on /api', () => {
  it('answers a missing Authorization header with the 401 envelope, challenge and a fixed message', async () => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'GET', '/api/agents');
    expectUnauthenticated(res);
    expect(res.json.error.message).toBe('authentication required');
    expect(Object.keys(res.json).sort()).toEqual(['error', 'ok']);
  });

  it('serves the agent list with a valid Bearer', async () => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'GET', '/api/agents', { headers: bearer(TOKEN) });
    expect(res.status).toBe(200);
    expectBody('agents', res.json);
    expect(res.json.agents).toEqual([]);
  });

  it('matches the scheme case-insensitively', async () => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'GET', '/api/agents', { headers: { authorization: `bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
  });

  it.each([
    ['a Basic scheme', `Basic ${Buffer.from(`u:${TOKEN}`).toString('base64')}`],
    ['a Bearer with two words', `Bearer ${TOKEN} extra`],
    ['an empty Bearer', 'Bearer '],
    ['a wrong Bearer', `Bearer ${WRONG_SAME_LENGTH}`],
    ['the bare token', TOKEN],
  ])('refuses %s with 401', async (_label, header) => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'GET', '/api/agents', { headers: { authorization: header } });
    expectUnauthenticated(res);
  });

  it.each([
    ['a query string token', `/api/agents?token=${TOKEN}`],
    ['an access_token query', `/api/agents?access_token=${TOKEN}`],
    ['a path segment', `/api/agents/${TOKEN}`],
  ])('never authenticates with %s', async (_label, path) => {
    const gw = await startGateway({ token: TOKEN });
    expectUnauthenticated(await request(gw.port, 'GET', path));
  });

  it('never authenticates with a token in a JSON body or a cookie', async () => {
    const gw = await startGateway({ token: TOKEN });
    const body = await request(gw.port, 'POST', '/api/agents', {
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...CREATE, token: TOKEN, authorization: `Bearer ${TOKEN}` }),
    });
    expectUnauthenticated(body);
    const cookie = await request(gw.port, 'GET', '/api/agents', {
      headers: { cookie: `token=${TOKEN}; authorization=Bearer ${TOKEN}` },
    });
    expectUnauthenticated(cookie);
    expect(gw.handle.sessionManager.getAgentCount()).toBe(0);
  });
});

describe('ordering', () => {
  it('refuses a foreign Host with 403 before auth', async () => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'GET', '/api/agents', { headers: { host: 'evil.example' } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('FORBIDDEN');
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('refuses a foreign Origin on a POST with 403 before auth', async () => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'POST', '/api/agents', {
      headers: { ...JSON_HEADERS, origin: 'http://evil.example' },
      body: JSON.stringify(CREATE),
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('FORBIDDEN');
  });

  it('answers an unauthenticated POST with an invalid JSON body 401: the body is not read before auth', async () => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'POST', '/api/agents', { headers: JSON_HEADERS, body: '{not json' });
    expectUnauthenticated(res);
  });

  it.each([
    ['an unknown path', '/api/nope'],
    ['a catalogued but unsupported route', '/api/search'],
    ['a catalogued route of a later phase', '/api/agents/x/logs'],
  ])('answers %s 401, never 404 or 422, when unauthenticated', async (_label, path) => {
    const gw = await startGateway({ token: TOKEN });
    expectUnauthenticated(await request(gw.port, 'GET', path));
  });

  it('keeps 404 and 422 for an authenticated caller', async () => {
    const gw = await startGateway({ token: TOKEN });
    const nope = await request(gw.port, 'GET', '/api/nope', { headers: bearer(TOKEN) });
    expect(nope.status).toBe(404);
    expect(nope.json.error.code).toBe('NOT_FOUND');
    const search = await request(gw.port, 'GET', '/api/search', { headers: bearer(TOKEN) });
    expect(search.status).toBe(422);
    expect(search.json.error.code).toBe('UNSUPPORTED');
  });
});

describe('health', () => {
  it('GET /api/health with no header is 200 minimal: no agents key', async () => {
    const gw = await startGateway({ token: TOKEN, epoch: 'ep-h' });
    await authenticate(gw.port);
    const res = await request(gw.port, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expectBody('health', res.json);
    expect(res.json).toEqual({
      ok: true,
      contract: CONTRACT_VERSION,
      epoch: 'ep-h',
      backends: [{ id: 'local', up: true }],
    });
    expect('agents' in res.json).toBe(false);
  });

  it('includes an integer agents count with a valid Bearer', async () => {
    const gw = await startGateway({ token: TOKEN });
    const res = await request(gw.port, 'GET', '/api/health', { headers: bearer(TOKEN) });
    expect(res.status).toBe(200);
    expectBody('health', res.json);
    expect(Number.isInteger(res.json.agents)).toBe(true);
  });

  it('answers a wrong Bearer 401 and counts it', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) {
      expectUnauthenticated(
        await request(gw.port, 'GET', '/api/health', { headers: bearer(WRONG_SAME_LENGTH) })
      );
    }
    const locked = await request(gw.port, 'GET', '/api/agents', { headers: bearer(TOKEN) });
    expect(locked.status).toBe(429);
  });

  it('reports the same epoch as the hello_ack of a WebSocket client', async () => {
    const gw = await startGateway({ token: TOKEN });
    const c = await authenticate(gw.port);
    const res = await request(gw.port, 'GET', '/api/health');
    expect(res.json.epoch).toBe(c.frames[0].epoch);
  });

  it('drops agents from the legacy GET /health when a token is configured, ignoring Authorization', async () => {
    const gw = await startGateway({ token: TOKEN });
    const anon = await request(gw.port, 'GET', '/health');
    expect(anon.status).toBe(200);
    expect(anon.json.status).toBe('ok');
    expect('agents' in anon.json).toBe(false);
    const authed = await request(gw.port, 'GET', '/health', { headers: bearer(TOKEN) });
    expect('agents' in authed.json).toBe(false);
  });

  it('keeps agents in the legacy GET /health with no token', async () => {
    const gw = await startGateway({ token: undefined });
    const res = await request(gw.port, 'GET', '/health');
    expect(res.json.agents).toBe(0);
  });
});

describe('counting and the shared throttle', () => {
  it('never locks the key on requests with no Authorization header', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 10; i++) expectUnauthenticated(await request(gw.port, 'GET', '/api/agents'));
    const ok = await request(gw.port, 'GET', '/api/agents', { headers: bearer(TOKEN) });
    expect(ok.status).toBe(200);
  });

  it('locks after maxFailures wrong Bearers: 429 RATE_LIMITED with an integer Retry-After, even for the right token', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) {
      expectUnauthenticated(await request(gw.port, 'GET', '/api/agents', { headers: bearer(WRONG_SAME_LENGTH) }));
    }
    const res = await request(gw.port, 'GET', '/api/agents', { headers: bearer(TOKEN) });
    expect(res.status).toBe(429);
    expectBody('error', res.json);
    expect(res.json.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('lets the right token in after the lock lapses and resets the key', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) await request(gw.port, 'GET', '/api/agents', { headers: bearer(WRONG_SAME_LENGTH) });
    clock.advance(1500);
    expect((await request(gw.port, 'GET', '/api/agents', { headers: bearer(TOKEN) })).status).toBe(200);
    for (let i = 0; i < 2; i++) await request(gw.port, 'GET', '/api/agents', { headers: bearer(WRONG_SAME_LENGTH) });
    expect((await request(gw.port, 'GET', '/api/agents', { headers: bearer(TOKEN) })).status).toBe(200);
  });

  it('shares one throttle: wrong hello tokens over WebSocket lock HTTP', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) {
      const c = openClient(gw.port);
      await c.opened;
      c.send(hello(WRONG_SAME_LENGTH));
      await c.closed;
    }
    const res = await request(gw.port, 'GET', '/api/agents', { headers: bearer(TOKEN) });
    expect(res.status).toBe(429);
  });

  it('shares one throttle: wrong Bearers over HTTP lock the WebSocket with 4429', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) await request(gw.port, 'GET', '/api/agents', { headers: bearer(WRONG_SAME_LENGTH) });
    const c = openClient(gw.port);
    await c.opened;
    const closed = await c.closed;
    expect(closed.code).toBe(4429);
    expect(closed.reason).toMatch(/^retry-after-ms=[1-9]\d*$/);
  });

  it('keys per forwarded client with trustProxy on', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, trustProxy: true, throttle: tinyThrottle(clock) });
    const A = { 'x-forwarded-for': '203.0.113.7' };
    const B = { 'x-forwarded-for': '198.51.100.9' };
    for (let i = 0; i < 3; i++) {
      await request(gw.port, 'GET', '/api/agents', { headers: { ...bearer(WRONG_SAME_LENGTH), ...A } });
    }
    expect((await request(gw.port, 'GET', '/api/agents', { headers: { ...bearer(TOKEN), ...A } })).status).toBe(429);
    expect((await request(gw.port, 'GET', '/api/agents', { headers: { ...bearer(TOKEN), ...B } })).status).toBe(200);
  });

  it('shares one key across forwarded values with trustProxy off', async () => {
    const clock = makeClock();
    const gw = await startGateway({ token: TOKEN, trustProxy: false, throttle: tinyThrottle(clock) });
    for (let i = 0; i < 3; i++) {
      await request(gw.port, 'GET', '/api/agents', {
        headers: { ...bearer(WRONG_SAME_LENGTH), 'x-forwarded-for': '203.0.113.7' },
      });
    }
    const res = await request(gw.port, 'GET', '/api/agents', {
      headers: { ...bearer(TOKEN), 'x-forwarded-for': '198.51.100.9' },
    });
    expect(res.status).toBe(429);
  });
});

describe('authenticated flows still work', () => {
  it('creates once for an Idempotency-Key and replays the same agent', async () => {
    const gw = await startGateway({ token: TOKEN });
    const headers = { ...JSON_HEADERS, ...bearer(TOKEN), 'idempotency-key': 'create-1' };
    const first = await request(gw.port, 'POST', '/api/agents', { headers, body: JSON.stringify(CREATE) });
    const second = await request(gw.port, 'POST', '/api/agents', { headers, body: JSON.stringify(CREATE) });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json.agent.id).toBe(first.json.agent.id);
    expect(gw.handle.sessionManager.getAgentCount()).toBe(1);
  });

  it('closes an agent with DELETE', async () => {
    const gw = await startGateway({ token: TOKEN });
    const made = await request(gw.port, 'POST', '/api/agents', {
      headers: { ...JSON_HEADERS, ...bearer(TOKEN) },
      body: JSON.stringify(CREATE),
    });
    const res = await request(gw.port, 'DELETE', `/api/agents/${made.json.agent.id}`, { headers: bearer(TOKEN) });
    expect(res.status).toBe(200);
    expect(gw.handle.sessionManager.getAgentCount()).toBe(0);
  });

  it('does not weaken the kill confirm gate: no confirm is the existing USAGE refusal', async () => {
    const gw = await startGateway({ token: TOKEN });
    const made = await request(gw.port, 'POST', '/api/agents', {
      headers: { ...JSON_HEADERS, ...bearer(TOKEN) },
      body: JSON.stringify(CREATE),
    });
    const res = await request(gw.port, 'POST', `/api/agents/${made.json.agent.id}/kill`, {
      headers: { ...JSON_HEADERS, ...bearer(TOKEN) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('USAGE');
    expect(gw.handle.sessionManager.getAgentCount()).toBe(1);
  });
});

describe('no token configured', () => {
  it('ignores an Authorization header, sends no challenge and includes agents in health', async () => {
    const gw = await startGateway({ token: undefined });
    const res = await request(gw.port, 'GET', '/api/agents', { headers: { authorization: 'Basic abc' } });
    expect(res.status).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
    const health = await request(gw.port, 'GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.json.agents).toBe(0);
    const wrong = await request(gw.port, 'GET', '/api/health', { headers: bearer(WRONG_SAME_LENGTH) });
    expect(wrong.status).toBe(200);
    expect(wrong.headers['www-authenticate']).toBeUndefined();
  });
});
