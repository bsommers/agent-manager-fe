import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createAuthGuard, bearerOf, redactSecrets, safeLogError } from '../auth.js';

const TOKEN = 'correct-horse-battery-staple-0123';

describe('createAuthGuard', () => {
  it('accepts exactly the configured token', () => {
    expect(createAuthGuard(TOKEN).verify(TOKEN)).toBe(true);
  });

  it('rejects same-length, prefix and longer candidates', () => {
    const g = createAuthGuard(TOKEN);
    expect(g.verify(TOKEN.slice(0, -1) + 'X')).toBe(false);
    expect(g.verify(TOKEN.slice(0, -1))).toBe(false);
    expect(g.verify(TOKEN + 'x')).toBe(false);
    expect(g.verify('')).toBe(false);
  });

  it('rejects undefined and non-string candidates without throwing', () => {
    const g = createAuthGuard(TOKEN);
    expect(g.verify(undefined)).toBe(false);
    expect(g.verify(123 as unknown as string)).toBe(false);
    expect(g.verify(null as unknown as string)).toBe(false);
    expect(g.verify({} as unknown as string)).toBe(false);
  });

  it('keeps guards independent', () => {
    const a = createAuthGuard(TOKEN);
    const b = createAuthGuard('another-token-another-token-1');
    expect(a.verify('another-token-another-token-1')).toBe(false);
    expect(b.verify(TOKEN)).toBe(false);
  });

  it('does not expose the token as a property of the guard', () => {
    const g = createAuthGuard(TOKEN);
    expect(JSON.stringify(g)).not.toContain(TOKEN);
    expect(Object.keys(g)).toEqual(['verify']);
  });
});

describe('bearerOf', () => {
  it('parses the scheme case-insensitively', () => {
    expect(bearerOf('Bearer abc')).toBe('abc');
    expect(bearerOf('bearer abc')).toBe('abc');
    expect(bearerOf('BEARER abc')).toBe('abc');
  });

  it('rejects anything that is not one scheme and one token', () => {
    expect(bearerOf('Bearer')).toBeUndefined();
    expect(bearerOf('Bearer ')).toBeUndefined();
    expect(bearerOf('Bearer a b')).toBeUndefined();
    expect(bearerOf('Basic abc')).toBeUndefined();
    expect(bearerOf('')).toBeUndefined();
    expect(bearerOf(undefined)).toBeUndefined();
    expect(bearerOf('Bearer abc ')).toBeUndefined();
  });
});

describe('redactSecrets', () => {
  const secret = 'S3cret.*+?()[]value-0123456789';
  const hex = createHash('sha256').update(secret).digest('hex');

  it('replaces every occurrence of the secret and its hex', () => {
    const out = redactSecrets(`a ${secret} b ${secret} c ${hex} d`, [secret]);
    expect(out).toBe('a [redacted] b [redacted] c [redacted] d');
  });

  it('treats regex metacharacters literally', () => {
    expect(redactSecrets('x.*+?()[]x and xAAAAx', ['.*+?()[]'])).toBe('x[redacted]x and xAAAAx');
  });

  it('redacts the longer secret first when one contains the other', () => {
    expect(redactSecrets('abc-longer-abc', ['abc', 'abc-longer-abc'])).toBe('[redacted]');
  });

  it('ignores empty secrets and returns text unchanged for none', () => {
    expect(redactSecrets('plain text', [''])).toBe('plain text');
    expect(redactSecrets('plain text', [])).toBe('plain text');
  });
});

describe('safeLogError', () => {
  it('replaces a JSON SyntaxError with a fixed message that does not quote input', () => {
    const canary = 'CANARY-TOKEN-abcdefghijklmnopqrstuvwxyz';
    let thrown: unknown;
    try {
      JSON.parse(`${canary} {not json`);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Error).message).toContain('CANARY');
    const out = safeLogError(thrown, [canary]);
    expect(out).toBeInstanceOf(Error);
    expect(out.message).not.toContain('CANARY');
    expect(out.message).toBe('frame is not valid JSON');
  });

  it('redacts secrets from other errors', () => {
    const out = safeLogError(new Error(`boom ${TOKEN} end`), [TOKEN]);
    expect(out.message).toBe('boom [redacted] end');
  });

  it('returns a fixed Error for non-Error values', () => {
    const out = safeLogError(`raw ${TOKEN}`, [TOKEN]);
    expect(out).toBeInstanceOf(Error);
    expect(out.message).not.toContain(TOKEN);
  });
});

describe('auth module logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never writes to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    );
    const g = createAuthGuard(TOKEN);
    g.verify(TOKEN);
    g.verify('nope');
    g.verify(undefined);
    bearerOf('Bearer x');
    bearerOf(undefined);
    redactSecrets(TOKEN, [TOKEN]);
    safeLogError(new SyntaxError('Unexpected token'), [TOKEN]);
    safeLogError('weird', [TOKEN]);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
