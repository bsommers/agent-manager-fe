import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseServerMessage,
  validateObject,
  GATEWAY_CAPABILITIES,
  AGENT_CAPABILITIES,
  DEFAULT_AGENT_CAPABILITIES,
  ERROR_CODES,
} from '../index.js';
import { evaluateRules } from '../fieldspec.js';
import type { ObjectSpec } from '../fieldspec.js';

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

// ---------------------------------------------------------------------------
// Engine vocabulary added for the gateway-to-client messages
// ---------------------------------------------------------------------------

const nest = (levels: number): unknown => {
  let v: unknown = 1;
  for (let i = 0; i < levels; i++) v = { a: v };
  return v;
};

describe('engine: literal kind', () => {
  const spec: ObjectSpec = { ok: { kind: 'literal', value: true } };
  it('accepts only the exact value', () => {
    expect(validateObject(spec, { ok: true }, '').ok).toBe(true);
    const r = validateObject(spec, { ok: false }, '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('ok');
    expect(validateObject(spec, { ok: 'true' }, '').ok).toBe(false);
  });
});

describe('engine: enum dropUnknown', () => {
  const spec: ObjectSpec = { k: { kind: 'enum', values: ['a', 'b'], dropUnknown: true, optional: true } };
  it('drops an unknown value to absent and keeps a known one', () => {
    expect(validateObject(spec, { k: 'zzz' }, '')).toEqual({ ok: true, value: {} });
    expect(validateObject(spec, { k: 7 }, '')).toEqual({ ok: true, value: {} });
    expect(validateObject(spec, { k: 'b' }, '')).toEqual({ ok: true, value: { k: 'b' } });
  });
});

describe('engine: json kind', () => {
  const spec: ObjectSpec = { v: { kind: 'json', maxDepth: 8, maxChars: 65536 } };
  const objOnly: ObjectSpec = { v: { kind: 'json', maxDepth: 8, maxChars: 65536, objectOnly: true } };
  it('returns a deep copy', () => {
    const input = { v: { a: [1, { b: 'x' }], c: null } };
    const r = validateObject(spec, input, '');
    expect(r.ok && r.value).toEqual(input);
    if (r.ok) expect((r.value as { v: unknown }).v).not.toBe(input.v);
  });
  it('accepts depth 8 and rejects depth 9', () => {
    expect(validateObject(spec, { v: nest(8) }, '').ok).toBe(true);
    const r = validateObject(spec, { v: nest(9) }, '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('v');
  });
  it('caps the serialized size', () => {
    expect(validateObject(spec, { v: 'x'.repeat(65536 - 2) }, '').ok).toBe(true);
    expect(validateObject(spec, { v: 'x'.repeat(65536) }, '').ok).toBe(false);
  });
  it('rejects forbidden keys at any depth', () => {
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      expect(validateObject(spec, { v: JSON.parse(`{"${k}":1}`) }, '').ok).toBe(false);
      expect(validateObject(spec, { v: JSON.parse(`{"x":[{"${k}":1}]}`) }, '').ok).toBe(false);
    }
  });
  it('rejects non-JSON values', () => {
    expect(validateObject(spec, { v: Infinity }, '').ok).toBe(false);
    expect(validateObject(spec, { v: { f: () => 1 } }, '').ok).toBe(false);
  });
  it('objectOnly rejects scalars and arrays', () => {
    expect(validateObject(objOnly, { v: 'x' }, '').ok).toBe(false);
    expect(validateObject(objOnly, { v: [1] }, '').ok).toBe(false);
    expect(validateObject(objOnly, { v: {} }, '').ok).toBe(true);
  });
});

describe('engine: byTag kind and gte rule', () => {
  const spec: ObjectSpec = {
    scope: { kind: 'string', min: 1, max: 32 },
    data: { kind: 'byTag', tag: 'scope', variants: { one: { n: { kind: 'number' } } } },
  };
  it('validates the variant picked by the sibling tag', () => {
    expect(validateObject(spec, { scope: 'one', data: { n: 1, extra: 2 } }, '')).toEqual({
      ok: true,
      value: { scope: 'one', data: { n: 1 } },
    });
    const bad = validateObject(spec, { scope: 'one', data: { n: 'x' } }, '');
    expect(bad.ok === false && bad.field).toBe('data.n');
  });
  it('reports unknown_type on the tag field when no variant exists', () => {
    const r = validateObject(spec, { scope: 'two', data: {} }, '');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe('scope');
      expect(r.reason).toBe('unknown_type');
    }
  });
  it('gte requires field a to be at least field b', () => {
    const rules = [{ kind: 'gte', field: 'b', other: 'a' }] as const;
    expect(evaluateRules(rules, { a: 2, b: 2 })).toBeNull();
    expect(evaluateRules(rules, { a: 3, b: 2 })?.field).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// Additive Agent fields
// ---------------------------------------------------------------------------

const baseAgent = {
  id: 'a1',
  name: 'one',
  mode: 'tmux',
  targetHost: 'localhost',
  status: 'idle',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1,
  lastActivity: 2,
};
const added = (agent: Record<string, unknown>) => ({ type: 'agent:added', agent });

describe('Agent additive fields', () => {
  it('parses the optional fields', () => {
    const agent = {
      ...baseAgent,
      kind: 'sandbox',
      backend: 'cloud-1',
      capabilities: ['input', 'kill'],
      tags: ['a', 'b'],
      group: 'g',
      meta: { x: { y: 1 } },
    };
    const r = parseServerMessage(added(agent));
    expect(r.ok && r.msg).toEqual(added(agent));
  });

  it('drops an unknown kind to absent', () => {
    const r = parseServerMessage(added({ ...baseAgent, kind: 'hologram' }));
    expect(r.ok).toBe(true);
    if (r.ok && r.msg.type === 'agent:added') expect('kind' in r.msg.agent).toBe(false);
  });

  it('drops unknown and duplicate capability names', () => {
    const r = parseServerMessage(added({ ...baseAgent, capabilities: ['kill', 'teleport', 'kill', 'input'] }));
    expect(r.ok && r.msg.type === 'agent:added' && r.msg.agent.capabilities).toEqual(['kill', 'input']);
  });

  it('an old sample still parses unchanged', () => {
    const r = parseServerMessage(added(baseAgent));
    expect(r.ok && r.msg).toEqual(added(baseAgent));
  });

  it('enforces tag, group, backend and meta limits', () => {
    expect(parseServerMessage(added({ ...baseAgent, tags: Array(33).fill('t') })).ok).toBe(false);
    expect(parseServerMessage(added({ ...baseAgent, tags: ['x'.repeat(65)] })).ok).toBe(false);
    expect(parseServerMessage(added({ ...baseAgent, tags: [''] })).ok).toBe(false);
    expect(parseServerMessage(added({ ...baseAgent, group: 'g'.repeat(65) })).ok).toBe(false);
    expect(parseServerMessage(added({ ...baseAgent, backend: 'Bad Name' })).ok).toBe(false);
    expect(parseServerMessage(added({ ...baseAgent, meta: [1] })).ok).toBe(false);
    expect(parseServerMessage(added({ ...baseAgent, meta: JSON.parse('{"__proto__":1}') })).ok).toBe(false);
    expect(parseServerMessage(added({ ...baseAgent, meta: nest(9) })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gateway-to-client messages
// ---------------------------------------------------------------------------

describe('agent:updated patch', () => {
  it('keeps only the patchable fields and allows an empty patch', () => {
    const r = parseServerMessage({
      type: 'agent:updated',
      agentId: 'a',
      patch: { name: 'n', status: 'error', tags: [], capabilities: ['x', 'input'] },
    });
    expect(r.ok && r.msg).toEqual({
      type: 'agent:updated',
      agentId: 'a',
      patch: { name: 'n', tags: [], capabilities: ['input'] },
    });
    expect(parseServerMessage({ type: 'agent:updated', agentId: 'a', patch: {} }).ok).toBe(true);
  });
});

describe('agent:meta scopes', () => {
  const meta = (scope: string, data: unknown) => ({ type: 'agent:meta', agentId: 'a', scope, data });
  it('accepts each documented payload', () => {
    const ok: Array<[string, unknown]> = [
      ['cost', { spent: 1.5, cap: 10, currency: 'USD', tokens: { in: 1, out: 2 } }],
      ['quota', { used: 1, limit: 2, window: '1h', resetAt: 5 }],
      ['task', { id: 't', title: 'x', state: 'running', exitCode: 0 }],
      ['pipeline', { stage: 's', wave: 'w', state: 'waiting_gate' }],
      ['sandbox', { state: 'snapshotting', detail: 'd' }],
    ];
    for (const [scope, data] of ok) {
      const r = parseServerMessage(meta(scope, data));
      expect(r.ok && r.msg).toEqual(meta(scope, data));
    }
  });
  it('rejects an unknown scope with unknown_type on scope', () => {
    const r = parseServerMessage(meta('billing', {}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unknown_type');
      expect(r.field).toBe('scope');
    }
  });
  it('rejects an inherited scope name', () => {
    const r = parseServerMessage(meta('constructor', {}));
    expect(r.ok === false && r.reason).toBe('unknown_type');
  });
  it('rejects a bad payload with the data path', () => {
    const r = parseServerMessage(meta('cost', { spent: '1' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid_field');
      expect(r.field).toBe('data.spent');
    }
    expect(parseServerMessage(meta('task', { id: 't', state: 'paused' })).ok).toBe(false);
  });
});

describe('agent:ack and agent:error', () => {
  it('keeps the order of up to 64 broadcast results', () => {
    const results = Array.from({ length: 64 }, (_, i) => ({ agentId: `a${63 - i}`, status: 'sent' }));
    const r = parseServerMessage({ type: 'agent:ack', reqId: 'r', op: 'broadcast', ok: true, results });
    expect(r.ok && r.msg).toMatchObject({ results });
    expect(
      parseServerMessage({
        type: 'agent:ack',
        reqId: 'r',
        op: 'broadcast',
        ok: true,
        results: [...results, { agentId: 'z', status: 'sent' }],
      }).ok,
    ).toBe(false);
  });
  it('rejects a result with an unknown error code', () => {
    const r = parseServerMessage({
      type: 'agent:ack',
      reqId: 'r',
      op: 'broadcast',
      ok: true,
      results: [{ agentId: 'a', status: 'failed', code: 'NOPE' }],
    });
    expect(r.ok === false && r.field).toBe('results[0].code');
  });
  it('accepts every ERROR_CODES value and any JSON detail', () => {
    for (const code of ERROR_CODES) {
      expect(
        parseServerMessage({ type: 'agent:error', code, message: 'm', retryable: false, detail: [1, { a: null }] }).ok,
      ).toBe(true);
    }
  });
  it('rejects forbidden keys inside error detail', () => {
    const detail = JSON.parse('{"a":{"__proto__":1}}');
    expect(parseServerMessage({ type: 'agent:error', code: 'USAGE', message: 'm', retryable: false, detail }).ok).toBe(
      false,
    );
  });
});

describe('hello_ack agentSpecs', () => {
  const spec = {
    mode: 'tmux',
    kind: 'terminal',
    title: 'Terminal',
    fields: [
      { name: 'cwd', label: 'Directory', type: 'string', required: true },
      { name: 'shell', label: 'Shell', type: 'enum', options: ['bash', 'zsh'] },
    ],
  };
  const backend = (agentSpecs: unknown) => ({ id: 'local', label: 'L', up: true, capabilities: [], agentSpecs });
  it('parses specs', () => {
    const msg = ack({ backends: [backend([spec])] });
    const r = parseServerMessage(msg);
    expect(r.ok && r.msg).toEqual(msg);
  });
  it('caps specs, fields and options', () => {
    expect(parseServerMessage(ack({ backends: [backend(Array(17).fill(spec))] })).ok).toBe(false);
    expect(
      parseServerMessage(ack({ backends: [backend([{ ...spec, fields: Array(33).fill(spec.fields[0]) }])] })).ok,
    ).toBe(false);
    expect(
      parseServerMessage(
        ack({
          backends: [backend([{ ...spec, fields: [{ ...spec.fields[1], options: Array(65).fill('o') }] }])],
        }),
      ).ok,
    ).toBe(false);
  });
});
