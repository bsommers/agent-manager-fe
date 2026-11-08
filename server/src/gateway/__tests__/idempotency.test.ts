import { describe, it, expect, vi } from 'vitest';
import { IdempotencyCache, fingerprintOf } from '../idempotency.js';
import { fail } from '../../services/serviceResult.js';

type Out = { ok: true; n: number } | { ok: false; error: { code: string; message: string; retryable: boolean } };

const good = (n: number): Promise<Out> => Promise.resolve({ ok: true, n });
const bad = (): Promise<Out> => {
  const r = fail('BACKEND_DOWN', 'down');
  return Promise.resolve(r.ok ? { ok: true, n: 0 } : { ok: false, error: r.error });
};

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('IdempotencyCache', () => {
  it('executes exec synchronously for a new key', () => {
    const cache = new IdempotencyCache();
    const exec = vi.fn(() => good(1));
    cache.run('r1', 'fp', exec);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns the stored outcome for the same key and fingerprint without calling exec again', async () => {
    const cache = new IdempotencyCache();
    const exec = vi.fn(() => good(7));
    const first = await cache.run('r1', 'fp', exec);
    const second = await cache.run('r1', 'fp', exec);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('gives both callers the same outcome while the first call is still in flight', async () => {
    const cache = new IdempotencyCache();
    let release!: (o: Out) => void;
    const exec = vi.fn(() => new Promise<Out>((res) => (release = res)));
    const p1 = cache.run('r1', 'fp', exec);
    const p2 = cache.run('r1', 'fp', exec);
    expect(exec).toHaveBeenCalledTimes(1);
    release({ ok: true, n: 3 });
    expect(await p1).toEqual({ ok: true, n: 3 });
    expect(await p2).toEqual({ ok: true, n: 3 });
  });

  it('resolves the same key with a different fingerprint to CONFLICT and runs nothing', async () => {
    const cache = new IdempotencyCache();
    await cache.run('r1', 'fp-a', () => good(1));
    const exec = vi.fn(() => good(2));
    const out = await cache.run('r1', 'fp-b', exec);
    expect(exec).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'reqId reused for a different request', retryable: false },
    });
  });

  it('does not cache a failed outcome, so the next call executes again', async () => {
    const cache = new IdempotencyCache();
    const first = vi.fn(bad);
    const out = await cache.run('r1', 'fp', first);
    expect(out.ok).toBe(false);
    expect(cache.size).toBe(0);
    const retry = vi.fn(() => good(5));
    expect(await cache.run('r1', 'fp', retry)).toEqual({ ok: true, n: 5 });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not cache an exec that rejects', async () => {
    const cache = new IdempotencyCache();
    await expect(cache.run('r1', 'fp', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(cache.size).toBe(0);
    expect(await cache.run('r1', 'fp', () => good(1))).toEqual({ ok: true, n: 1 });
  });

  it('purges entries older than five minutes on the next call, using the injected clock', async () => {
    const c = clock();
    const cache = new IdempotencyCache({ now: c.now });
    await cache.run('r1', 'fp', () => good(1));
    c.advance(300_000);
    expect(cache.size).toBe(1); // exactly 5 minutes is not yet older than 5 minutes
    c.advance(1);
    const exec = vi.fn(() => good(2));
    expect(await cache.run('r1', 'fp', exec)).toEqual({ ok: true, n: 2 });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('purges every expired entry, not only the one asked for', async () => {
    const c = clock();
    const cache = new IdempotencyCache({ now: c.now });
    await cache.run('a', 'fp', () => good(1));
    await cache.run('b', 'fp', () => good(2));
    c.advance(300_001);
    await cache.run('c', 'fp', () => good(3));
    expect(cache.size).toBe(1);
  });

  it('keeps at most 1024 entries, evicting the oldest, which then executes again', async () => {
    const cache = new IdempotencyCache();
    for (let i = 0; i < 1024; i++) await cache.run(`k${i}`, 'fp', () => good(i));
    expect(cache.size).toBe(1024);
    await cache.run('k1024', 'fp', () => good(1024));
    expect(cache.size).toBe(1024);
    const evicted = vi.fn(() => good(-1));
    expect(await cache.run('k0', 'fp', evicted)).toEqual({ ok: true, n: -1 });
    expect(evicted).toHaveBeenCalledTimes(1);
    // k1 was evicted by k0's re-insert; k1023 is still cached.
    const kept = vi.fn(() => good(-2));
    expect(await cache.run('k1023', 'fp', kept)).toEqual({ ok: true, n: 1023 });
    expect(kept).not.toHaveBeenCalled();
    expect(cache.size).toBe(1024);
  });

  it('honours custom limits', async () => {
    const cache = new IdempotencyCache({ maxEntries: 2 });
    await cache.run('a', 'fp', () => good(1));
    await cache.run('b', 'fp', () => good(2));
    await cache.run('c', 'fp', () => good(3));
    expect(cache.size).toBe(2);
  });

  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])(
    'treats %s as an ordinary key',
    async (key) => {
      const cache = new IdempotencyCache();
      const exec = vi.fn(() => good(9));
      expect(await cache.run(key, 'fp', exec)).toEqual({ ok: true, n: 9 });
      expect(await cache.run(key, 'fp', exec)).toEqual({ ok: true, n: 9 });
      expect(exec).toHaveBeenCalledTimes(1);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  );
});

describe('fingerprintOf', () => {
  it('is independent of key order', () => {
    expect(fingerprintOf('agent.update', { agentId: 'a', name: 'n', tags: ['x'] })).toBe(
      fingerprintOf('agent.update', { tags: ['x'], name: 'n', agentId: 'a' })
    );
  });

  it('is independent of key order in nested values', () => {
    expect(fingerprintOf('agent.create', { params: { a: 1, b: 2 } })).toBe(
      fingerprintOf('agent.create', { params: { b: 2, a: 1 } })
    );
  });

  it('ignores reqId and type', () => {
    expect(fingerprintOf('agent.create', { type: 'agent:create', reqId: 'r1', name: 'n' })).toBe(
      fingerprintOf('agent.create', { reqId: 'r2', name: 'n' })
    );
  });

  it('includes the operation name', () => {
    expect(fingerprintOf('agent.close', { agentId: 'a' })).not.toBe(fingerprintOf('agent.kill', { agentId: 'a' }));
  });

  it('differs for different requests', () => {
    expect(fingerprintOf('agent.create', { name: 'a' })).not.toBe(fingerprintOf('agent.create', { name: 'b' }));
    expect(fingerprintOf('agent.update', { tags: ['a', 'b'] })).not.toBe(
      fingerprintOf('agent.update', { tags: ['b', 'a'] })
    );
  });

  it('treats an absent field differently from an explicit value', () => {
    expect(fingerprintOf('agent.kill', { agentId: 'a' })).not.toBe(
      fingerprintOf('agent.kill', { agentId: 'a', confirm: true })
    );
  });
});
