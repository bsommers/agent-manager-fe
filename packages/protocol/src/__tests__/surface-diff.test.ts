// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { diffSurface, evaluate, isSafeGitRef } from '../index.js';
import type { Surface, FieldEntry, OperationEntry } from '../index.js';

const base = (): Surface => ({
  contract: 1,
  client: {
    msg: {
      fields: {
        id: { kind: 'string', required: true, min: 1, max: 10 },
        note: { kind: 'string', required: false, min: 0, max: 10, maxBytes: 20 },
        mode: { kind: 'enum', required: true, values: ['a', 'b'] },
        tags: { kind: 'array', required: false, minItems: 0, maxItems: 5, item: { kind: 'string', min: 1, max: 4 } },
        list: { kind: 'enumList', required: false, values: ['x', 'y'], maxItems: 4 },
        data: {
          kind: 'byTag',
          required: true,
          tag: 'scope',
          variants: { one: { v: { kind: 'integer', required: true, min: 0, max: 9 } } },
        },
      },
      rules: [],
    },
  },
  server: {},
  http: {},
  errorCodes: { USAGE: 400, INTERNAL: 500 },
  gatewayCapabilities: ['terminal', 'search'],
  agentCapabilities: ['input', 'kill'],
  limits: { MAX_ID_LENGTH: 128, RECONNECT: { baseMs: 500, capMs: 15000 } },
});

const clone = (s: Surface): Surface => JSON.parse(JSON.stringify(s)) as Surface;
const fields = (s: Surface) => s.client.msg.fields;

function breaking(mutate: (s: Surface) => void): string[] {
  const next = clone(base());
  mutate(next);
  return diffSurface(base(), next).breaking;
}
function additive(mutate: (s: Surface) => void): string[] {
  const next = clone(base());
  mutate(next);
  return diffSurface(base(), next).additive;
}

describe('diffSurface: identical surfaces', () => {
  it('reports nothing', () => {
    expect(diffSurface(base(), clone(base()))).toEqual({ breaking: [], additive: [] });
  });
});

describe('diffSurface: breaking changes', () => {
  it('message type removed', () => {
    expect(breaking((s) => delete s.client.msg)).toEqual(['client.msg: removed']);
  });
  it('HTTP kind removed', () => {
    const prev = base();
    prev.http.health = { fields: {}, rules: [] };
    expect(diffSurface(prev, base()).breaking).toEqual(['http.health: removed']);
  });
  it('field removed', () => {
    expect(breaking((s) => delete fields(s).note)).toEqual(['client.msg.note: field removed']);
  });
  it('required field removed', () => {
    expect(breaking((s) => delete fields(s).id)).toEqual(['client.msg.id: field removed']);
  });
  it('field kind changed', () => {
    expect(breaking((s) => (fields(s).id = { kind: 'integer', required: true, min: 1, max: 10 }))).toEqual([
      'client.msg.id: kind changed from string to integer',
    ]);
  });
  it('optional field made required', () => {
    expect(breaking((s) => (fields(s).note.required = true))).toContain('client.msg.note: optional field made required');
  });
  it('new required field on an existing type', () => {
    expect(breaking((s) => (fields(s).extra = { kind: 'boolean', required: true }))).toEqual([
      'client.msg.extra: new required field',
    ]);
  });
  it('enum value removed', () => {
    expect(breaking((s) => (fields(s).mode.values = ['a']))).toEqual(['client.msg.mode.values: value "b" removed']);
  });
  it('enumList value removed', () => {
    expect(breaking((s) => (fields(s).list.values = ['x']))).toEqual(['client.msg.list.values: value "y" removed']);
  });
  it('string max lowered', () => {
    expect(breaking((s) => (fields(s).id.max = 5))).toEqual(['client.msg.id.max: lowered from 10 to 5']);
  });
  it('array max lowered', () => {
    expect(breaking((s) => (fields(s).tags.maxItems = 2))).toEqual(['client.msg.tags.maxItems: lowered from 5 to 2']);
  });
  it('maxBytes added counts as lowering an unbounded limit', () => {
    expect(breaking((s) => (fields(s).id.maxBytes = 10))).toEqual(['client.msg.id.maxBytes: lowered from unbounded to 10']);
  });
  it('min raised', () => {
    expect(breaking((s) => (fields(s).id.min = 3))).toEqual(['client.msg.id.min: raised from 1 to 3']);
  });
  it('nested item bound lowered', () => {
    expect(breaking((s) => ((fields(s).tags.item as FieldEntry).max = 2))).toEqual([
      'client.msg.tags.item.max: lowered from 4 to 2',
    ]);
  });
  it('byTag variant removed and a variant field newly required', () => {
    expect(breaking((s) => ((fields(s).data.variants as Record<string, unknown>) = {}))).toEqual([
      'client.msg.data.variants.one: variant removed',
    ]);
    expect(
      breaking((s) => {
        (fields(s).data.variants as Record<string, Record<string, FieldEntry>>).one.w = { kind: 'boolean', required: true };
      }),
    ).toEqual(['client.msg.data.variants.one.w: new required field']);
  });
  it('rule added', () => {
    expect(breaking((s) => s.client.msg.rules.push({ kind: 'atLeastOne', fields: ['id', 'note'] }))).toEqual([
      'client.msg: rule added {"kind":"atLeastOne","fields":["id","note"]}',
    ]);
  });
  it('error code removed or its status changed', () => {
    expect(breaking((s) => delete s.errorCodes.INTERNAL)).toEqual(['errorCodes.INTERNAL: removed']);
    expect(breaking((s) => (s.errorCodes.USAGE = 422))).toEqual([
      'errorCodes.USAGE: HTTP status changed from 400 to 422',
    ]);
  });
  it('capability removed', () => {
    expect(breaking((s) => s.gatewayCapabilities.pop())).toEqual(['gatewayCapabilities: search removed']);
    expect(breaking((s) => s.agentCapabilities.pop())).toEqual(['agentCapabilities: kill removed']);
  });
  it('limit lowered, including a nested one, or removed', () => {
    expect(breaking((s) => (s.limits.MAX_ID_LENGTH = 64))).toEqual(['limits.MAX_ID_LENGTH: lowered from 128 to 64']);
    expect(breaking((s) => ((s.limits.RECONNECT as Record<string, number>).capMs = 1000))).toEqual([
      'limits.RECONNECT.capMs: lowered from 15000 to 1000',
    ]);
    expect(breaking((s) => delete s.limits.MAX_ID_LENGTH)).toEqual(['limits.MAX_ID_LENGTH: limit removed']);
  });
  it('contract number lowered', () => {
    expect(breaking((s) => (s.contract = 0))).toEqual(['contract: lowered from 1 to 0']);
  });
});

