import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseServerMessage,
  validateObject,
  GATEWAY_CAPABILITIES,
  AGENT_CAPABILITIES,
  DEFAULT_AGENT_CAPABILITIES,
} from '../index.js';

const ack = (over: Record<string, unknown> = {}) => ({
  type: 'hello_ack',
  contract: 1,
  epoch: 'e',
  server: { name: 'gw', version: '1' },
  auth: { required: false },
  limits: { maxFrameBytes: 1048576, maxInputBytes: 65536, maxBroadcastTargets: 64 },
  backends: [],
  ...over,
});

describe('hello caps', () => {
  it('rejects a 513-character token without echoing it', () => {
    const token = 'x'.repeat(513);
    const r = parseClientMessage({ type: 'hello', contract: 1, token });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid_field');
      expect(r.field).toBe('token');
      expect(JSON.stringify(r)).not.toContain(token);
    }
  });

  it('accepts a 512-character token', () => {
    expect(parseClientMessage({ type: 'hello', contract: 1, token: 'x'.repeat(512) }).ok).toBe(true);
  });

  it('rejects a token with control characters without echoing it', () => {
    const token = 'abc\u0007def';
    const r = parseClientMessage({ type: 'hello', contract: 1, token });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('abc');
  });

  it('accepts 1000 resumeFrom entries and rejects 1001', () => {
    const mk = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, i]));
    expect(parseClientMessage({ type: 'hello', contract: 1, resumeFrom: mk(1000) }).ok).toBe(true);
    const r = parseClientMessage({ type: 'hello', contract: 1, resumeFrom: mk(1001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('resumeFrom');
  });

  it('rejects a __proto__ key in resumeFrom', () => {
    const raw = JSON.parse('{"type":"hello","contract":1,"resumeFrom":{"__proto__":1}}');
    const r = parseClientMessage(raw);
    expect(r.ok).toBe(false);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it.each(['constructor', 'prototype'])('rejects a %s key in resumeFrom', (key) => {
    expect(parseClientMessage({ type: 'hello', contract: 1, resumeFrom: { [key]: 1 } }).ok).toBe(false);
  });

  it('rejects a resumeFrom key longer than 128 characters', () => {
    expect(
      parseClientMessage({ type: 'hello', contract: 1, resumeFrom: { ['k'.repeat(129)]: 1 } }).ok,
    ).toBe(false);
  });

  it('rejects non-positive or fractional contract', () => {
    expect(parseClientMessage({ type: 'hello', contract: 0 }).ok).toBe(false);
    expect(parseClientMessage({ type: 'hello', contract: 1.5 }).ok).toBe(false);
  });

  it('strips unknown hello fields', () => {
    const r = parseClientMessage({ type: 'hello', contract: 1, extra: 1 });
    expect(r.ok && r.msg).toEqual({ type: 'hello', contract: 1 });
  });
});

describe('hello_ack', () => {
  it('drops unknown and duplicate capabilities instead of failing', () => {
    const r = parseServerMessage(
      ack({
        backends: [
          { id: 'b', label: 'B', up: true, capabilities: ['terminal', 'bogus', 'terminal', 'search'] },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.msg.type === 'hello_ack') {
      expect(r.msg.backends[0].capabilities).toEqual(['terminal', 'search']);
      expect(JSON.stringify(r.msg)).not.toContain('bogus');
    }
  });

  it('accepts a different major so the FE can report it', () => {
    expect(parseServerMessage(ack({ contract: 7 })).ok).toBe(true);
  });

  it('rejects more than 16 backends', () => {
    const b = { id: 'b', label: 'B', up: true, capabilities: [] };
    expect(parseServerMessage(ack({ backends: Array.from({ length: 17 }, () => b) })).ok).toBe(false);
  });

  it('rejects non-positive limits', () => {
    const r = parseServerMessage(
      ack({ limits: { maxFrameBytes: 0, maxInputBytes: 1, maxBroadcastTargets: 1 } }),
    );
    expect(r.ok).toBe(false);
  });
});

describe('capability vocabularies', () => {
  it('match contract spec sections 9.1 and 9.2', () => {
    expect([...GATEWAY_CAPABILITIES]).toEqual([
      'terminal',
      'broadcast',
      'search',
      'history',
      'tasks',
      'cost',
      'quota',
      'sandbox',
      'pipeline',
      'gates',
      'route',
    ]);
    expect([...AGENT_CAPABILITIES]).toEqual([
      'input',
      'resize',
      'kill',
      'history',
      'broadcast',
      'approve',
      'snapshot',
    ]);
    expect([...DEFAULT_AGENT_CAPABILITIES]).toEqual(['input', 'resize', 'kill', 'history', 'broadcast']);
    expect(Object.isFrozen(GATEWAY_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(AGENT_CAPABILITIES)).toBe(true);
  });
});

describe('map kind', () => {
  const spec = {
    m: { kind: 'map', maxEntries: 2, keyMax: 3, value: { kind: 'integer', min: 0, max: 9 } },
  } as const;

  it('copies only validated entries into a fresh object', () => {
    const input = { m: { a: 1, b: 2 } };
    const r = validateObject(spec, input, '');
    expect(r).toEqual({ ok: true, value: { m: { a: 1, b: 2 } } });
    if (r.ok) expect((r.value as { m: object }).m).not.toBe(input.m);
  });

  it('rejects too many entries, long keys, bad values, arrays and reserved keys', () => {
    expect(validateObject(spec, { m: { a: 1, b: 2, c: 3 } }, '').ok).toBe(false);
    expect(validateObject(spec, { m: { abcd: 1 } }, '').ok).toBe(false);
    expect(validateObject(spec, { m: { a: 10 } }, '').ok).toBe(false);
    expect(validateObject(spec, { m: [1] }, '').ok).toBe(false);
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      const raw = JSON.parse(`{"m":{"${k}":1}}`);
      expect(validateObject(spec, raw, '').ok).toBe(false);
    }
  });
});

describe('enumList kind', () => {
  const spec = { l: { kind: 'enumList', values: ['x', 'y', 'z'], maxItems: 4 } } as const;

  it('filters unknown and duplicate entries keeping order', () => {
    expect(validateObject(spec, { l: ['z', 'q', 'x', 'z', 3] }, '')).toEqual({
      ok: true,
      value: { l: ['z', 'x'] },
    });
  });

  it('rejects non-arrays and applies maxItems before filtering', () => {
    expect(validateObject(spec, { l: 'x' }, '').ok).toBe(false);
    expect(validateObject(spec, { l: ['q', 'q', 'q', 'q', 'q'] }, '').ok).toBe(false);
  });
});
