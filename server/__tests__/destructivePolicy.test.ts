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

vi.mock('../src/services/SshDriver.js', () => ({
  SshDriver: vi.fn().mockImplementation(function () {
    const driver = { write: vi.fn(), resize: vi.fn(), close: vi.fn(), session: 'ssh' };
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
import { destructiveRules } from '../src/gateway/policy.js';
import { statusFor } from '../src/http/envelope.js';
import { WebSocket } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The catalog as loaded, to prove no test mutates it. */
const CATALOG_AT_LOAD = JSON.stringify(listOperations());

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

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

/** One raw HTTP request; adds no headers of its own. */
function request(
  method: string,
  reqPath: string,
  opts: { headers?: Record<string, string>; body?: string } = {}
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-length'] = Buffer.byteLength(opts.body);
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers, agent: false }, (res) => {
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
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const JSON_HEADERS = { 'content-type': 'application/json' };

type HttpBound = Exclude<OperationSpec['http'], { none: string }>;
const httpOf = (op: OperationSpec): HttpBound => {
  if ('none' in op.http) throw new Error('operation has no HTTP binding');
  return op.http;
};

/** The path for an operation's HTTP binding with the agent id substituted. */
function pathFor(op: OperationSpec, agentId: string, query = ''): string {
  const b = httpOf(op);
  let reqPath = b.path;
  for (const [segment, param] of Object.entries(b.pathParams ?? {})) {
    if (param !== 'agentId') throw new Error(`unexpected path param ${param}`);
    reqPath = reqPath.replace(`:${segment}`, encodeURIComponent(agentId));
  }
  return reqPath + query;
}

/** The header name that carries reqId for the binding. */
function idempotencyHeader(op: OperationSpec): string {
  const entry = Object.entries(httpOf(op).headerParams ?? {}).find(([, p]) => p === 'reqId');
  if (!entry) throw new Error('binding has no reqId header');
  return entry[0];
}

/** The HTTP request for a destructive operation, built from its catalog binding (no literal path). */
function httpRequest(
  op: OperationSpec,
  agentId: string,
  body: Record<string, unknown> | string,
  headers: Record<string, string> = {}
): Promise<Res> {
  return request(httpOf(op).method, pathFor(op, agentId), {
    headers: { ...JSON_HEADERS, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function expectUsageEnvelope(res: Res, message?: string): void {
  expect(res.status).toBe(statusFor('USAGE'));
  expect(Object.keys(res.json).sort()).toEqual(['error', 'ok']);
  expect(res.json.ok).toBe(false);
  expect(res.json.error.code).toBe('USAGE');
  if (message !== undefined) expect(res.json.error.message).toBe(message);
}

function expectNothingRan(agentIds: string[]): void {
  expect(killMock).not.toHaveBeenCalled();
  for (const d of capturedDrivers()) expect(d.close).not.toHaveBeenCalled();
  expect(handle.sessionManager.getAgents().map((a) => a.id)).toEqual(agentIds);
}

describe('catalog walk: destructive operations over HTTP', () => {
  const withHttp = () => destructive().filter(([, op]) => !('none' in op.http));

  it('at least one destructive operation has an HTTP binding', () => {
    expect(withHttp().length).toBeGreaterThan(0);
  });

  for (const [name, op] of withHttp()) {
    const param = op.confirmParam as string;

    describe(`${name}`, () => {
      it.each([
        ['an empty body', {}, 'killSession requires confirm: true'],
        ['confirm false', { [param]: false }, 'killSession requires confirm: true'],
        ['confirm the string "true"', { [param]: 'true' }, `invalid field: ${param}`],
        ['confirm the number 1', { [param]: 1 }, `invalid field: ${param}`],
      ])('refuses %s with the USAGE envelope and runs nothing', async (_n, body, message) => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        spyConsole('warn');
        const res = await httpRequest(op, a.id, body as Record<string, unknown>);
        expectUsageEnvelope(res, message);
        expectNothingRan([a.id]);
        expect(await rosterIds()).toEqual([a.id]);
      });

      it('with confirm true answers 200 ok, ends the session once and removes the agent', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        const b = handle.sessionManager.createAgent('beta', 'tmux', 'qa_b');
        spyConsole('log');
        const res = await httpRequest(op, a.id, { [param]: true });
        expect(res.status).toBe(200);
        expect(res.json).toEqual({ ok: true });
        expect(killMock).toHaveBeenCalledTimes(1);
        expect(killMock).toHaveBeenCalledWith('qa_a');
        expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
        expect(capturedDrivers()[1].close).not.toHaveBeenCalled();
        const list = await request('GET', '/api/agents');
        expect(list.json.agents.map((x: any) => x.id)).toEqual([b.id]);
      });

      it('ignores a body killSession false: the route implies the kill', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        spyConsole('log');
        const res = await httpRequest(op, a.id, { killSession: false, [param]: true });
        expect(res.status).toBe(200);
        expect(killMock).toHaveBeenCalledTimes(1);
      });

      it('an unknown id with confirm true is 404, and without confirm it is still USAGE', async () => {
        spyConsole('warn');
        const ghost = await httpRequest(op, 'agent-ghost', { [param]: true });
        expect(ghost.status).toBe(404);
        expect(ghost.json.error.code).toBe('NOT_FOUND');
        expectUsageEnvelope(await httpRequest(op, 'agent-ghost', {}));
        expect(killMock).not.toHaveBeenCalled();
      });

      it('an ssh agent with confirm true is 422 UNSUPPORTED and stays', async () => {
        const a = handle.sessionManager.createAgent('remote', 'ssh', 'user@host');
        spyConsole('warn');
        const res = await httpRequest(op, a.id, { [param]: true });
        expect(res.status).toBe(statusFor('UNSUPPORTED'));
        expect(res.json.error.code).toBe('UNSUPPORTED');
        expectNothingRan([a.id]);
      });

      it('a tmux failure is 500 INTERNAL with the fixed message and the agent stays', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        spyConsole('error');
        killMock.mockRejectedValueOnce(new Error('tmux exploded: secret-detail'));
        const res = await httpRequest(op, a.id, { [param]: true });
        expect(res.status).toBe(500);
        expect(res.json.error.code).toBe('INTERNAL');
        expect(res.text).not.toContain('secret-detail');
        expect(handle.sessionManager.getAgents().map((x) => x.id)).toEqual([a.id]);
        expect(capturedDrivers()[0].close).not.toHaveBeenCalled();
      });

      it('replays the 200 body for a repeated Idempotency-Key without a second tmux call', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        spyConsole('log');
        const h = { [idempotencyHeader(op)]: 'key-kill-1' };
        const first = await httpRequest(op, a.id, { [param]: true }, h);
        const second = await httpRequest(op, a.id, { [param]: true }, h);
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.json).toEqual({ ok: true });
        expect(killMock).toHaveBeenCalledTimes(1);
      });

      it('does not cache a refusal under an Idempotency-Key', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        spyConsole('warn');
        spyConsole('log');
        const h = { [idempotencyHeader(op)]: 'key-kill-2' };
        expectUsageEnvelope(await httpRequest(op, a.id, {}, h));
        const ok = await httpRequest(op, a.id, { [param]: true }, h);
        expect(ok.status).toBe(200);
        expect(killMock).toHaveBeenCalledTimes(1);
      });

      it('refuses a foreign Origin with 403 before the body is read', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        const res = await httpRequest(op, a.id, '{not json', { origin: 'http://evil.example' });
        expect(res.status).toBe(403);
        expect(res.json.error.code).toBe('FORBIDDEN');
        expectNothingRan([a.id]);
      });

      it('refuses a text/plain body with USAGE', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        const res = await request(httpOf(op).method, pathFor(op, a.id), {
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify({ [param]: true }),
        });
        expectUsageEnvelope(res);
        expectNothingRan([a.id]);
      });

      it('refuses a non-object JSON body with USAGE', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        expectUsageEnvelope(await httpRequest(op, a.id, '[true]'));
        expectNothingRan([a.id]);
      });

      it('does not take the confirmation from the query string', async () => {
        const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
        spyConsole('warn');
        const res = await request(httpOf(op).method, pathFor(op, a.id, `?${param}=true`), {
          headers: JSON_HEADERS,
          body: '{}',
        });
        expectUsageEnvelope(res);
        expectNothingRan([a.id]);
      });
    });
  }

  it('agent.close over DELETE is unchanged: no confirm needed and tmux is not touched', async () => {
    const a = handle.sessionManager.createAgent('alpha', 'tmux', 'qa_a');
    const res = await request('DELETE', `/api/agents/${a.id}`);
    expect(res.status).toBe(200);
    expect(killMock).not.toHaveBeenCalled();
    expect(capturedDrivers()[0].close).toHaveBeenCalledTimes(1);
  });
});

