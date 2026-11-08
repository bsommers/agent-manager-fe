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
import { statusFor } from '../src/http/envelope.js';
import {
  CONTRACT_VERSION,
  parseHttpBody,
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