describe('diffSurface: additive changes', () => {
  it('new message type, even with required fields', () => {
    expect(
      additive((s) => (s.client.fresh = { fields: { id: { kind: 'string', required: true, min: 1, max: 4 } }, rules: [] })),
    ).toEqual(['client.fresh: added']);
    expect(breaking((s) => (s.client.fresh = { fields: { id: { kind: 'string', required: true, min: 1, max: 4 } }, rules: [] }))).toEqual([]);
  });
  it('new optional field', () => {
    expect(additive((s) => (fields(s).extra = { kind: 'boolean', required: false }))).toEqual([
      'client.msg.extra: new optional field',
    ]);
  });
  it('required field made optional', () => {
    expect(additive((s) => (fields(s).id.required = false))).toEqual(['client.msg.id: required field made optional']);
  });
  it('new enum value', () => {
    expect(additive((s) => (fields(s).mode.values = ['a', 'b', 'c']))).toEqual(['client.msg.mode.values: value "c" added']);
  });
  it('max raised and min lowered', () => {
    expect(additive((s) => (fields(s).id.max = 20))).toEqual(['client.msg.id.max: raised from 10 to 20']);
    expect(additive((s) => (fields(s).id.min = 0))).toEqual(['client.msg.id.min: lowered from 1 to 0']);
  });
  it('rule removed', () => {
    const prev = base();
    prev.client.msg.rules = [{ kind: 'atLeastOne', fields: ['id', 'note'] }];
    const out = diffSurface(prev, base());
    expect(out.breaking).toEqual([]);
    expect(out.additive).toEqual(['client.msg: rule removed {"kind":"atLeastOne","fields":["id","note"]}']);
  });
  it('new error code and capability', () => {
    expect(additive((s) => (s.errorCodes.NEW = 418))).toEqual(['errorCodes.NEW: added']);
    expect(additive((s) => s.gatewayCapabilities.push('route'))).toEqual(['gatewayCapabilities: route added']);
  });
  it('limit raised or added', () => {
    expect(additive((s) => (s.limits.MAX_ID_LENGTH = 256))).toEqual(['limits.MAX_ID_LENGTH: raised from 128 to 256']);
    expect(additive((s) => (s.limits.MAX_X = 1))).toEqual(['limits.MAX_X: limit added']);
  });
});

describe('evaluate', () => {
  it('passes with no breaking changes', () => {
    const next = clone(base());
    fields(next).extra = { kind: 'boolean', required: false };
    const r = evaluate(base(), next);
    expect(r.pass).toBe(true);
    expect(r.breaking).toEqual([]);
  });

  it('fails on a breaking change when CONTRACT_VERSION was not raised', () => {
    const next = clone(base());
    delete fields(next).id;
    const r = evaluate(base(), next);
    expect(r.pass).toBe(false);
    expect(r.breaking).toEqual(['client.msg.id: field removed']);
  });

  it('passes with a notice on a breaking change when the contract was raised', () => {
    const next = clone(base());
    delete fields(next).id;
    next.contract = 2;
    const r = evaluate(base(), next);
    expect(r.pass).toBe(true);
    expect(r.notices.join(' ')).toMatch(/raised from 1 to 2/);
  });

  it('fails when the contract number is lowered', () => {
    const next = clone(base());
    next.contract = 0;
    expect(evaluate(base(), next).pass).toBe(false);
  });
});

