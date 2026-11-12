import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONFIG,
  assertBindPolicy,
  assertLoopbackBind,
  parseTrustProxy,
  resolveAuthToken,
  validateAuthToken,
} from '../src/config.js';

const GOOD = 'a'.repeat(24);
const rule = (e: unknown) => (e as Error).message;

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
}

describe('resolveAuthToken', () => {
  it('is undefined when unset or empty (zero-config local)', () => {
    expect(resolveAuthToken({})).toBeUndefined();
    expect(resolveAuthToken({ AGENT_MANAGER_TOKEN: '' })).toBeUndefined();
  });

  it('returns a valid token unchanged', () => {
    expect(resolveAuthToken({ AGENT_MANAGER_TOKEN: GOOD })).toBe(GOOD);
    expect(resolveAuthToken({ AGENT_MANAGER_TOKEN: 'x'.repeat(512) })).toBe('x'.repeat(512));
    expect(resolveAuthToken({ AGENT_MANAGER_TOKEN: 'Zk3$-_.~!@#%^&*()+=,;:/?<>[]{}|\\"\'`ab' })).toBeDefined();
  });

  const bad: [string, string][] = [
    ['23 characters', 'CANARY'.padEnd(23, 'q')],
    ['513 characters', 'CANARY'.padEnd(513, 'q')],
    ['a space', 'CANARY-with space-0123456789abc'],
    ['a tab', 'CANARY-with\ttab-0123456789abcde'],
    ['a trailing newline', 'CANARY-0123456789-abcdefghij\n'],
    ['a non-ASCII character', 'CANARY-café-0123456789abcdef'],
    ['a control character', 'CANARY-\u0001-0123456789abcdefgh'],
    ['whitespace only', '                              '],
  ];

  it.each(bad)('refuses %s and never quotes the value', (_name, value) => {
    const err = thrown(() => resolveAuthToken({ AGENT_MANAGER_TOKEN: value }));
    const msg = rule(err);
    expect(msg).toContain('AGENT_MANAGER_TOKEN');
    expect(msg).toMatch(/24/);
    expect(msg).toMatch(/512/);
    expect(msg).toMatch(/printable ASCII/i);
    expect(msg).toMatch(/space/i);
    expect(msg).not.toContain('CANARY');
    expect(msg).not.toContain(value.trim() || '\u0000none');
    expect(msg).not.toContain(String(value.length));
  });
});

describe('validateAuthToken', () => {
  it('returns for a valid token', () => {
    expect(() => validateAuthToken(GOOD)).not.toThrow();
  });

  it('throws for each invalid shape', () => {
    for (const v of ['short', 'x'.repeat(513), 'has space has space has space', 'café'.repeat(8), '']) {
      expect(() => validateAuthToken(v)).toThrowError(/AGENT_MANAGER_TOKEN/);
    }
  });

  it('throws for a non-string', () => {
    expect(() => validateAuthToken(undefined as unknown as string)).toThrowError(/AGENT_MANAGER_TOKEN/);
  });
});

describe('assertBindPolicy', () => {
  it.each(['127.0.0.1', 'localhost', '::1', '127.5.5.5'])('allows loopback %s without a token', (h) => {
    expect(() => assertBindPolicy(h, undefined)).not.toThrow();
  });

  it.each(['0.0.0.0', '192.168.1.5', 'example.com'])('refuses %s without a token', (h) => {
    const err = thrown(() => assertBindPolicy(h, undefined));
    expect(err.message).toMatch(/HOST/);
    expect(err.message).toMatch(/AGENT_MANAGER_TOKEN/);
    expect(err.message).toMatch(/unset HOST or use 127\.0\.0\.1/i);
  });

  it.each(['0.0.0.0', '192.168.1.5', '127.0.0.1'])('allows %s with a valid token', (h) => {
    expect(() => assertBindPolicy(h, GOOD)).not.toThrow();
  });

  it('keeps assertLoopbackBind refusing with the pinned phrases and now names the token', () => {
    const msg = thrown(() => assertLoopbackBind('0.0.0.0')).message;
    expect(msg).toMatch(/HOST/);
    expect(msg).toMatch(/no authentication/i);
    expect(msg).toMatch(/unset HOST or use 127\.0\.0\.1/i);
    expect(msg).toMatch(/AGENT_MANAGER_TOKEN/);
    expect(() => assertLoopbackBind('127.0.0.1')).not.toThrow();
  });
});

