// HTTP API over a real server (plan 06-06). Drivers and tmux are mocked; the port is always 0.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'node:http';

interface CapturedDriver {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const drivers = vi.hoisted(() => [] as unknown[]);
const driverFailure = vi.hoisted(() => ({ throwNext: false }));

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
    if (driverFailure.throwNext) {
      driverFailure.throwNext = false;
      throw new Error('driver construction failed: secret-internal-detail');
    }
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
import { registeredRouteIds } from '../src/http/apiRouter.js';
import { statusFor } from '../src/http/envelope.js';
import {
  CONTRACT_VERSION,
  UNCATALOGUED_HTTP_ROUTES,
  checkSurfaceCoverage,
  listHttpRoutes,
  parseHttpBody,
  parseServerMessage,
} from '@agent-manager/protocol';
import type { HttpKind } from '@agent-manager/protocol';
import { WebSocket } from 'ws';

type Handle = Awaited<ReturnType<typeof bootstrap>>;

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

const capturedDrivers = () => drivers as CapturedDriver[];
const killMock = killTmuxSession as unknown as ReturnType<typeof vi.fn>;

const ALLOWED = 'http://localhost:3000';
const JSON_HEADERS = { 'content-type': 'application/json' };
const CREATE = { name: 'qa-http', mode: 'tmux', targetHost: 'qa_http' };

let handle: Handle;
let port: number;

/** One raw HTTP request. Unlike fetch it adds no headers of its own (no content-type, no origin). */
function request(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string | Buffer } = {}
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-length'] = Buffer.byteLength(opts.body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any;
          try {
            json = JSON.parse(text);
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

const postJson = (body: unknown, headers: Record<string, string> = {}) =>
  request('POST', '/api/agents', {
    headers: { ...JSON_HEADERS, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function expectBody(kind: HttpKind, json: unknown): void {
  const parsed = parseHttpBody(kind, json);
  expect(parsed.ok).toBe(true);
}

function expectError(res: Res, code: string): void {
  expectBody('error', res.json);
  expect(res.json.ok).toBe(false);
  expect(res.json.error.code).toBe(code);
  expect(res.status).toBe(statusFor(code as any));
  expect(Object.keys(res.json).sort()).toEqual(['error', 'ok']);
}

const spies: Array<{ mockRestore: () => void }> = [];
const spyConsole = (method: 'error' | 'warn' | 'log') => {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  spies.push(spy);
  return spy;
};

beforeEach(async () => {
  drivers.length = 0;
  driverFailure.throwNext = false;
  killMock.mockClear();
  handle = await bootstrap(0, '127.0.0.1', { epoch: 'epoch-test-1' });
  port = (handle.server.address() as AddressInfo).port;
});

afterEach(async () => {
  while (spies.length) spies.pop()!.mockRestore();
  handle.wss.close();
  await new Promise<void>((resolve) => handle.server.close(() => resolve()));
});

describe('tracer: create and list over HTTP', () => {
  it('POST /api/agents creates a running agent and answers 201 with the agent body', async () => {
    const res = await postJson(CREATE);
    expect(res.status).toBe(201);
    expectBody('agent', res.json);
    expect(res.json.agent).toMatchObject({ name: 'qa-http', mode: 'tmux', targetHost: 'qa_http', status: 'running' });
    expect(capturedDrivers()).toHaveLength(1);
  });

  it('GET /api/agents lists the created agent exactly once', async () => {
    const created = await postJson(CREATE);
    const res = await request('GET', '/api/agents');
    expect(res.status).toBe(200);
    expectBody('agents', res.json);
    expect(res.json.agents.filter((a: any) => a.id === created.json.agent.id)).toHaveLength(1);
    expect(res.json.agents).toHaveLength(1);
  });

  it('GET /api/agents on an empty roster is an empty list', async () => {
    const res = await request('GET', '/api/agents');
    expect(res.status).toBe(200);
    expectBody('agents', res.json);
    expect(res.json.agents).toEqual([]);
  });

  it('GET /api/health reports contract, epoch, the local backend and the agent count', async () => {
    await postJson(CREATE);
    const res = await request('GET', '/api/health');
    expect(res.status).toBe(200);
    expectBody('health', res.json);
    expect(res.json).toEqual({
      ok: true,
      contract: CONTRACT_VERSION,
      epoch: 'epoch-test-1',
      backends: [{ id: 'local', up: true }],
      agents: 1,
    });
  });

  it('defaults the epoch to a non-empty per-process id', async () => {
    const other = await bootstrap(0, '127.0.0.1');
    try {
      const p = (other.server.address() as AddressInfo).port;
      const res = await new Promise<any>((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: p, path: '/api/health', agent: false }, (r) => {
          let t = '';
          r.on('data', (c) => (t += c));
          r.on('end', () => resolve(JSON.parse(t)));
        }).on('error', reject);
      });
      expect(typeof res.epoch).toBe('string');
      expect(res.epoch.length).toBeGreaterThan(0);
      expect(res.epoch).not.toBe('epoch-test-1');
    } finally {
      other.wss.close();
      await new Promise<void>((resolve) => other.server.close(() => resolve()));
    }
  });

  it('leaves the legacy GET /health unchanged', async () => {
    const res = await request('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: 'ok', agents: 0 });
    expect(typeof res.json.timestamp).toBe('string');
    expect(res.json.ok).toBeUndefined();
  });

  it('shows the created agent in the connect snapshot of a later WebSocket client', async () => {
    const created = await postJson(CREATE);
    const frames: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    try {
      await vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
      expect(frames[0].type).toBe('agent:init_list');
      expect(frames[0].agents.map((a: any) => a.id)).toContain(created.json.agent.id);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a 129-character name with 400 USAGE naming only the field', async () => {
    const res = await postJson({ ...CREATE, name: 'n'.repeat(129) });
    expectError(res, 'USAGE');
    expect(res.json.error.message).toBe('invalid field: name');
    expect(capturedDrivers()).toHaveLength(0);
  });

  it('answers every API response as JSON with Cache-Control no-store and no X-Powered-By', async () => {
    const responses = [
      await request('GET', '/api/health'),
      await request('GET', '/api/agents'),
      await postJson(CREATE),
      await postJson({ name: '' }),
      await request('GET', '/api/nope'),
    ];
    for (const res of responses) {
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('reaches AgentService.create only through AgentApi.execute, exactly once', async () => {
    const createSpy = vi.spyOn(handle.sessionManager.service, 'create');
    const executeSpy = vi.spyOn(handle.sessionManager.api, 'execute');
    spies.push(createSpy, executeSpy);
    const res = await postJson(CREATE);
    expect(res.status).toBe(201);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][0]).toMatchObject({ type: 'agent:create', name: 'qa-http' });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});

const seedAgent = () => handle.sessionManager.createAgent('seed', 'tmux', 'qa_seed');
const agentCount = () => handle.sessionManager.getAgentCount();
const noCors = (res: Res) => {
  expect(Object.keys(res.headers).filter((h) => h.toLowerCase().startsWith('access-control'))).toEqual([]);
};

/** Opens a WebSocket and waits for the connect snapshot. */
async function openWs(): Promise<{ ws: WebSocket; frames: any[] }> {
  const frames: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  await vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
  return { ws, frames };
}

describe('DELETE /api/agents/:id', () => {
  it('closes a known agent: 200 ok, driver closed once, tmux never called, agent gone', async () => {
    const x = seedAgent();
    const res = await request('DELETE', `/api/agents/${x.id}`);
    expect(res.status).toBe(200);
    expectBody('ok', res.json);
    expect(res.json).toEqual({ ok: true });
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
    expect(killMock).not.toHaveBeenCalled();
    expect(agentCount()).toBe(0);
    expect((await request('GET', '/api/agents')).json.agents).toEqual([]);
  });

  it('answers an unknown id with a 404 NOT_FOUND envelope', async () => {
    const res = await request('DELETE', '/api/agents/agent-ghost');
    expectError(res, 'NOT_FOUND');
    expect(res.json.error.message).toBe('agent not found');
    expect(res.text).not.toContain('agent-ghost');
  });

  it('answers a second DELETE of the same agent with 404', async () => {
    const x = seedAgent();
    expect((await request('DELETE', `/api/agents/${x.id}`)).status).toBe(200);
    expectError(await request('DELETE', `/api/agents/${x.id}`), 'NOT_FOUND');
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
  });

  it('rejects a 129-character id with 400 USAGE and reaches no service call', async () => {
    const closeSpy = vi.spyOn(handle.sessionManager.service, 'close');
    spies.push(closeSpy);
    const res = await request('DELETE', `/api/agents/${'x'.repeat(129)}`);
    expectError(res, 'USAGE');
    expect(res.json.error.message).toBe('invalid field: agentId');
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('never ends the tmux session, even when the query asks for it', async () => {
    const x = seedAgent();
    const res = await request('DELETE', `/api/agents/${x.id}?killSession=true&confirm=true`);
    expect(res.status).toBe(200);
    expect(killMock).not.toHaveBeenCalled();
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
  });

  it('does not echo a hostile id and treats it as unknown', async () => {
    const res = await request('DELETE', '/api/agents/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expectError(res, 'NOT_FOUND');
    expect(res.text).not.toContain('script');
  });

  it('answers an undecodable path with 400 USAGE, not a framework page', async () => {
    const res = await request('DELETE', '/api/agents/%E0%A4%A');
    expectError(res, 'USAGE');
    expect(res.text).not.toContain('URIError');
  });
});

describe('Idempotency-Key', () => {
  it('returns the original 201 body for a repeated key and body, and creates one agent', async () => {
    const first = await postJson(CREATE, { 'idempotency-key': 'key-1' });
    const second = await postJson(CREATE, { 'idempotency-key': 'key-1' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json).toEqual(first.json);
    expect(capturedDrivers()).toHaveLength(1);
    expect((await request('GET', '/api/agents')).json.agents).toHaveLength(1);
  });

  it('answers the same key with a different body as 409 CONFLICT and creates nothing more', async () => {
    await postJson(CREATE, { 'idempotency-key': 'key-2' });
    const res = await postJson({ ...CREATE, name: 'different' }, { 'idempotency-key': 'key-2' });
    expectError(res, 'CONFLICT');
    expect(capturedDrivers()).toHaveLength(1);
    expect(agentCount()).toBe(1);
  });

  it('does not cache a failed create: a retry with the same key creates', async () => {
    spyConsole('error');
    driverFailure.throwNext = true;
    const failed = await postJson(CREATE, { 'idempotency-key': 'key-3' });
    expectError(failed, 'BACKEND_DOWN');
    expect(failed.json.error.retryable).toBe(true);
    expect(failed.text).not.toContain('secret-internal-detail');
    expect(agentCount()).toBe(0);

    const retry = await postJson(CREATE, { 'idempotency-key': 'key-3' });
    expect(retry.status).toBe(201);
    expect(agentCount()).toBe(1);
  });

  it.each([
    ['empty', ''],
    ['129 characters', 'k'.repeat(129)],
    ['containing a space', 'a b'],
    ['containing a tab', 'a\tb'],
    ['non-ASCII', 'kéy'],
  ])('rejects a key that is %s with 400 USAGE and creates nothing', async (_n, key) => {
    const res = await postJson(CREATE, { 'idempotency-key': key });
    expectError(res, 'USAGE');
    expect(res.json.error.message).toBe('invalid header: Idempotency-Key');
    expect(capturedDrivers()).toHaveLength(0);
  });

  it('accepts keys of 1 and 128 characters, and the key __proto__ as an ordinary key', async () => {
    expect((await postJson({ ...CREATE, name: 'a' }, { 'idempotency-key': 'k' })).status).toBe(201);
    expect((await postJson({ ...CREATE, name: 'b' }, { 'idempotency-key': 'k'.repeat(128) })).status).toBe(201);
    expect((await postJson({ ...CREATE, name: 'c' }, { 'idempotency-key': '__proto__' })).status).toBe(201);
    expect(agentCount()).toBe(3);
  });

  it('ignores a reqId in the body: the header is the contract', async () => {
    await postJson({ ...CREATE, reqId: 'body-key' });
    await postJson({ ...CREATE, reqId: 'body-key' });
    expect(agentCount()).toBe(2);
  });

  it('honours a key first used over HTTP when the same create arrives over WebSocket', async () => {
    const http1 = await postJson(CREATE, { 'idempotency-key': 'cross-1' });
    const { ws, frames } = await openWs();
    try {
      ws.send(JSON.stringify({ type: 'agent:create', ...CREATE, reqId: 'cross-1' }));
      await vi.waitFor(() => expect(frames.some((f) => f.type === 'agent:ack')).toBe(true), { timeout: 2000 });
      const ack = frames.find((f) => f.type === 'agent:ack');
      expect(parseServerMessage(ack).ok).toBe(true);
      expect(ack.agent.id).toBe(http1.json.agent.id);
      expect(capturedDrivers()).toHaveLength(1);
    } finally {
      ws.terminate();
    }
  });

  it('honours a key first used over WebSocket when the same create arrives over HTTP', async () => {
    const { ws, frames } = await openWs();
    try {
      ws.send(JSON.stringify({ type: 'agent:create', ...CREATE, reqId: 'cross-2' }));
      await vi.waitFor(() => expect(frames.some((f) => f.type === 'agent:ack')).toBe(true), { timeout: 2000 });
      const ack = frames.find((f) => f.type === 'agent:ack');
      const res = await postJson(CREATE, { 'idempotency-key': 'cross-2' });
      expect(res.status).toBe(201);
      expect(res.json.agent.id).toBe(ack.agent.id);
      expect(capturedDrivers()).toHaveLength(1);
    } finally {
      ws.terminate();
    }
  });
});

describe('request guards', () => {
  it('refuses a POST from a foreign Origin with 403 FORBIDDEN and creates nothing', async () => {
    const res = await postJson(CREATE, { origin: 'http://evil.example' });
    expectError(res, 'FORBIDDEN');
    expect(capturedDrivers()).toHaveLength(0);
    expect(agentCount()).toBe(0);
  });

  it('checks the Origin before the content type or the body', async () => {
    const wrongType = await request('POST', '/api/agents', {
      headers: { origin: 'http://evil.example', 'content-type': 'text/plain' },
      body: 'not json',
    });
    expectError(wrongType, 'FORBIDDEN');
    const malformed = await postJson('{"name":', { origin: 'http://evil.example' });
    expectError(malformed, 'FORBIDDEN');
  });

  it('refuses a DELETE from a foreign Origin and leaves the agent alone', async () => {
    const x = seedAgent();
    const res = await request('DELETE', `/api/agents/${x.id}`, { headers: { origin: 'http://evil.example' } });
    expectError(res, 'FORBIDDEN');
    expect(agentCount()).toBe(1);
    expect(capturedDrivers()[0].close).not.toHaveBeenCalled();
  });

  it('refuses the Origin "null" (sandboxed pages)', async () => {
    expectError(await postJson(CREATE, { origin: 'null' }), 'FORBIDDEN');
  });

  it('lets an allowed Origin through, with or without a trailing slash, and a request with no Origin', async () => {
    expect((await postJson({ ...CREATE, name: 'a' }, { origin: ALLOWED })).status).toBe(201);
    expect((await postJson({ ...CREATE, name: 'b' }, { origin: `${ALLOWED}/` })).status).toBe(201);
    expect((await postJson({ ...CREATE, name: 'c' })).status).toBe(201);
  });

  it('ignores the Origin on GET', async () => {
    const res = await request('GET', '/api/agents', { headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(200);
    noCors(res);
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['a form post', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=x'],
    ['no content type', undefined],
  ])('answers a POST with %s with 400 USAGE and creates nothing', async (_n, contentType) => {
    const headers: Record<string, string> = {};
    if (contentType) headers['content-type'] = contentType;
    const res = await request('POST', '/api/agents', { headers, body: JSON.stringify(CREATE) });
    expectError(res, 'USAGE');
    expect(res.json.error.message).toBe('content type must be application/json');
    expect(agentCount()).toBe(0);
  });

  it('accepts application/json with a charset parameter', async () => {
    const res = await request('POST', '/api/agents', {
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(CREATE),
    });
    expect(res.status).toBe(201);
  });

  it('answers a JSON body over 64 KiB with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await postJson({ ...CREATE, pad: 'x'.repeat(70 * 1024) });
    expectError(res, 'PAYLOAD_TOO_LARGE');
    expect(agentCount()).toBe(0);
  });

  it('accepts a body just under the limit (unknown fields are stripped by the validator)', async () => {
    const res = await postJson({ ...CREATE, pad: 'x'.repeat(60 * 1024) });
    expect(res.status).toBe(201);
    expect(res.text).not.toContain('xxxxxxxxxx');
  });

  it.each([
    ['malformed JSON', '{"name":'],
    ['a JSON string', '"hello"'],
    ['JSON null', 'null'],
    ['a JSON number', '42'],
  ])('answers %s with 400 USAGE', async (_n, body) => {
    const res = await postJson(body);
    expectError(res, 'USAGE');
    expect(agentCount()).toBe(0);
  });

  it('answers a JSON array with 400 USAGE', async () => {
    const res = await postJson([CREATE]);
    expectError(res, 'USAGE');
    expect(res.json.error.message).toBe('request body must be a JSON object');
  });

  it('answers an empty JSON body with 400 USAGE naming a field', async () => {
    const res = await request('POST', '/api/agents', { headers: JSON_HEADERS, body: '' });
    expectError(res, 'USAGE');
    expect(res.json.error.message).toMatch(/^invalid field: /);
  });

  it('sends no CORS header on any response, and a preflight gets none', async () => {
    const preflight = await request('OPTIONS', '/api/agents', {
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    noCors(preflight);
    const others = [
      await request('GET', '/api/health', { headers: { origin: ALLOWED } }),
      await postJson(CREATE, { origin: ALLOWED }),
      await postJson(CREATE, { origin: 'http://evil.example' }),
      await request('GET', '/api/nope', { headers: { origin: ALLOWED } }),
    ];
    for (const res of others) noCors(res);
  });
});

describe('hostile input', () => {
  it('names a field only and never echoes markup, control characters or long values', async () => {
    const markup = '<script>alert(1)</script>';
    const attempts = [
      { ...CREATE, name: markup.repeat(20) },
      { ...CREATE, mode: markup },
      { ...CREATE, targetHost: 'h\u0007ost' },
      { ...CREATE, initialCmd: 'z'.repeat(5000) },
      { ...CREATE, name: 'q'.repeat(5000) },
    ];
    for (const body of attempts) {
      const res = await postJson(body);
      expect(res.status).toBe(400);
      expect(res.json.error.message).toMatch(/^invalid field: [A-Za-z]+$/);
      expect(res.text).not.toContain('script');
      expect(res.text).not.toContain('zzzz');
      expect(res.text).not.toContain('qqqq');
      expect(res.text).not.toContain('\u0007');
    }
    expect(agentCount()).toBe(0);
  });

  it('does not let body fields override the operation (type, agentId, killSession, confirm)', async () => {
    const res = await postJson({ ...CREATE, type: 'agent:kill', agentId: 'x', killSession: true, confirm: true });
    expect(res.status).toBe(201);
    expect(killMock).not.toHaveBeenCalled();
    expect(agentCount()).toBe(1);
  });

  it('refuses a create with a backend or params as 422 UNSUPPORTED', async () => {
    expectError(await postJson({ ...CREATE, backend: 'docker' }), 'UNSUPPORTED');
    expectError(await postJson({ ...CREATE, params: { image: 'x' } }), 'UNSUPPORTED');
    expect(capturedDrivers()).toHaveLength(0);
  });

  it('turns a thrown internal error into a fixed 500 INTERNAL with no stack or message', async () => {
    const err = spyConsole('error');
    const listSpy = vi.spyOn(handle.sessionManager.service, 'list').mockImplementation(() => {
      throw new Error('boom: /home/secret/path');
    });
    spies.push(listSpy);
    const res = await request('GET', '/api/agents');
    expectError(res, 'INTERNAL');
    expect(res.json.error.message).toBe('internal error');
    expect(res.text).not.toContain('boom');
    expect(res.text).not.toContain('secret');
    expect(res.text).not.toMatch(/\bat \S+ \(/);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0]).length).toBeLessThan(300);
  });

  it('turns a rejecting api.execute into a fixed 500 INTERNAL', async () => {
    spyConsole('error');
    const execSpy = vi.spyOn(handle.sessionManager.api, 'execute').mockRejectedValue(new Error('kaboom'));
    spies.push(execSpy);
    const res = await postJson(CREATE);
    expectError(res, 'INTERNAL');
    expect(res.text).not.toContain('kaboom');
  });
});

describe('unsupported and unknown routes', () => {
  it('answers GET /api/agents/:id/logs with 422 UNSUPPORTED and a fixed message', async () => {
    const res = await request('GET', '/api/agents/agent-1/logs?limit=5');
    expectError(res, 'UNSUPPORTED');
    expect(res.json.error.message).toBe('this operation is not supported by this gateway');
    expect(res.text).not.toContain('agent-1');
  });

  it('answers GET /api/search with 422 UNSUPPORTED and does not echo the query', async () => {
    const res = await request('GET', '/api/search?q=hunter2');
    expectError(res, 'UNSUPPORTED');
    expect(res.text).not.toContain('hunter2');
  });

  it.each([
    ['GET', '/api/nope'],
    ['GET', '/api/agents/a/b/c'],
    ['PUT', '/api/agents'],
    ['PATCH', '/api/agents/x'],
    ['POST', '/api/health'],
    ['DELETE', '/api/agents'],
  ])('answers %s %s with a 404 NOT_FOUND envelope', async (method, path) => {
    const res = await request(method, path);
    expectError(res, 'NOT_FOUND');
    expect(res.json.error.message).toBe('no such route');
  });

  it('covers every catalog HTTP route exactly: the router registers what the catalog lists', () => {
    const result = checkSurfaceCoverage('http', registeredRouteIds(), UNCATALOGUED_HTTP_ROUTES);
    expect(result).toEqual({ missing: [], unknown: [], duplicate: [] });
    expect(registeredRouteIds()).toContain('GET /api/agents/:id/logs');
    expect(registeredRouteIds()).toContain('GET /api/search');
  });

  it('answers every catalog route with a handler (never the unknown-route 404)', async () => {
    for (const route of listHttpRoutes()) {
      const path = route.binding.path.replace(':id', 'agent-ghost');
      const res = await request(route.binding.method, path, {
        headers: route.binding.method === 'POST' ? JSON_HEADERS : {},
        body: route.binding.method === 'POST' ? '{}' : undefined,
      });
      expect(res.json?.error?.message, route.id).not.toBe('no such route');
    }
  });
});
