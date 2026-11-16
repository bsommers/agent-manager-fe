import { isIPv6 } from 'node:net';

export interface ThrottleOptions {
  /** Wrong tokens inside one window that trigger a lockout. */
  maxFailures: number;
  windowMs: number;
  /** First lockout; doubles per consecutive lockout. */
  lockMs: number;
  maxLockMs: number;
  /** Hard bound on tracked keys. */
  maxKeys: number;
  now: () => number;
}

/** D-06 defaults: 5 wrong tokens per 60 s, lock 60 s doubling up to 15 min, 10 000 keys. */
export const DEFAULT_THROTTLE: Readonly<Omit<ThrottleOptions, 'now'>> = Object.freeze({
  maxFailures: 5,
  windowMs: 60_000,
  lockMs: 60_000,
  maxLockMs: 900_000,
  maxKeys: 10_000,
});

export type ThrottleCheck = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface AuthThrottle {
  check(key: string): ThrottleCheck;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
  size(): number;
}

const UNKNOWN = 'unknown';
const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Expands an IPv6 address to its eight 16-bit groups, or undefined when it cannot be parsed. */
function expandV6(addr: string): number[] | undefined {
  const bare = addr.split('%')[0];
  if (!isIPv6(bare)) return undefined;
  let text = bare;
  // An embedded dotted quad occupies the last two groups.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tailGroups];
  if (groups.length !== 8) return undefined;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The throttle key for an address: IPv4-mapped IPv6 collapses to IPv4, any other IPv6 address
 * collapses to its /64 so rotating inside a prefix does not evade the limit, and a missing
 * address maps to one constant key.
 */
export function normalizeIp(address: string | undefined): string {
  const raw = (address ?? '').trim();
  if (raw === '') return UNKNOWN;
  const mapped = MAPPED_V4.exec(raw);
  if (mapped) return mapped[1];
  const groups = expandV6(raw);
  if (groups) return `v6:${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}`;
  return raw.toLowerCase();
}

interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
  /** Consecutive lockouts; drives the doubling. */
  strikes: number;
}

/**
 * Per-key failure throttle. Entries hold counters only (never a token or digest) in a Map that is
 * hard-bounded by maxKeys: expired entries are swept lazily on insert, then the oldest is evicted.
 * No timers, so nothing needs unref or cleanup. Never logs.
 */
export function createAuthThrottle(options: Partial<ThrottleOptions> = {}): AuthThrottle {
  const o: ThrottleOptions = { ...DEFAULT_THROTTLE, now: Date.now, ...options };
  const entries = new Map<string, Entry>();

  /** An entry is forgotten once its window and its lock (plus one window of grace for strikes) are over. */
  const lapsed = (e: Entry, now: number): boolean =>
    now >= e.windowStart + o.windowMs && now >= e.lockedUntil + (e.lockedUntil > 0 ? o.windowMs : 0);

  function sweep(now: number): void {
    for (const [key, e] of entries) if (lapsed(e, now)) entries.delete(key);
  }

  function check(rawKey: string): ThrottleCheck {
    const e = entries.get(normalizeIp(rawKey));
    const now = o.now();
    if (e && now < e.lockedUntil) return { allowed: false, retryAfterMs: Math.max(1, e.lockedUntil - now) };
    return { allowed: true };
  }

  function recordFailure(rawKey: string): void {
    const key = normalizeIp(rawKey);
    const now = o.now();
    let e = entries.get(key);
    if (e && lapsed(e, now)) {
      entries.delete(key);
      e = undefined;
    }
    if (e && now < e.lockedUntil) return; // already blocked: the lock is not extended
    if (!e) {
      if (entries.size >= o.maxKeys) {
        sweep(now);
        while (entries.size >= o.maxKeys) {
          const oldest = entries.keys().next();
          if (oldest.done) break;
          entries.delete(oldest.value);
        }
      }
      e = { failures: 0, windowStart: now, lockedUntil: 0, strikes: 0 };
    } else {
      entries.delete(key); // refresh insertion order
      if (e.lockedUntil > 0) {
        // A lock just lapsed: count afresh but remember the strikes.
        e.failures = 0;
        e.windowStart = now;
        e.lockedUntil = 0;
      } else if (now >= e.windowStart + o.windowMs) {
        e.failures = 0;
        e.windowStart = now;
      }
    }
    e.failures += 1;
    if (e.failures >= o.maxFailures) {
      e.lockedUntil = now + Math.min(o.lockMs * 2 ** e.strikes, o.maxLockMs);
      e.strikes += 1;
    }
    entries.set(key, e);
  }

  /**
   * A success clears the failure count but keeps the strike history (WR-02), so successes
   * interleaved on a shared key cannot reset the doubling lockout. A locked entry is left alone. An
   * entry with no strikes holds no history, so it is dropped.
   */
  function recordSuccess(rawKey: string): void {
    const key = normalizeIp(rawKey);
    const e = entries.get(key);
    if (!e) return;
    const now = o.now();
    if (now < e.lockedUntil) return;
    if (e.strikes === 0) {
      entries.delete(key);
      return;
    }
    e.failures = 0;
    e.windowStart = now;
  }

  return { check, recordFailure, recordSuccess, size: () => entries.size };
}