describe('parseTrustProxy', () => {
  it.each([undefined, '', '0', 'false', 'FALSE', ' 0 '])('parses %j as false', (v) => {
    expect(parseTrustProxy(v)).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', ' 1 '])('parses %j as true', (v) => {
    expect(parseTrustProxy(v)).toBe(true);
  });

  it.each(['yes', '2', 'on'])('rejects %j naming the variable', (v) => {
    expect(() => parseTrustProxy(v)).toThrowError(/AGENT_MANAGER_TRUST_PROXY/);
  });
});

describe('CONFIG', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('has a boolean TRUST_PROXY and no property naming a token', () => {
    expect(typeof CONFIG.TRUST_PROXY).toBe('boolean');
    expect(Object.keys(CONFIG).filter((k) => /token/i.test(k))).toEqual([]);
  });

  it('never contains a token set in the environment before import', async () => {
    const canary = 'CANARY-ENV-TOKEN-0123456789abcdef';
    vi.stubEnv('AGENT_MANAGER_TOKEN', canary);
    vi.resetModules();
    const fresh = await import('../src/config.js');
    expect(JSON.stringify(fresh.CONFIG)).not.toContain(canary);
    expect(Object.keys(fresh.CONFIG).filter((k) => /token/i.test(k))).toEqual([]);
  });

  it('reads AGENT_MANAGER_TRUST_PROXY at import', async () => {
    vi.stubEnv('AGENT_MANAGER_TRUST_PROXY', '1');
    vi.resetModules();
    const fresh = await import('../src/config.js');
    expect(fresh.CONFIG.TRUST_PROXY).toBe(true);
  });
});

describe('handshake constants match the contract spec', async () => {
  const spec = readFileSync(
    fileURLToPath(new URL('../../docs/superpowers/specs/2026-11-07-fe-be-contract.md', import.meta.url)),
    'utf8'
  );
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    version: string;
  };
  const hs = await import('../src/gateway/handshake.js');
  const { LIMITS } = await import('../src/protocol/wsProtocol.js');

  it('close codes equal the spec section 2.6 rows', () => {
    const section = spec.slice(spec.indexOf('### 2.6'), spec.indexOf('## 3.'));
    expect(section).toMatch(new RegExp(`\\|\\s*${hs.CLOSE_UNAUTHENTICATED}\\s*\\|\\s*Unauthenticated`));
    expect(section).toMatch(new RegExp(`\\|\\s*${hs.CLOSE_RATE_LIMITED}\\s*\\|\\s*Rate limited`));
  });

  it('the hello timeout matches the spec sentence', () => {
    const m = /no `hello` within (\d+) s/.exec(spec);
    expect(m).not.toBeNull();
    expect(hs.HELLO_TIMEOUT_MS).toBe(Number(m![1]) * 1000);
    expect(hs.HELLO_TIMEOUT_MS).toBe(5000);
  });

  it('the pre-auth cap is below the frame cap', () => {
    expect(hs.MAX_PREAUTH_FRAME_BYTES).toBeLessThan(LIMITS.MAX_FRAME_BYTES);
  });

  it('the gateway version equals server/package.json', () => {
    expect(hs.GATEWAY_VERSION).toBe(pkg.version);
  });

  it('every advertised capability is a gateway capability', () => {
    const caps = hs.buildHelloAck({ epoch: 'e', authRequired: false }).backends.flatMap((b) => b.capabilities ?? []);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) expect(hs.GATEWAY_CAPABILITIES as readonly string[]).toContain(c);
  });
});
