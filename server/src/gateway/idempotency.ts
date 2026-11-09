import { fail } from '../services/serviceResult.js';
import type { ServiceError } from '../services/serviceResult.js';

export interface IdempotencyOptions {
  /** Most entries kept; the oldest COMPLETED one is evicted for a new key. Default 1024. */
  maxEntries?: number;
  /** Entries older than this are purged on the next call. Default 5 minutes. */
  ttlMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

interface Entry<T> {
  fingerprint: string;
  at: number;
  outcome: Promise<T>;
  /** False while exec is in flight; in-flight entries are never evicted or expired. */
  settled: boolean;
}

export const DEFAULT_MAX_ENTRIES = 1024;
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** A cached request's outcome shape: anything that reports success with `ok`. */
interface HasOk {
  ok: boolean;
}

type ConflictFailure = { ok: false; error: ServiceError };
type CacheFailure = ConflictFailure;

/**
 * reqId store: bounded, expiring, and shared by every surface that goes through one AgentApi.
 * A repeated reqId with the same fingerprint returns the stored outcome (also while the first call is
 * still in flight); with another fingerprint it is a CONFLICT and nothing runs; failures are removed.
 * Backed by a Map, so keys such as `__proto__` and `constructor` are ordinary keys.
 */
export class IdempotencyCache {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: IdempotencyOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Runs `exec` synchronously for a new key and stores its outcome; replays the stored one otherwise. */
  run<T extends HasOk>(reqId: string, fingerprint: string, exec: () => Promise<T>): Promise<T | CacheFailure> {
    this.purgeExpired();
    const existing = this.entries.get(reqId) as Entry<T> | undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.resolve(conflict());
      return existing.outcome;
    }

    // Make room by evicting the oldest COMPLETED entries only. Evicting an in-flight entry would let a
    // retry of that reqId run a second time (a duplicate create), so when everything left is in flight
    // the new request is refused instead; the cache never grows past maxEntries.
    while (this.entries.size >= this.maxEntries) {
      let victim: string | undefined;
      for (const [key, e] of this.entries) {
        if (e.settled) {
          victim = key;
          break;
        }
      }
      if (victim === undefined) return Promise.resolve(rateLimited());
      this.entries.delete(victim);
    }

    const entry: Entry<T> = { fingerprint, at: this.now(), outcome: undefined as never, settled: false };
    // Registered before exec runs so an overlapping call finds it; exec itself starts synchronously.
    this.entries.set(reqId, entry);
    let outcome: Promise<T>;
    try {
      outcome = exec();
    } catch (err) {
      this.entries.delete(reqId);
      return Promise.reject(err);
    }
    entry.outcome = outcome;
    const forget = () => {
      if (this.entries.get(reqId) === entry) this.entries.delete(reqId);
    };
    outcome.then(
      (o) => {
        entry.settled = true;
        if (!o.ok) forget();
      },
      () => {
        entry.settled = true;
        forget();
      }
    );
    return outcome;
  }

  private purgeExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      // Insertion order is age order, so the first live entry ends the scan.
      if (entry.at >= cutoff) break;
      // An in-flight entry outlives the TTL; its retry must still find it.
      if (!entry.settled) continue;
      this.entries.delete(key);
    }
  }
}

function rateLimited(): CacheFailure {
  const r = fail('RATE_LIMITED', 'too many requests in flight, retry shortly', { retryable: true });
  if (r.ok) throw new Error('unreachable');
  return { ok: false, error: r.error };
}

function conflict(): ConflictFailure {
  const r = fail('CONFLICT', 'reqId reused for a different request', { retryable: false });
  if (r.ok) throw new Error('unreachable');
  return { ok: false, error: r.error };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      Object.defineProperty(out, key, {
        value: stable((value as Record<string, unknown>)[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

/**
 * A stable identity for a request: the operation name plus the message fields other than `type` and
 * `reqId`, with object keys sorted at every depth. Two requests with the same fingerprint are the same
 * request for idempotency purposes.
 */
export function fingerprintOf(operation: string, message: object): string {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(message)) {
    if (key === 'type' || key === 'reqId') continue;
    Object.defineProperty(fields, key, {
      value: (message as Record<string, unknown>)[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return JSON.stringify([operation, stable(fields)]);
}