describe('pending surfaces', () => {
  /** Surfaces the gateway does not implement yet, each owned by a later phase. */
  const PENDING_SURFACES: Record<string, string> = { mcp: 'Phase 21.1' };
  const WALKED_SURFACES = ['ws', 'http'];

  it('every surface a destructive operation is bound to is walked or listed as pending', () => {
    for (const [name, op] of destructive()) {
      for (const surface of ['ws', 'http', 'mcp'] as const) {
        if ('none' in op[surface]) continue;
        const accounted = WALKED_SURFACES.includes(surface) || surface in PENDING_SURFACES;
        expect(accounted, `${name} is bound to ${surface} but it is neither walked nor pending`).toBe(true);
      }
    }
  });

  it('the pending record names an owner phase and does not overlap the walked list', () => {
    for (const [surface, owner] of Object.entries(PENDING_SURFACES)) {
      expect(owner).toMatch(/^Phase \d/);
      expect(WALKED_SURFACES).not.toContain(surface);
    }
  });
});

// ---------------------------------------------------------------------------
// The policy cannot be bypassed inside the gateway, and it follows the catalog
// ---------------------------------------------------------------------------

describe('static call-site guarantees', () => {
  const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') out.push(...sourceFiles(full));
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  const rel = (f: string) => path.relative(srcDir, f).split(path.sep).join('/');
  const read = (relative: string) => fs.readFileSync(path.join(srcDir, relative), 'utf8');

  it('AgentService.destroy is called only from gateway/dispatch.ts', () => {
    const callers = sourceFiles(srcDir)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('.destroy('))
      .map(rel);
    expect(callers).toEqual(['gateway/dispatch.ts']);
  });

  it('the router and the frame layer import no service or driver module as a value', () => {
    for (const file of ['http/apiRouter.ts', 'gateway/wsFrames.ts']) {
      const valueImports = read(file)
        .split('\n')
        .filter((l) => /^import\s/.test(l) && !/^import\s+type\s/.test(l));
      for (const line of valueImports) {
        expect(line, `${file}: ${line}`).not.toMatch(/AgentService|TmuxDriver|SshDriver|tmuxKill|SessionManager/);
      }
    }
  });

  it('SessionManager.ts does not call destroy', () => {
    expect(read('services/SessionManager.ts')).not.toMatch(/destroy/);
  });

  it('dispatch.ts applies the policy before any idempotency or service call', () => {
    const src = read('gateway/dispatch.ts');
    const policyAt = src.indexOf('checkDestructivePolicy(');
    expect(policyAt).toBeGreaterThan(-1);
    expect(policyAt).toBeGreaterThan(src.indexOf('private route('));
    expect(policyAt).toBeLessThan(src.indexOf('this.idempotent(msg'));
    expect(policyAt).toBeLessThan(src.indexOf('this.service.'));
  });
});

