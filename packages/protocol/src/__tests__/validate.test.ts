import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage, LIMITS } from '../index.js';

const agent = {
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

const clientSamples: unknown[] = [
  { type: 'agent:input', agentId: 'a1', data: 'ls\n' },
  { type: 'agent:resize', agentId: 'a1', cols: 80, rows: 24 },
  { type: 'agent:create', name: 'one', mode: 'ssh', targetHost: 'host', initialCmd: 'top' },
  { type: 'agent:create', name: 'two', mode: 'tmux', targetHost: 'host' },
  { type: 'agent:kill', agentId: 'a1' },
  { type: 'agent:broadcast', targetAgentIds: ['a1', 'a2'], data: 'echo hi' },
];

const serverSamples: unknown[] = [
  { type: 'agent:output', agentId: 'a1', data: 'hello' },
  { type: 'agent:status_change', agentId: 'a1', status: 'running' },
  { type: 'agent:init_list', agents: [agent] },
  { type: 'agent:init_list', agents: [] },
];

function reason(r: { ok: boolean; reason?: string }) {
  return r.ok ? 'ok' : (r.reason ?? 'unknown');
}

describe('valid samples', () => {
  it.each(clientSamples)('client %j round-trips as a copy', (sample) => {
    const r = parseClientMessage(sample);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.msg).toEqual(sample);
      expect(r.msg).not.toBe(sample);
    }
  });

  it.each(serverSamples)('server %j round-trips as a copy', (sample) => {
    const r = parseServerMessage(sample);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.msg).toEqual(sample);
      expect(r.msg).not.toBe(sample);
    }
  });
});