describe('isSafeGitRef', () => {
  it.each(['HEAD', 'origin/master', 'v1.2.3', 'HEAD~2', 'HEAD^', 'feature/x_y-z', 'a@u'])(
    'accepts %s',
    (ref) => {
      expect(isSafeGitRef(ref)).toBe(true);
    },
  );
  it.each([
    '',
    '--evil',
    '-x',
    'a b',
    'a;b',
    'a$(id)',
    'a`id`',
    'a|b',
    'a&b',
    'a\nb',
    'a:b',
    'a*',
    'x'.repeat(201),
  ])('rejects %j', (ref) => {
    expect(isSafeGitRef(ref)).toBe(false);
  });
  it('accepts exactly 200 characters', () => {
    expect(isSafeGitRef('x'.repeat(200))).toBe(true);
  });
});

describe('diffSurface: operations', () => {
  const op = (): OperationEntry => ({
    destructive: false,
    readOnly: false,
    requires: { gateway: 'terminal', agent: 'input' },
    params: { id: { kind: 'string', required: true, min: 1, max: 10 } },
    rules: [],
    ws: { type: 'agent:input' },
    http: null,
    mcp: null,
    palette: null,
  });
  const withOps = (): Surface => ({ ...base(), operations: { 'x.do': op() } });
  const diffWith = (mutate: (o: OperationEntry) => void) => {
    const next = clone(withOps());
    mutate((next.operations as Record<string, OperationEntry>)['x.do']);
    return diffSurface(withOps(), next);
  };

  it('is quiet when unchanged', () => {
    expect(diffSurface(withOps(), clone(withOps()))).toEqual({ breaking: [], additive: [] });
  });
  it('operation added is additive, removed is breaking; absent section counts as empty', () => {
    expect(diffSurface(base(), withOps())).toEqual({ breaking: [], additive: ['operations.x.do: added'] });
    expect(diffSurface(withOps(), base())).toEqual({ breaking: ['operations.x.do: removed'], additive: [] });
  });
  it('destructive, readOnly, confirmParam and requires changes are breaking', () => {
    expect(diffWith((o) => (o.destructive = true)).breaking).toEqual(['operations.x.do.destructive: changed from false to true']);
    expect(diffWith((o) => (o.readOnly = true)).breaking).toEqual(['operations.x.do.readOnly: changed from false to true']);
    expect(diffWith((o) => (o.confirmParam = 'confirm')).breaking).toHaveLength(1);
    expect(diffWith((o) => (o.requires = { gateway: 'terminal', agent: 'kill' })).breaking).toEqual([
      'operations.x.do.requires.agent: changed from "input" to "kill"',
    ]);
    expect(diffWith((o) => (o.requires = {})).breaking).toHaveLength(2);
  });
  it('params are classified like message fields', () => {
    expect(diffWith((o) => (o.params.n = { kind: 'boolean', required: true })).breaking).toEqual([
      'operations.x.do.params.n: new required field',
    ]);
    const added = diffWith((o) => (o.params.n = { kind: 'boolean', required: false }));
    expect(added.breaking).toEqual([]);
    expect(added.additive).toEqual(['operations.x.do.params.n: new optional field']);
    expect(diffWith((o) => (o.params.id.max = 5)).breaking).toEqual(['operations.x.do.params.id.max: lowered from 10 to 5']);
  });
  it('rule added is breaking, removed is additive', () => {
    const rule = { kind: 'atLeastOne', fields: ['id'] };
    expect(diffWith((o) => o.rules.push(rule)).breaking).toHaveLength(1);
    const prev = clone(withOps());
    (prev.operations as Record<string, OperationEntry>)['x.do'].rules.push(rule);
    expect(diffSurface(prev, withOps())).toMatchObject({ breaking: [], additive: [expect.stringContaining('rule removed')] });
  });
  it('binding null to bound is additive, bound to null or different is breaking', () => {
    expect(diffWith((o) => (o.mcp = { tool: 't' }))).toMatchObject({ breaking: [], additive: ['operations.x.do.mcp: binding added'] });
    expect(diffWith((o) => (o.ws = null)).breaking).toEqual(['operations.x.do.ws: binding removed']);
    expect(diffWith((o) => (o.ws = { type: 'agent:resize' })).breaking).toHaveLength(1);
  });
});