describe('catalog completeness', () => {
  it('every destructive operation has a confirmParam that is a key of its params', () => {
    for (const [name, op] of destructive()) {
      expect(typeof op.confirmParam, name).toBe('string');
      expect(Object.keys(op.params), name).toContain(op.confirmParam);
    }
  });

  it('no destructive operation has a palette binding', () => {
    for (const [name, op] of destructive()) expect('none' in op.palette, name).toBe(true);
  });

  it('the destructive set equals the set the policy derives', () => {
    expect(destructiveRules().map((r) => r.operation).sort()).toEqual(destructive().map(([n]) => n).sort());
    for (const rule of destructiveRules()) {
      const op = listOperations().find(([n]) => n === rule.operation)![1];
      expect(rule.confirmParam).toBe(op.confirmParam);
    }
  });

  it('a synthetic catalog copy changes the derived rules without touching the real catalog', () => {
    const before = JSON.stringify(listOperations());
    const copy: Record<string, OperationSpec> = Object.fromEntries(listOperations());
    copy['agent.close'] = { ...copy['agent.close'], destructive: true, confirmParam: 'confirm' };
    expect(destructiveRules(copy).map((r) => r.operation).sort()).toEqual(['agent.close', 'agent.kill']);
    expect(JSON.stringify(listOperations())).toBe(before);
  });

  it('no test in this file mutated the real operations catalog', () => {
    expect(JSON.stringify(listOperations())).toBe(CATALOG_AT_LOAD);
  });
});
