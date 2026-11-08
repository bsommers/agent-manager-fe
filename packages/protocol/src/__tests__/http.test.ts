// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHttpBody, hitKey, HTTP_TABLE, LIMITS, CONTRACT_VERSION } from '../index.js';

type Valid = { name: string; kind: string; body: unknown };
type Malformed = { name: string; kind: string; body: unknown; reason: string; field?: string };
type HttpFixtures = { valid: Valid[]; malformed: Malformed[] };

const fixtures: HttpFixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../fixtures/http.json', import.meta.url)), 'utf8'),
);

const KINDS = ['health', 'agents', 'agent', 'ok', 'logs', 'search', 'error'] as const;
// parseHttpBody is typed by kind; the fixture files carry the kind as a plain string.
const parse = (kind: string, body: unknown) => parseHttpBody(kind as (typeof KINDS)[number], body);

const line = { agentId: 'a1', seq: 1, line: 0, ts: 1, text: 'hello' };

describe('http fixtures', () => {
  it.each(fixtures.valid.map((f) => [f.name, f] as const))('%s round-trips unchanged', (_n, f) => {
    const r = parse(f.kind, f.body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toEqual(f.body);
  });

  it.each(fixtures.malformed.map((f) => [f.name, f] as const))('%s is rejected with the stated reason', (_n, f) => {
    const r = parse(f.kind, f.body);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(f.reason);
      if (f.field !== undefined) expect(r.field).toBe(f.field);
    }
  });

  it('has a valid body for each of the seven kinds and at least 8 malformed bodies', () => {
    expect([...new Set(fixtures.valid.map((f) => f.kind))].sort()).toEqual([...KINDS].sort());
    expect(Object.keys(HTTP_TABLE).sort()).toEqual([...KINDS].sort());
    expect(fixtures.malformed.length).toBeGreaterThanOrEqual(8);
  });
});

describe('http caps', () => {
  it('accepts 2000 log lines and rejects 2001', () => {
    const mk = (n: number) => ({ ok: true, lines: Array.from({ length: n }, () => line), hasMore: false });
    expect(parse('logs', mk(2000)).ok).toBe(true);
    const r = parse('logs', mk(2001));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('lines');
  });

  it('accepts 1000 search hits and rejects 1001', () => {
    const hit = { ...line, matchIndex: 0, matchLength: 1 };
    const mk = (n: number) => ({ ok: true, results: Array.from({ length: n }, () => hit) });
    expect(parse('search', mk(1000)).ok).toBe(true);
    const r = parse('search', mk(1001));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('results');
  });

  it('limits context to 5 lines and the cursor to 512 characters', () => {
    const hit = { ...line, matchIndex: 0, matchLength: 1 };
    const body = (extra: object) => ({ ok: true, results: [{ ...hit, ...extra }] });
    expect(parse('search', body({ before: Array(5).fill('x'), after: [] })).ok).toBe(true);
    expect(parse('search', body({ before: Array(6).fill('x') })).ok).toBe(false);
    expect(parse('search', { ok: true, results: [], nextCursor: 'c'.repeat(512) }).ok).toBe(true);
    expect(parse('search', { ok: true, results: [], nextCursor: 'c'.repeat(513) }).ok).toBe(false);
  });

  it('rejects non-objects and unknown kinds without throwing', () => {
    for (const bad of [null, 'x', 1, []]) {
      const r = parse('ok', bad);
      expect(r.ok === false && r.reason).toBe('not_object');
    }
    const r = parse('nope', {});
    expect(r.ok === false && r.reason).toBe('unknown_type');
    expect(parse('constructor', {}).ok).toBe(false);
  });

  it('strips unknown fields', () => {
    const r = parse('ok', { ok: true, extra: 1 });
    expect(r.ok && r.body).toEqual({ ok: true });
  });
});

describe('hitKey', () => {
  it('joins agentId, seq and line', () => {
    expect(hitKey({ agentId: 'a1', seq: 7, line: 3 })).toBe('a1:7:3');
  });
});

describe('contract constants', () => {
  it('adds the search, reconnect and heartbeat constants and keeps the existing ones', () => {
    expect(CONTRACT_VERSION).toBe(1);
    expect(LIMITS.MAX_SEARCH_QUERY_LENGTH).toBe(256);
    expect(LIMITS.RECONNECT).toEqual({ baseMs: 500, factor: 2, capMs: 15000 });
    expect(LIMITS.HEARTBEAT).toEqual({ intervalMs: 15000, timeoutMs: 10000 });
    expect(LIMITS.MAX_AGENTS).toBe(1000);
    expect(LIMITS.MAX_MODE_LENGTH).toBe(64);
    expect(LIMITS.MAX_FRAME_BYTES).toBe(1048576);
  });

  it('is frozen at every level', () => {
    expect(Object.isFrozen(LIMITS)).toBe(true);
    expect(Object.isFrozen(LIMITS.RECONNECT)).toBe(true);
    expect(Object.isFrozen(LIMITS.HEARTBEAT)).toBe(true);
  });
});
