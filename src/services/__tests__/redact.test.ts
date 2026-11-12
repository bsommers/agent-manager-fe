import { describe, it, expect, afterEach } from 'vitest';
import { redactSecrets, redactJson, knownSecrets, REDACTED } from '../redact';
import { setToken, clearToken } from '../auth/tokenStore';

const S = 'tok-0123456789abcdef';

afterEach(() => {
  clearToken();
  sessionStorage.clear();
});

describe('redactSecrets', () => {
  it('replaces every occurrence', () => {
    expect(redactSecrets(`a ${S} b ${S}`, [S])).toBe(`a ${REDACTED} b ${REDACTED}`);
  });

  it('treats regex metacharacters literally', () => {
    const secret = 'a.b*c+(d)[e]';
    expect(redactSecrets(`x ${secret} y axbbbc+(d)e`, [secret])).toBe(`x ${REDACTED} y axbbbc+(d)e`);
  });

  it('ignores empty secrets', () => {
    expect(redactSecrets('hello', [''])).toBe('hello');
  });

  it('handles overlapping secrets longest first', () => {
    expect(redactSecrets('abcdef', ['abc', 'abcdef'])).toBe(REDACTED);
    expect(redactSecrets('xxabcdefxx', ['abc', 'abcdef'])).toBe(`xx${REDACTED}xx`);
  });

  it('defaults to the current token', () => {
    setToken(S);
    expect(redactSecrets(`Bearer ${S}`)).toBe(`Bearer ${REDACTED}`);
  });
});

describe('redactJson', () => {
  it('deep-copies and replaces inside strings only', () => {
    const input = {
      a: `x ${S}`,
      [S]: 1,
      n: 5,
      b: true,
      z: null,
      list: [`${S}`, 3, { deep: `p ${S} q` }],
    };
    const out = redactJson(input, [S]);
    expect(out).toEqual({
      a: `x ${REDACTED}`,
      [S]: 1,
      n: 5,
      b: true,
      z: null,
      list: [REDACTED, 3, { deep: `p ${REDACTED} q` }],
    });
    expect(out).not.toBe(input);
    expect(out.list).not.toBe(input.list);
  });

  it('never mutates its input', () => {
    const input = { a: S, list: [S] };
    const snapshot = JSON.stringify(input);
    redactJson(input, [S]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('survives a cycle without recursing forever', () => {
    const a: Record<string, unknown> = { v: S };
    a.self = a;
    const out = redactJson(a, [S]);
    expect(out).toEqual({ v: REDACTED, self: '[Circular]' });
  });

  it('a shared (non-cyclic) reference is copied in both places', () => {
    const shared = { v: S };
    const out = redactJson({ a: shared, b: shared }, [S]);
    expect(out).toEqual({ a: { v: REDACTED }, b: { v: REDACTED } });
  });
});

describe('knownSecrets', () => {
  it('is empty without a token and holds the token with one', () => {
    expect(knownSecrets()).toEqual([]);
    setToken(S);
    expect(knownSecrets()).toEqual([S]);
  });
});
