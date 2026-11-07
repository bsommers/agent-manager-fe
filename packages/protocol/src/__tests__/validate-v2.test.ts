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
  const spec = { l: { kind: 'enumList', values: ['x', 'y', 'z'], maxItems: 5 } } as const;

  it('filters unknown and duplicate entries keeping order', () => {
    expect(validateObject(spec, { l: ['z', 'q', 'x', 'z', 3] }, '')).toEqual({
      ok: true,
      value: { l: ['z', 'x'] },
    });
  });

  it('rejects non-arrays and applies maxItems before filtering', () => {
    expect(validateObject(spec, { l: 'x' }, '').ok).toBe(false);
    expect(validateObject(spec, { l: ['q', 'q', 'q', 'q', 'q', 'q'] }, '').ok).toBe(false);
  });
});

describe('scalar kind', () => {
  const spec = { v: { kind: 'scalar', maxString: 3 } } as const;

  it('accepts bounded strings, finite numbers and booleans', () => {
    for (const v of ['abc', 1.5, 0, true, false]) {
      expect(validateObject(spec, { v }, '')).toEqual({ ok: true, value: { v } });
    }
  });

  it('rejects long strings, non-finite numbers, objects, arrays and null', () => {
    for (const v of ['abcd', NaN, Infinity, {}, [], null]) {
      expect(validateObject(spec, { v }, '').ok).toBe(false);
    }
  });
});

describe('client messages v2 edge cases', () => {
  it('reports the first field of a failed exactlyOne / atLeastOne rule', () => {
    const both = parseClientMessage({ type: 'agent:history', agentId: 'a', beforeSeq: 1, afterSeq: 2 });
    expect(both.ok === false && both.field).toBe('beforeSeq');
    const none = parseClientMessage({ type: 'agent:update', agentId: 'a' });
    expect(none.ok === false && none.field).toBe('name');
  });

  it('accepts history limit 1 and 1000 and rejects 0', () => {
    for (const limit of [1, 1000]) {
      expect(parseClientMessage({ type: 'agent:history', agentId: 'a', afterSeq: 0, limit }).ok).toBe(true);
    }
    expect(parseClientMessage({ type: 'agent:history', agentId: 'a', afterSeq: 0, limit: 0 }).ok).toBe(false);
  });

  it('caps tags at 32 entries of 1..64 characters and group at 64', () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    const upd = (extra: Record<string, unknown>) =>
      parseClientMessage({ type: 'agent:update', agentId: 'a', ...extra }).ok;
    expect(upd({ tags: tags(32) })).toBe(true);
    expect(upd({ tags: tags(33) })).toBe(false);
    expect(upd({ tags: ['x'.repeat(65)] })).toBe(false);
    expect(upd({ tags: [''] })).toBe(false);
    expect(upd({ group: 'g'.repeat(64) })).toBe(true);
    expect(upd({ group: 'g'.repeat(65) })).toBe(false);
    expect(upd({ group: 'bad\u0000group' })).toBe(false);
  });

  it('trims the update name like agent:create', () => {
    const r = parseClientMessage({ type: 'agent:update', agentId: 'a', name: '  new  ' });
    expect(r.ok && r.msg).toEqual({ type: 'agent:update', agentId: 'a', name: 'new' });
  });

  it('caps create params at 32 entries, 64-char keys and 1024-char string values', () => {
    const base = { type: 'agent:create', name: 'n', mode: 'tmux', targetHost: 'h' };
    const mk = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    expect(parseClientMessage({ ...base, params: mk(32) }).ok).toBe(true);
    expect(parseClientMessage({ ...base, params: mk(33) }).ok).toBe(false);
    expect(parseClientMessage({ ...base, params: { ['k'.repeat(65)]: 1 } }).ok).toBe(false);
    expect(parseClientMessage({ ...base, params: { k: 'v'.repeat(1024) } }).ok).toBe(true);
    expect(parseClientMessage({ ...base, params: { k: 'v'.repeat(1025) } }).ok).toBe(false);
    expect(parseClientMessage({ ...base, params: { k: Infinity } }).ok).toBe(false);
    expect(parseClientMessage({ ...base, params: JSON.parse('{"__proto__":1}') }).ok).toBe(false);
  });

  it('keeps agent:input and agent:resize free of reqId', () => {
    const r = parseClientMessage({ type: 'agent:input', agentId: 'a', data: 'x', reqId: 'r' });
    expect(r.ok && Object.keys(r.msg)).toEqual(['type', 'agentId', 'data']);
  });

  it('samples without the new optional fields still parse unchanged', () => {
    const msg = { type: 'agent:create', name: 'n', mode: 'tmux', targetHost: 'h' };
    const r = parseClientMessage(msg);
    expect(r.ok && r.msg).toEqual(msg);
  });
});
