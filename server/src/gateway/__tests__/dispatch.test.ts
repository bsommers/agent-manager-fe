import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentService } from '../../services/AgentService.js';
import { TmuxDriver } from '../../services/TmuxDriver.js';
import { SshDriver } from '../../services/SshDriver.js';
import { killTmuxSession } from '../../services/tmuxKill.js';
import { AgentApi } from '../dispatch.js';
import type { DispatchOutcome } from '../dispatch.js';
import { IdempotencyCache } from '../idempotency.js';
import type { WSMessageClient } from '../../protocol/wsProtocol.js';

vi.mock('../../services/TmuxDriver.js', () => ({ TmuxDriver: vi.fn() }));
vi.mock('../../services/SshDriver.js', () => ({ SshDriver: vi.fn() }));
vi.mock('../../services/tmuxKill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tmuxKill.js')>();
  return { ...actual, killTmuxSession: vi.fn() };
});

const killMock = killTmuxSession as unknown as ReturnType<typeof vi.fn>;

interface FakeDriver {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

describe('AgentApi', () => {
  let service: AgentService;
  let api: AgentApi;
  let drivers: FakeDriver[];
  let published: any[];
  const spies: Array<{ mockRestore: () => void }> = [];

  const create = (extra: Record<string, unknown> = {}): WSMessageClient =>
    ({ type: 'agent:create', name: 'a', mode: 'tmux', targetHost: 'h:qa_a', ...extra }) as WSMessageClient;

  const run = (msg: Record<string, unknown>): Promise<DispatchOutcome> => api.execute(msg as WSMessageClient);

  const errorOf = (o: DispatchOutcome) => {
    if (o.ok) throw new Error('expected a failure');
    return o.error;
  };

  async function made(name = 'a', host = 'h:qa_a') {
    const out = await run({ type: 'agent:create', name, mode: 'tmux', targetHost: host });
    if (!out.ok || !out.ack?.agent) throw new Error('create failed');
    published.length = 0;
    return out.ack.agent;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    drivers = [];
    published = [];
    killMock.mockReset();
    killMock.mockResolvedValue('killed');
    for (const m of ['warn', 'error', 'log'] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    }
    (TmuxDriver as any).mockImplementation(function () {
      const d: FakeDriver = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      drivers.push(d);
      return d;
    });
    (SshDriver as any).mockImplementation(function () {
      const d: FakeDriver = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      drivers.push(d);
      return d;
    });
    service = new AgentService((m) => published.push(m));
    api = new AgentApi(service);
  });

  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
  });

  describe('routing', () => {
    it('creates through the service and returns an ack descriptor with a copy of the agent', async () => {
      const out = await run(create());
      expect(out).toMatchObject({ ok: true, ack: { op: 'create', agent: { name: 'a', targetHost: 'h:qa_a' } } });
      const live = service.list()[0];
      if (!out.ok || !out.ack?.agent) throw new Error('unreachable');
      expect(out.ack.agent).toEqual(live);
      expect(out.ack.agent).not.toBe(live);
    });

    it('runs synchronous operations before execute returns its promise', () => {
      void run(create());
      expect(service.count()).toBe(1);
    });

    it('closes without touching tmux for a plain kill', async () => {
      const a = await made();
      const out = await run({ type: 'agent:kill', agentId: a.id });
      expect(out).toEqual({ ok: true, ack: { op: 'kill' } });
      expect(drivers[0].close).toHaveBeenCalledTimes(1);
      expect(killMock).not.toHaveBeenCalled();
    });

    it('destroys through tmux for killSession with confirm', async () => {
      const a = await made();
      const out = await run({ type: 'agent:kill', agentId: a.id, killSession: true, confirm: true });
      expect(out).toEqual({ ok: true, ack: { op: 'kill' } });
      expect(killMock).toHaveBeenCalledWith('qa_a');
    });

    it('keeps the confirm gate: killSession without confirm is USAGE and runs nothing', async () => {
      const a = await made();
      const out = await run({ type: 'agent:kill', agentId: a.id, killSession: true });
      expect(errorOf(out)).toMatchObject({ code: 'USAGE', agentId: a.id });
      expect(killMock).not.toHaveBeenCalled();
      expect(drivers[0].close).not.toHaveBeenCalled();
    });

    it('updates and returns the updated agent', async () => {
      const a = await made();
      const out = await run({ type: 'agent:update', agentId: a.id, name: 'Renamed', tags: ['t'] });
      expect(out).toMatchObject({ ok: true, ack: { op: 'update', agent: { id: a.id, name: 'Renamed', tags: ['t'] } } });
      expect(published).toEqual([{ type: 'agent:updated', agentId: a.id, patch: { name: 'Renamed', tags: ['t'] } }]);
    });

    it('maps an unknown id to NOT_FOUND for kill and update', async () => {
      expect(errorOf(await run({ type: 'agent:kill', agentId: 'ghost' }))).toMatchObject({ code: 'NOT_FOUND' });
      expect(errorOf(await run({ type: 'agent:update', agentId: 'ghost', name: 'n' }))).toMatchObject({
        code: 'NOT_FOUND',
        agentId: 'ghost',
      });
    });

    it('writes input and resizes through the service with a plain ok outcome', async () => {
      const a = await made();
      expect(await run({ type: 'agent:input', agentId: a.id, data: 'x' })).toEqual({ ok: true });
      expect(await run({ type: 'agent:resize', agentId: a.id, cols: 90, rows: 30 })).toEqual({ ok: true });
      expect(drivers[0].write).toHaveBeenCalledWith('x');
      expect(drivers[0].resize).toHaveBeenCalledWith(90, 30);
    });

    it('runs a broadcast with per-target results and no ack', async () => {
      const a = await made();
      const out = await run({ type: 'agent:broadcast', targetAgentIds: [a.id, 'ghost'], data: 'x', reqId: 'b1' });
      expect(out).toMatchObject({ ok: true });
      if (!out.ok) throw new Error('unreachable');
      expect(out.ack).toBeUndefined();
      expect(out.results).toHaveLength(2);
      expect(out.results?.[0]).toEqual({ agentId: a.id, status: 'sent' });
      expect(out.results?.[1]).toMatchObject({ agentId: 'ghost', status: 'failed' });
    });

    it('accepts hello and ping as no-ops', async () => {
      expect(await run({ type: 'hello', contract: 1 })).toEqual({ ok: true });
      expect(await run({ type: 'ping', t: 1 })).toEqual({ ok: true });
    });
  });

  describe('unsupported fields and operations', () => {
    it('refuses a create with a backend and creates nothing', async () => {
      const out = await run(create({ backend: 'docker' }));
      expect(errorOf(out)).toMatchObject({
        code: 'UNSUPPORTED',
        message: 'backends other than the local gateway are not available',
        retryable: false,
      });
      expect(service.count()).toBe(0);
      expect(drivers).toHaveLength(0);
    });

    it('refuses a create with non-empty params and creates nothing', async () => {
      const out = await run(create({ params: { image: 'x' } }));
      expect(errorOf(out)).toMatchObject({
        code: 'UNSUPPORTED',
        message: 'create parameters are not supported by this backend',
      });
      expect(service.count()).toBe(0);
    });

    it('accepts an empty params object', async () => {
      const out = await run(create({ params: {} }));
      expect(out.ok).toBe(true);
      expect(service.count()).toBe(1);
    });

    it.each([
      ['agent:history', { type: 'agent:history', agentId: 'a1', beforeSeq: 5, reqId: 'h1' }],
      ['agent:approve', { type: 'agent:approve', agentId: 'a1', gateId: 'g1', decision: 'approve', reqId: 'h2' }],
    ])('refuses %s with UNSUPPORTED and touches no driver', async (_n, msg) => {
      const out = await run(msg);
      expect(errorOf(out)).toMatchObject({
        code: 'UNSUPPORTED',
        message: 'this operation is not supported by this gateway',
        retryable: false,
      });
      expect(drivers).toHaveLength(0);
    });

    it('does not cache refusals', async () => {
      await run(create({ backend: 'x', reqId: 'r1' }));
      const retry = await run(create({ reqId: 'r1' }));
      expect(retry.ok).toBe(true);
    });
  });

  describe('idempotent reqId', () => {
    it('create twice with one reqId makes one agent and returns the same ack', async () => {
      const first = await run(create({ reqId: 'r1' }));
      const second = await run(create({ reqId: 'r1' }));
      expect(service.count()).toBe(1);
      expect(drivers).toHaveLength(1);
      expect(second).toEqual(first);
    });

    it('create replay issued before the first settles still makes one agent', async () => {
      const p1 = run(create({ reqId: 'r1' }));
      const p2 = run(create({ reqId: 'r1' }));
      expect(await p2).toEqual(await p1);
      expect(service.count()).toBe(1);
    });

    it('refuses the same reqId with a different request as CONFLICT and creates nothing', async () => {
      await run(create({ reqId: 'r1' }));
      const out = await run(create({ reqId: 'r1', name: 'other' }));
      expect(errorOf(out)).toMatchObject({ code: 'CONFLICT', message: 'reqId reused for a different request' });
      expect(service.count()).toBe(1);
    });

    it('treats a reqId reused across operations as CONFLICT', async () => {
      const a = await made();
      await run({ type: 'agent:update', agentId: a.id, name: 'x', reqId: 'r9' });
      const out = await run({ type: 'agent:kill', agentId: a.id, reqId: 'r9' });
      expect(errorOf(out).code).toBe('CONFLICT');
      expect(service.count()).toBe(1);
    });

    it('does not cache a failing create, so a later create with that reqId runs and succeeds', async () => {
      (TmuxDriver as any).mockImplementationOnce(function () {
        throw new Error('spawn failed');
      });
      const failed = await run(create({ reqId: 'r1' }));
      expect(errorOf(failed).code).toBe('BACKEND_DOWN');
      const retry = await run(create({ reqId: 'r1' }));
      expect(retry.ok).toBe(true);
      expect(service.count()).toBe(1);
    });

    it('close twice with one reqId succeeds once and the replay returns the original ack', async () => {
      const a = await made();
      const first = await run({ type: 'agent:kill', agentId: a.id, reqId: 'k1' });
      const second = await run({ type: 'agent:kill', agentId: a.id, reqId: 'k1' });
      expect(first).toEqual({ ok: true, ack: { op: 'kill' } });
      expect(second).toEqual(first);
      expect(drivers[0].close).toHaveBeenCalledTimes(1);
    });

    it('destroy replay does not call tmux again', async () => {
      const a = await made();
      const msg = { type: 'agent:kill', agentId: a.id, killSession: true, confirm: true, reqId: 'k2' };
      const first = await run(msg);
      const second = await run(msg);
      expect(second).toEqual(first);
      expect(killMock).toHaveBeenCalledTimes(1);
    });

    it('a destroy replay while the kill is in flight shares one tmux call', async () => {
      const a = await made();
      let release!: (v: string) => void;
      killMock.mockReturnValueOnce(new Promise((res) => (release = res)));
      const msg = { type: 'agent:kill', agentId: a.id, killSession: true, confirm: true, reqId: 'k3' };
      const p1 = run(msg);
      const p2 = run(msg);
      release('killed');
      expect(await p2).toEqual(await p1);
      expect(killMock).toHaveBeenCalledTimes(1);
    });

    it('update replay does not apply twice', async () => {
      const a = await made();
      const msg = { type: 'agent:update', agentId: a.id, name: 'N', reqId: 'u1' };
      const first = await run(msg);
      const second = await run(msg);
      expect(second).toEqual(first);
      expect(published.filter((p) => p.type === 'agent:updated')).toHaveLength(1);
    });

    it('does not cache a failed close, so the retry executes again', async () => {
      const miss = await run({ type: 'agent:kill', agentId: 'ghost', reqId: 'k4' });
      expect(errorOf(miss).code).toBe('NOT_FOUND');
      const a = await made();
      const ok = await run({ type: 'agent:kill', agentId: a.id, reqId: 'k4' });
      expect(ok.ok).toBe(true);
    });

    it('never caches requests without a reqId', async () => {
      await run(create());
      await run(create());
      expect(service.count()).toBe(2);
    });

    it('does not make input, resize or broadcast idempotent', async () => {
      const a = await made();
      await run({ type: 'agent:broadcast', targetAgentIds: [a.id], data: 'x', reqId: 'b' });
      await run({ type: 'agent:broadcast', targetAgentIds: [a.id], data: 'x', reqId: 'b' });
      expect(drivers[0].write).toHaveBeenCalledTimes(2);
    });

    it('shares one cache between APIs that are given the same instance', async () => {
      const cache = new IdempotencyCache();
      const apiA = new AgentApi(service, { cache });
      const apiB = new AgentApi(service, { cache });
      await apiA.execute(create({ reqId: 'shared' }));
      await apiB.execute(create({ reqId: 'shared' }));
      expect(service.count()).toBe(1);
    });
  });
});