describe('unknown fields', () => {
  it('strips top-level, __proto__ and nested extras', () => {
    const raw = JSON.parse(
      '{"type":"agent:kill","agentId":"a1","extra":1,"__proto__":{"polluted":true}}',
    );
    const r = parseClientMessage(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.msg)).toEqual(['type', 'agentId']);
      expect(Object.prototype.hasOwnProperty.call(r.msg, '__proto__')).toBe(false);
      expect((r.msg as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('strips nested extras in init_list agents and layout', () => {
    const r = parseServerMessage({
      type: 'agent:init_list',
      agents: [{ ...agent, secret: 'x', layout: { isFloating: true, junk: 1 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.msg.type === 'agent:init_list') {
      expect(r.msg.agents[0]).toEqual({ ...agent, layout: { isFloating: true } });
    }
  });
});

describe('envelope', () => {
  it.each([null, [], 'str', 42, true, undefined])('rejects %j as not_object', (v) => {
    expect(reason(parseClientMessage(v))).toBe('not_object');
    expect(reason(parseServerMessage(v))).toBe('not_object');
  });

  it.each([{}, { type: 5 }, { type: null }])('rejects %j as missing_type', (v) => {
    expect(reason(parseClientMessage(v))).toBe('missing_type');
  });

  it.each(['nope', 'toString', '__proto__', 'constructor', 'agent:output'])(
    'rejects client type %s as unknown_type',
    (t) => {
      expect(reason(parseClientMessage({ type: t }))).toBe('unknown_type');
    },
  );

  it('rejects a client type on the server parser', () => {
    expect(reason(parseServerMessage({ type: 'agent:kill', agentId: 'a' }))).toBe('unknown_type');
  });

  it('never throws on a hostile Proxy and reports invalid_field', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        ownKeys() {
          throw new Error('boom');
        },
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
        has() {
          throw new Error('boom');
        },
      },
    );
    expect(reason(parseClientMessage(hostile))).toBe('invalid_field');
    expect(reason(parseServerMessage(hostile))).toBe('invalid_field');
  });

  it('failure detail does not echo the offending value', () => {
    const r = parseClientMessage({ type: 'agent:kill', agentId: 'SECRET-VALUE'.repeat(20) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r)).not.toContain('SECRET-VALUE');
  });
});

describe('agent:input', () => {
  const mk = (data: unknown) => ({ type: 'agent:input', agentId: 'a1', data });

  it('enforces MAX_INPUT_BYTES in UTF-8 bytes', () => {
    expect(LIMITS.MAX_INPUT_BYTES).toBe(65536);
    const ok = parseClientMessage(mk('€'.repeat(21845)));
    expect(ok.ok).toBe(true);
    const bad = parseClientMessage(mk('€'.repeat(21846)));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe('invalid_field');
      expect(bad.field).toBe('data');
    }
  });

  it('counts astral characters as 4 bytes', () => {
    expect(parseClientMessage(mk('\u{1F600}'.repeat(16384))).ok).toBe(true);
    expect(parseClientMessage(mk('\u{1F600}'.repeat(16385))).ok).toBe(false);
  });

  it('rejects non-string data', () => {
    expect(reason(parseClientMessage(mk(5)))).toBe('invalid_field');
  });

  it.each([undefined, '', 5, 'x'.repeat(129)])('rejects agentId %j', (id) => {
    expect(reason(parseClientMessage({ type: 'agent:input', agentId: id, data: 'x' }))).toBe(
      'invalid_field',
    );
  });
});

describe('agent:kill', () => {
  it.each([undefined, '', 5, 'x'.repeat(129)])('rejects agentId %j', (id) => {
    expect(reason(parseClientMessage({ type: 'agent:kill', agentId: id }))).toBe('invalid_field');
  });
  it('accepts a 128-char agentId', () => {
    expect(parseClientMessage({ type: 'agent:kill', agentId: 'x'.repeat(128) }).ok).toBe(true);
  });
});

describe('agent:resize', () => {
  const mk = (cols: unknown, rows: unknown) => ({ type: 'agent:resize', agentId: 'a', cols, rows });
  it.each([1, 80, 1000])('accepts %j', (n) => {
    expect(parseClientMessage(mk(n, n)).ok).toBe(true);
  });
  it.each([0, 1001, 80.5, NaN, Infinity, '80', null, -1])('rejects %j', (n) => {
    expect(reason(parseClientMessage(mk(n, 24)))).toBe('invalid_field');
    expect(reason(parseClientMessage(mk(80, n)))).toBe('invalid_field');
  });
});

describe('agent:create', () => {
  const base = { type: 'agent:create', name: 'n', mode: 'tmux', targetHost: 'h' };
  it('rejects empty and whitespace-only names, trims valid ones', () => {
    expect(reason(parseClientMessage({ ...base, name: '' }))).toBe('invalid_field');
    expect(reason(parseClientMessage({ ...base, name: '   ' }))).toBe('invalid_field');
    const r = parseClientMessage({ ...base, name: '  pad  ' });
    expect(r.ok && r.msg.type === 'agent:create' && r.msg.name).toBe('pad');
  });
  it('rejects over-long names and control characters', () => {
    expect(parseClientMessage({ ...base, name: 'x'.repeat(128) }).ok).toBe(true);
    expect(reason(parseClientMessage({ ...base, name: 'x'.repeat(129) }))).toBe('invalid_field');
    expect(reason(parseClientMessage({ ...base, name: 'a\u0000b' }))).toBe('invalid_field');
    expect(reason(parseClientMessage({ ...base, name: 'a\nb' }))).toBe('invalid_field');
    expect(reason(parseClientMessage({ ...base, name: 'a\u007fb' }))).toBe('invalid_field');
  });
  it('validates mode', () => {
    expect(parseClientMessage({ ...base, mode: 'ssh' }).ok).toBe(true);
    expect(reason(parseClientMessage({ ...base, mode: 'docker' }))).toBe('invalid_field');
    expect(reason(parseClientMessage({ ...base, mode: undefined }))).toBe('invalid_field');
  });
  it('validates targetHost', () => {
    expect(reason(parseClientMessage({ ...base, targetHost: '' }))).toBe('invalid_field');
    expect(parseClientMessage({ ...base, targetHost: 'h'.repeat(255) }).ok).toBe(true);
    expect(reason(parseClientMessage({ ...base, targetHost: 'h'.repeat(256) }))).toBe(
      'invalid_field',
    );
    expect(reason(parseClientMessage({ ...base, targetHost: 'a\tb' }))).toBe('invalid_field');
  });
  it('validates optional initialCmd', () => {
    expect(parseClientMessage({ ...base, initialCmd: 'x'.repeat(4096) }).ok).toBe(true);
    expect(reason(parseClientMessage({ ...base, initialCmd: 'x'.repeat(4097) }))).toBe(
      'invalid_field',
    );
    expect(reason(parseClientMessage({ ...base, initialCmd: 5 }))).toBe('invalid_field');
    const r = parseClientMessage(base);
    expect(r.ok && Object.keys(r.msg)).toEqual(['type', 'name', 'mode', 'targetHost']);
  });
});

describe('agent:broadcast', () => {
  const mk = (ids: unknown, data: unknown = 'x') => ({
    type: 'agent:broadcast',
    targetAgentIds: ids,
    data,
  });
  it('rejects empty targets and non-arrays', () => {
    expect(reason(parseClientMessage(mk([])))).toBe('invalid_field');
    expect(reason(parseClientMessage(mk('a1')))).toBe('invalid_field');
  });
  it('caps targets at 64', () => {
    expect(parseClientMessage(mk(Array.from({ length: 64 }, (_, i) => `a${i}`))).ok).toBe(true);
    expect(reason(parseClientMessage(mk(Array.from({ length: 65 }, (_, i) => `a${i}`))))).toBe(
      'invalid_field',
    );
  });
  it('rejects empty, over-long or non-string targets', () => {
    expect(reason(parseClientMessage(mk(['a', ''])))).toBe('invalid_field');
    expect(reason(parseClientMessage(mk(['x'.repeat(129)])))).toBe('invalid_field');
    expect(reason(parseClientMessage(mk([5])))).toBe('invalid_field');
  });
  it('caps data in bytes', () => {
    expect(reason(parseClientMessage(mk(['a'], 'x'.repeat(65537))))).toBe('invalid_field');
  });
});

describe('server messages', () => {
  it('rejects bad status in status_change', () => {
    expect(
      reason(parseServerMessage({ type: 'agent:status_change', agentId: 'a', status: 'bogus' })),
    ).toBe('invalid_field');
    for (const s of ['idle', 'running', 'thinking', 'error', 'disconnected']) {
      expect(parseServerMessage({ type: 'agent:status_change', agentId: 'a', status: s }).ok).toBe(
        true,
      );
    }
  });

  it('validates every agent in init_list', () => {
    const bad = (patch: Record<string, unknown>) =>
      reason(parseServerMessage({ type: 'agent:init_list', agents: [agent, { ...agent, ...patch }] }));
    expect(bad({ id: '' })).toBe('invalid_field');
    expect(bad({ name: 5 })).toBe('invalid_field');
    expect(bad({ status: 'bogus' })).toBe('invalid_field');
    expect(bad({ unreadOutput: 'no' })).toBe('invalid_field');
    expect(bad({ layout: null })).toBe('invalid_field');
    expect(bad({ layout: { isFloating: 'yes' } })).toBe('invalid_field');
    expect(bad({ createdAt: NaN })).toBe('invalid_field');
    expect(bad({ lastActivity: Infinity })).toBe('invalid_field');
    expect(bad({ targetHost: undefined })).toBe('invalid_field');
  });

  it('accepts forward-compatible lowercase mode tokens', () => {
    const r = parseServerMessage({
      type: 'agent:init_list',
      agents: [{ ...agent, mode: 'docker-exec' }],
    });
    expect(r.ok).toBe(true);
    expect(reason(parseServerMessage({ type: 'agent:init_list', agents: [{ ...agent, mode: 'TMUX' }] }))).toBe(
      'invalid_field',
    );
    expect(
      reason(parseServerMessage({ type: 'agent:init_list', agents: [{ ...agent, mode: 'a'.repeat(65) }] })),
    ).toBe('invalid_field');
  });

  it('accepts optional layout numbers and rejects non-finite ones', () => {
    const layout = { isFloating: true, x: 1, y: 2, width: 3, height: 4, zIndex: 5, isMinimized: false };
    expect(parseServerMessage({ type: 'agent:init_list', agents: [{ ...agent, layout }] }).ok).toBe(true);
    expect(
      reason(parseServerMessage({ type: 'agent:init_list', agents: [{ ...agent, layout: { ...layout, x: NaN } }] })),
    ).toBe('invalid_field');
  });

  it('caps agents at 1000', () => {
    const many = (n: number) => ({
      type: 'agent:init_list',
      agents: Array.from({ length: n }, (_, i) => ({ ...agent, id: `a${i}` })),
    });
    expect(parseServerMessage(many(1000)).ok).toBe(true);
    expect(reason(parseServerMessage(many(1001)))).toBe('invalid_field');
  });

  it('rejects non-array agents', () => {
    expect(reason(parseServerMessage({ type: 'agent:init_list', agents: 'x' }))).toBe('invalid_field');
  });
});
