import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_THROTTLE, createAuthThrottle, normalizeIp } from '../authThrottle.js';

function make(overrides: Parameters<typeof createAuthThrottle>[0] = {}) {
  let t = 0;
  const throttle = createAuthThrottle({
    maxFailures: 3,
    windowMs: 1000,
    lockMs: 500,
    maxLockMs: 4000,
    maxKeys: 100,
    now: () => t,
    ...overrides,
  });
  return { throttle, advance: (ms: number) => (t += ms), set: (ms: number) => (t = ms) };
}

describe('createAuthThrottle', () => {
  it('blocks on the Nth failure inside the window and reports the remaining lock', () => {
    const { throttle } = make();
    throttle.recordFailure('k');
    throttle.recordFailure('k');
    expect(throttle.check('k')).toEqual({ allowed: true });
    throttle.recordFailure('k');
    expect(throttle.check('k')).toEqual({ allowed: false, retryAfterMs: 500 });
  });

  it('counts down retryAfterMs and allows again after the lock lapses', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('k');
    advance(200);
    expect(throttle.check('k')).toEqual({ allowed: false, retryAfterMs: 300 });
    advance(300);
    expect(throttle.check('k')).toEqual({ allowed: true });
  });

  it('starts a new window at one after the window lapses', () => {
    const { throttle, advance } = make();
    throttle.recordFailure('k');
    throttle.recordFailure('k');
    advance(1000);
    throttle.recordFailure('k');
    throttle.recordFailure('k');
    expect(throttle.check('k').allowed).toBe(true);
  });

  it('never blocks failures spread over more than the window', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 10; i++) {
      throttle.recordFailure('k');
      advance(600);
      expect(throttle.check('k').allowed).toBe(true);
    }
  });

  it('doubles the lock per consecutive lockout up to the cap', () => {
    const { throttle, advance } = make();
    const lockout = () => {
      for (let i = 0; i < 3; i++) throttle.recordFailure('k');
      const c = throttle.check('k');
      expect(c.allowed).toBe(false);
      return c.allowed ? 0 : c.retryAfterMs;
    };
    expect(lockout()).toBe(500);
    advance(500);
    expect(lockout()).toBe(1000);
    advance(1000);
    expect(lockout()).toBe(2000);
    advance(2000);
    expect(lockout()).toBe(4000);
    advance(4000);
    expect(lockout()).toBe(4000);
  });

  it('keeps strike history across a success so the next lockout still doubles (WR-02)', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('k');
    advance(500);
    for (let i = 0; i < 3; i++) throttle.recordFailure('k'); // strikes 2, lock 1000
    advance(1000);
    throttle.recordSuccess('k');
    expect(throttle.size()).toBe(1);
    for (let i = 0; i < 3; i++) throttle.recordFailure('k');
    expect(throttle.check('k')).toEqual({ allowed: false, retryAfterMs: 2000 });
  });

  it('clears the failure count on success but never a lock', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('k'); // strikes 1
    advance(500);
    throttle.recordFailure('k');
    throttle.recordFailure('k');
    throttle.recordSuccess('k'); // failures 2 -> 0
    throttle.recordFailure('k');
    expect(throttle.check('k').allowed).toBe(true);
    for (let i = 0; i < 2; i++) throttle.recordFailure('k');
    const locked = throttle.check('k');
    expect(locked).toEqual({ allowed: false, retryAfterMs: 1000 });
    advance(100);
    throttle.recordSuccess('k'); // locked: untouched
    expect(throttle.check('k')).toEqual({ allowed: false, retryAfterMs: 900 });
  });

  it('forgets strikes once the entry lapses', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('k');
    advance(500);
    throttle.recordSuccess('k');
    advance(10_000);
    for (let i = 0; i < 3; i++) throttle.recordFailure('k');
    expect(throttle.check('k')).toEqual({ allowed: false, retryAfterMs: 500 });
  });

  it('drops an entry without strikes on success', () => {
    const { throttle } = make();
    throttle.recordFailure('k');
    throttle.recordSuccess('k');
    expect(throttle.size()).toBe(0);
  });

  it('treats recordSuccess for an unknown key as a no-op', () => {
    const { throttle } = make();
    throttle.recordSuccess('nobody');
    expect(throttle.size()).toBe(0);
  });

  it('does not extend a lock when a blocked key fails again', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('k');
    advance(100);
    throttle.recordFailure('k');
    throttle.recordFailure('k');
    expect(throttle.check('k')).toEqual({ allowed: false, retryAfterMs: 400 });
  });

  it('never holds more than maxKeys entries and evicts the oldest first', () => {
    const { throttle } = make({ maxKeys: 100 });
    for (let i = 0; i < 300; i++) {
      throttle.recordFailure(`k${i}`);
      expect(throttle.size()).toBeLessThanOrEqual(100);
    }
    expect(throttle.size()).toBe(100);
    // the newest key is tracked: two more failures lock it; the oldest was evicted and starts fresh
    throttle.recordFailure('k299');
    throttle.recordFailure('k299');
    expect(throttle.check('k299').allowed).toBe(false);
    throttle.recordFailure('k0');
    throttle.recordFailure('k0');
    expect(throttle.check('k0').allowed).toBe(true);
  });

  it('sweeps expired entries before evicting live ones', () => {
    const { throttle, advance } = make({ maxKeys: 10 });
    for (let i = 0; i < 10; i++) throttle.recordFailure(`old${i}`);
    expect(throttle.size()).toBe(10);
    advance(10_000);
    throttle.recordFailure('fresh');
    expect(throttle.size()).toBe(1);
  });

  it('never evicts a locked entry to make room; evicts the oldest unlocked one (WR-04)', () => {
    const { throttle } = make({ maxKeys: 5 });
    for (let i = 0; i < 3; i++) throttle.recordFailure('locked'); // inserted first, locked
    for (let i = 0; i < 4; i++) throttle.recordFailure(`u${i}`);
    expect(throttle.size()).toBe(5);
    for (let i = 0; i < 50; i++) {
      throttle.recordFailure(`flood${i}`);
      expect(throttle.size()).toBeLessThanOrEqual(5);
      expect(throttle.check('locked').allowed).toBe(false);
    }
  });

  it('keeps the strike count of a locked entry through a flood (WR-04)', () => {
    const { throttle, advance } = make({ maxKeys: 3 });
    for (let i = 0; i < 3; i++) throttle.recordFailure('victim'); // strikes 1, lock 500
    advance(500);
    for (let i = 0; i < 3; i++) throttle.recordFailure('victim'); // strikes 2, lock 1000
    for (let i = 0; i < 20; i++) throttle.recordFailure(`flood${i}`);
    expect(throttle.check('victim')).toEqual({ allowed: false, retryAfterMs: 1000 });
  });

  it('shares one overflow entry when every tracked entry is locked, still bounded', () => {
    const { throttle } = make({ maxKeys: 3 });
    for (const k of ['a', 'b', 'c']) for (let i = 0; i < 3; i++) throttle.recordFailure(k);
    expect(throttle.check('new1').allowed).toBe(true);
    for (let i = 0; i < 3; i++) throttle.recordFailure(`new${i}`); // spread over untracked keys
    expect(throttle.size()).toBe(3);
    expect(['a', 'b', 'c'].every((k) => !throttle.check(k).allowed)).toBe(true);
    expect(throttle.check('another').allowed).toBe(false); // the overflow entry throttles the untracked
  });

  it('exposes no way to store a token: methods take only a key', () => {
    const { throttle } = make();
    const canary = 'CANARY-TOKEN-abcdefghijklmnopqrstuvwxyz';
    throttle.recordFailure('1.2.3.4');
    const dump = JSON.stringify({
      size: throttle.size(),
      check: throttle.check('1.2.3.4'),
      keys: Object.keys(throttle),
    });
    expect(dump).not.toContain(canary);
    expect(Object.keys(throttle).sort()).toEqual(['check', 'recordFailure', 'recordSuccess', 'size']);
    expect(throttle.check.length).toBe(1);
    expect(throttle.recordFailure.length).toBe(1);
    expect(throttle.recordSuccess.length).toBe(1);
  });

  it('normalizes keys so mapped and plain IPv4 share an entry', () => {
    const { throttle } = make();
    throttle.recordFailure('::ffff:1.2.3.4');
    throttle.recordFailure('1.2.3.4');
    throttle.recordFailure('::FFFF:1.2.3.4');
    expect(throttle.size()).toBe(1);
    expect(throttle.check('1.2.3.4').allowed).toBe(false);
  });

  it('has sane defaults', () => {
    expect(DEFAULT_THROTTLE).toMatchObject({
      maxFailures: 5,
      windowMs: 60_000,
      lockMs: 60_000,
      maxLockMs: 900_000,
      maxKeys: 10_000,
    });
  });

  it('uses the real clock when none is injected', () => {
    const throttle = createAuthThrottle({ maxFailures: 1 });
    throttle.recordFailure('k');
    const c = throttle.check('k');
    expect(c.allowed).toBe(false);
  });
});

describe('normalizeIp', () => {
  it('collapses an IPv4-mapped IPv6 address to IPv4', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('1.2.3.4')).toBe('1.2.3.4');
  });

  it('collapses IPv6 to its /64', () => {
    expect(normalizeIp('2001:db8:1:2::1')).toBe(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'));
    expect(normalizeIp('2001:db8:1:2::1')).not.toBe(normalizeIp('2001:db8:1:3::1'));
    expect(normalizeIp('2001:DB8:1:2::1')).toBe(normalizeIp('2001:db8:1:2::2'));
  });

  it('keeps ::1 distinct from 127.0.0.1', () => {
    expect(normalizeIp('::1')).not.toBe(normalizeIp('127.0.0.1'));
  });

  it('maps undefined and empty to one constant key', () => {
    expect(normalizeIp(undefined)).toBe('unknown');
    expect(normalizeIp('')).toBe('unknown');
    expect(normalizeIp('   ')).toBe('unknown');
  });
});

describe('authThrottle logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never writes to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    );
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.recordFailure('k');
    throttle.check('k');
    throttle.recordSuccess('k');
    throttle.size();
    normalizeIp('::ffff:1.2.3.4');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
