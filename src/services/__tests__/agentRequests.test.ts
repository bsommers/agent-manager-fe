import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentRequests,
  AgentRequestError,
  newReqId,
  REQUEST_TIMEOUT_MS,
} from '../agentRequests';
import type { WSMessageClient } from '../wsProtocol';

const AGENT = {
  id: 'agent-1',
  name: 'Build',
  mode: 'tmux',
  targetHost: 'localhost:build',
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1,
  lastActivity: 2,
};

const createFrame =
  (extra: Record<string, unknown> = {}) =>
  (reqId: string): WSMessageClient =>
    ({ type: 'agent:create', name: 'Build', mode: 'tmux', targetHost: 'localhost:build', reqId, ...extra }) as WSMessageClient;

describe('AgentRequests', () => {
  let sent: WSMessageClient[];
  let deliver: boolean;
  let layer: AgentRequests;
  let ids: number;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    deliver = true;
    ids = 0;
    layer = new AgentRequests({
      send: (m) => {
        sent.push(m);
        return deliver;
      },
      newReqId: () => `req-${++ids}`,
    });
  });

  afterEach(() => {
    layer.clear();
    vi.useRealTimers();
  });

  it('sends exactly one frame carrying the generated reqId and returns the same reqId', () => {
    const h = layer.request(createFrame());
    h.promise.catch(() => {});
    expect(sent).toHaveLength(1);
    expect((sent[0] as { reqId?: string }).reqId).toBe(h.reqId);
    expect(h.reqId).toBe('req-1');
  });

  it('an agent:ack with the reqId resolves with op and agent', async () => {
    const h = layer.request(createFrame());
    const out = layer.handleServerMessage({ type: 'agent:ack', reqId: h.reqId, op: 'create', ok: true, agent: AGENT });
    expect(out).toBe('consumed');
    const res = await h.promise;
    expect(res.op).toBe('create');
    expect(res.agent?.id).toBe('agent-1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an agent:error with the reqId rejects with a typed error', async () => {
    const h = layer.request(createFrame());
    layer.handleServerMessage({
      type: 'agent:error',
      reqId: h.reqId,
      agentId: 'agent-1',
      code: 'CONFLICT',
      message: 'name taken',
      retryable: false,
    });
    const err = await h.promise.catch((e) => e);
    expect(err).toBeInstanceOf(AgentRequestError);
    expect(err).toMatchObject({
      code: 'CONFLICT',
      message: 'name taken',
      retryable: false,
      agentId: 'agent-1',
      reqId: h.reqId,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with TIMEOUT after 10 s without an answer and clears its timer', async () => {
    const h = layer.request(createFrame());
    const settled = h.promise.catch((e) => e);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1);
    const err = await settled;
    expect(err).toBeInstanceOf(AgentRequestError);
    expect(err.code).toBe('TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('send returning false throws NOT_CONNECTED synchronously and keeps nothing', () => {
    deliver = false;
    let caught: unknown;
    try {
      layer.request(createFrame());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AgentRequestError);
    expect((caught as AgentRequestError).code).toBe('NOT_CONNECTED');
    expect(vi.getTimerCount()).toBe(0);
    expect(layer.resendInFlight()).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it('an ack for an unknown reqId is ignored', () => {
    expect(layer.handleServerMessage({ type: 'agent:ack', reqId: 'nope', op: 'create', ok: true })).toBe('ignored');
    expect(
      layer.handleServerMessage({ type: 'agent:error', reqId: 'nope', code: 'INTERNAL', message: 'x', retryable: false }),
    ).toBe('ignored');
  });

  it('an agent:error without a reqId is ignored', () => {
    expect(layer.handleServerMessage({ type: 'agent:error', code: 'INTERNAL', message: 'x', retryable: false })).toBe(
      'ignored',
    );
  });

  it('other message types are ignored', () => {
    expect(layer.handleServerMessage({ type: 'agent:init_list', agents: [] })).toBe('ignored');
  });

  it('a late answer for a request settled within the last 64 is consumed and changes nothing', async () => {
    const h = layer.request(createFrame());
    const settled = h.promise.catch((e) => e);
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    const err = await settled;
    expect(err.code).toBe('TIMEOUT');
    expect(layer.handleServerMessage({ type: 'agent:ack', reqId: h.reqId, op: 'create', ok: true, agent: AGENT })).toBe(
      'consumed',
    );
    expect(
      layer.handleServerMessage({ type: 'agent:error', reqId: h.reqId, code: 'INTERNAL', message: 'late', retryable: false }),
    ).toBe('consumed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a settled request is forgotten after 64 newer ones', async () => {
    const first = layer.request(createFrame());
    layer.handleServerMessage({ type: 'agent:ack', reqId: first.reqId, op: 'create', ok: true });
    await first.promise;
    for (let i = 0; i < 64; i++) {
      const h = layer.request(createFrame());
      layer.handleServerMessage({ type: 'agent:ack', reqId: h.reqId, op: 'create', ok: true });
      await h.promise;
    }
    expect(layer.handleServerMessage({ type: 'agent:ack', reqId: first.reqId, op: 'create', ok: true })).toBe('ignored');
  });

  it('an invalid ack for a known reqId rejects with INTERNAL', async () => {
    const h = layer.request(createFrame());
    const out = layer.handleServerMessage({ type: 'agent:ack', reqId: h.reqId, op: 'create', ok: true, agent: { id: 7 } });
    expect(out).toBe('consumed');
    const err = await h.promise.catch((e) => e);
    expect(err.code).toBe('INTERNAL');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an invalid agent:error for a known reqId rejects with INTERNAL', async () => {
    const h = layer.request(createFrame());
    layer.handleServerMessage({ type: 'agent:error', reqId: h.reqId, code: 'NOPE', message: 3, retryable: 'x' });
    const err = await h.promise.catch((e) => e);
    expect(err.code).toBe('INTERNAL');
  });

  it('every settle clears its timer, with several requests in flight', async () => {
    const a = layer.request(createFrame());
    const b = layer.request(createFrame());
    const c = layer.request(createFrame());
    expect(vi.getTimerCount()).toBe(3);
    layer.handleServerMessage({ type: 'agent:ack', reqId: b.reqId, op: 'create', ok: true });
    await b.promise;
    expect(vi.getTimerCount()).toBe(2);
    layer.handleServerMessage({ type: 'agent:error', reqId: a.reqId, code: 'USAGE', message: 'm', retryable: false });
    await a.promise.catch(() => {});
    expect(vi.getTimerCount()).toBe(1);
    layer.handleServerMessage({ type: 'agent:ack', reqId: c.reqId, op: 'create', ok: true });
    await c.promise;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose rejects everything in flight with NOT_CONNECTED', async () => {
    const a = layer.request(createFrame());
    const b = layer.request(createFrame());
    layer.dispose();
    expect((await a.promise.catch((e) => e)).code).toBe('NOT_CONNECTED');
    expect((await b.promise.catch((e) => e)).code).toBe('NOT_CONNECTED');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clear drops entries and timers without rejecting', async () => {
    const h = layer.request(createFrame());
    let settledState = 'pending';
    h.promise.then(
      () => (settledState = 'resolved'),
      () => (settledState = 'rejected'),
    );
    layer.clear();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(settledState).toBe('pending');
    expect(layer.handleServerMessage({ type: 'agent:ack', reqId: h.reqId, op: 'create', ok: true })).toBe('ignored');
  });

  describe('resendInFlight', () => {
    it('re-sends the identical frame once and restarts the timer', async () => {
      const h = layer.request(createFrame());
      const settled = h.promise.catch((e) => e);
      vi.advanceTimersByTime(6000);
      layer.resendInFlight();
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      expect((sent[1] as { reqId?: string }).reqId).toBe(h.reqId);
      vi.advanceTimersByTime(6000);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(4000);
      const err = await settled;
      expect(err.code).toBe('TIMEOUT');
    });

    it('sends at most three transmissions in total', () => {
      const h = layer.request(createFrame());
      h.promise.catch(() => {});
      layer.resendInFlight();
      layer.resendInFlight();
      layer.resendInFlight();
      layer.resendInFlight();
      expect(sent).toHaveLength(3);
    });

    it('does not re-send a settled request', async () => {
      const h = layer.request(createFrame());
      layer.handleServerMessage({ type: 'agent:ack', reqId: h.reqId, op: 'create', ok: true });
      await h.promise;
      layer.resendInFlight();
      expect(sent).toHaveLength(1);
    });

    it('when the send fails the entry and its timer are left alone', async () => {
      const h = layer.request(createFrame());
      const settled = h.promise.catch((e) => e);
      deliver = false;
      vi.advanceTimersByTime(5000);
      layer.resendInFlight();
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(5000);
      expect((await settled).code).toBe('TIMEOUT');
      deliver = true;
      layer.resendInFlight();
      expect(sent).toHaveLength(2);
    });

    it('an ack to the re-sent frame resolves the original promise', async () => {
      const h = layer.request(createFrame());
      layer.resendInFlight();
      layer.handleServerMessage({ type: 'agent:ack', reqId: h.reqId, op: 'create', ok: true, agent: AGENT });
      expect((await h.promise).agent?.id).toBe('agent-1');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('re-sends in insertion order', () => {
      const a = layer.request(createFrame());
      const b = layer.request(createFrame());
      a.promise.catch(() => {});
      b.promise.catch(() => {});
      sent.length = 0;
      layer.resendInFlight();
      expect(sent.map((m) => (m as { reqId?: string }).reqId)).toEqual([a.reqId, b.reqId]);
    });
  });
});

describe('newReqId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns distinct UUID-shaped values', () => {
    const a = newReqId();
    const b = newReqId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('works when crypto.randomUUID is undefined (plain-http origin)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => crypto_fill(a) });
    const a = newReqId();
    const b = newReqId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('still returns a value with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newReqId().length).toBeGreaterThan(8);
  });
});

function crypto_fill(a: Uint8Array): Uint8Array {
  for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return a;
}
