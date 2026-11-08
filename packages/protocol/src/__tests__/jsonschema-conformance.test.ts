// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_CHAR_FREE_PATTERN,
  LOWER_TOKEN_PATTERN,
  SCHEMA_GROUPS,
  fieldSpecToSchema,
  generateJsonSchema,
} from '../jsonschema.js';
import type { JsonSchema, SchemaGroup } from '../jsonschema.js';
import { AGENT_SPEC, CLIENT_TABLE, SERVER_TABLE } from '../validate.js';
import { HTTP_TABLE } from '../http.js';
import type { FieldSpec, ObjectSpec } from '../fieldspec.js';
import { assertSupported, validates } from './helpers/miniJsonSchema.js';

type Named = { name: string; message: Record<string, unknown> };
type Invalid = { name: string; direction: 'client' | 'server'; input: unknown; reason: string; field?: string };
type HttpFixtures = {
  valid: { name: string; kind: string; body: unknown }[];
  malformed: { name: string; kind: string; body: unknown; reason: string; field?: string }[];
};

const load = <T>(file: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${file}`, import.meta.url)), 'utf8')) as T;

const client = load<Named[]>('client.json');
const server = load<Named[]>('server.json');
const invalid = load<Invalid[]>('invalid.json');
const http = load<HttpFixtures>('http.json');

const doc = generateJsonSchema();
const defs = doc.$defs as Record<string, JsonSchema>;
const ref = (name: string): JsonSchema => ({ $ref: `#/$defs/${name}` });
const ok = (name: string, value: unknown, root: unknown = doc): boolean => validates(ref(name), value, root);

/**
 * Fixtures the validators reject but the schema accepts, each because JSON Schema cannot express the rule.
 * The tightness test below fails if an entry is in fact rejected or its fixture no longer exists.
 */
const SCHEMA_LOOSER_THAN_VALIDATORS: Record<string, string> = {
  'gap-to-below-from': 'cross-field gte rule (toSeq >= fromSeq) is only an x-rules annotation',
  'error-detail-nested-nine-deep': 'JSON nesting depth is only an x-maxDepth annotation',
  'meta-unknown-scope': 'unknown agent:meta scopes are deliberately permitted so new scopes can ship',
  'update-empty-name': 'trim is only an x-trim annotation: a whitespace-only name passes minLength',
};

describe('the generated document', () => {
  it('uses only keywords the in-repo evaluator implements', () => {
    expect(() => assertSupported(doc)).not.toThrow();
  });
});

describe('client fixtures', () => {
  it.each(client.map((f) => [f.name, f.message] as const))('%s is accepted by its own definition only', (_n, message) => {
    expect(ok('ClientMessage', message)).toBe(true);
    const own = `client.${message.type as string}`;
    expect(ok(own, message)).toBe(true);
    for (const key of Object.keys(CLIENT_TABLE)) {
      if (`client.${key}` !== own) expect(ok(`client.${key}`, message), `client.${key}`).toBe(false);
    }
  });
});

describe('server fixtures', () => {
  it.each(server.map((f) => [f.name, f.message] as const))('%s is accepted by its own definition only', (_n, message) => {
    expect(ok('ServerMessage', message)).toBe(true);
    const own = `server.${message.type as string}`;
    expect(ok(own, message)).toBe(true);
    for (const key of Object.keys(SERVER_TABLE)) {
      if (`server.${key}` !== own) expect(ok(`server.${key}`, message), `server.${key}`).toBe(false);
    }
  });
});

describe('http fixtures', () => {
  it.each(http.valid.map((f) => [f.name, f] as const))('valid %s is accepted by http.<kind>', (_n, f) => {
    expect(ok(`http.${f.kind}`, f.body)).toBe(true);
  });

  it.each(http.malformed.map((f) => [f.name, f] as const))('malformed %s is rejected unless allow-listed', (name, f) => {
    const accepted = ok(`http.${f.kind}`, f.body);
    if (Object.hasOwn(SCHEMA_LOOSER_THAN_VALIDATORS, name)) expect(accepted).toBe(true);
    else expect(accepted).toBe(false);
  });
});

describe('invalid fixtures', () => {
  it.each(invalid.map((f) => [f.name, f] as const))('%s is rejected unless allow-listed', (name, f) => {
    const accepted = ok(f.direction === 'client' ? 'ClientMessage' : 'ServerMessage', f.input);
    if (Object.hasOwn(SCHEMA_LOOSER_THAN_VALIDATORS, name)) expect(accepted).toBe(true);
    else expect(accepted).toBe(false);
  });
});

describe('SCHEMA_LOOSER_THAN_VALIDATORS stays tight', () => {
  const byName = new Map<string, () => boolean>([
    ...invalid.map((f) => [f.name, () => ok(f.direction === 'client' ? 'ClientMessage' : 'ServerMessage', f.input)] as const),
    ...http.malformed.map((f) => [f.name, () => ok(`http.${f.kind}`, f.body)] as const),
  ]);

  it('allow-listed names are unambiguous across invalid and http.malformed', () => {
    const all = [...invalid.map((f) => f.name), ...http.malformed.map((f) => f.name)];
    for (const name of Object.keys(SCHEMA_LOOSER_THAN_VALIDATORS)) {
      expect(all.filter((n) => n === name), name).toHaveLength(1);
    }
  });

  it.each(Object.entries(SCHEMA_LOOSER_THAN_VALIDATORS))('%s exists, has a reason and is really accepted', (name, reason) => {
    expect(reason.length).toBeGreaterThan(10);
    const accepted = byName.get(name);
    expect(accepted, `fixture ${name} no longer exists`).toBeDefined();
    expect(accepted?.(), `fixture ${name} is rejected: remove it from the allowlist`).toBe(true);
  });
});

describe('sender contract', () => {
  it('accepts a message carrying extra unknown fields', () => {
    expect(ok('client.ping', { type: 'ping', t: 1, future: { a: 1 } })).toBe(true);
    const agent = server.find((f) => f.message.type === 'agent:added')?.message as { agent: object };
    expect(ok('server.agent:added', { type: 'agent:added', agent: { ...agent.agent, extra: 1 }, extra: 2 })).toBe(true);
  });
});

describe('agent:meta payloads', () => {
  const meta = (scope: string, data: unknown) => ({ type: 'agent:meta', agentId: 'a', scope, data });
  const cases: [string, unknown, unknown][] = [
    ['cost', { spent: 1.5, cap: 10, currency: 'USD', tokens: { in: 1, out: 2 } }, { spent: 'x' }],
    ['quota', { used: 1, limit: 5, window: '1h', resetAt: 9 }, { used: 1 }],
    ['task', { id: 't1', title: 'x', state: 'running', exitCode: 0 }, { id: 't1', state: 'paused' }],
    ['pipeline', { stage: 's', wave: 'w', state: 'waiting_gate' }, { stage: 3 }],
    ['sandbox', { state: 'running', detail: 'd' }, { state: 'asleep' }],
  ];
  it.each(cases)('%s: right data accepted, wrong shape rejected', (scope, good, bad) => {
    expect(ok('server.agent:meta', meta(scope, good))).toBe(true);
    expect(ok('server.agent:meta', meta(scope, bad))).toBe(false);
    expect(ok('server.agent:meta', meta(scope, 'not an object'))).toBe(false);
  });
  it('an unknown scope with any object data is accepted', () => {
    expect(ok('server.agent:meta', meta('billing', { anything: [1, 2] }))).toBe(true);
    expect(ok('server.agent:meta', meta('billing', 5))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integer pinning
// ---------------------------------------------------------------------------

const SAFE = 9007199254740991;
const INT32 = [-2147483648, 2147483647] as const;

/** Schema path (definition name, then keys) to [minimum, maximum] for every integer node. */
const PINNED_INTEGERS: Record<string, readonly [number, number]> = {
  'client.agent:history/properties/afterSeq': [0, SAFE],
  'client.agent:history/properties/beforeSeq': [0, SAFE],
  'client.agent:history/properties/limit': [1, 1000],
  'client.agent:resize/properties/cols': [1, 1000],
  'client.agent:resize/properties/rows': [1, 1000],
  'client.hello/properties/contract': [1, SAFE],
  'client.hello/properties/resumeFrom/additionalProperties': [0, SAFE],
  'http.health/properties/agents': [0, SAFE],
  'http.health/properties/contract': [1, SAFE],
  'http.logs/properties/lines/items/properties/line': [0, SAFE],
  'http.logs/properties/lines/items/properties/seq': [1, SAFE],
  'http.search/properties/results/items/properties/line': [0, SAFE],
  'http.search/properties/results/items/properties/matchIndex': [0, SAFE],
  'http.search/properties/results/items/properties/matchLength': [0, SAFE],
  'http.search/properties/results/items/properties/seq': [1, SAFE],
  'server.agent:gap/properties/fromSeq': [1, SAFE],
  'server.agent:gap/properties/toSeq': [1, SAFE],
  'server.agent:history_chunk/properties/chunks/items/properties/seq': [1, SAFE],
  'server.agent:meta/allOf/4/then/properties/data/properties/exitCode': INT32,
  'server.agent:output/properties/seq': [1, SAFE],
  'server.agent:status_change/properties/exitCode': INT32,
  'server.hello_ack/properties/contract': [1, SAFE],
  'server.hello_ack/properties/limits/properties/maxBroadcastTargets': [1, SAFE],
  'server.hello_ack/properties/limits/properties/maxFrameBytes': [1, SAFE],
  'server.hello_ack/properties/limits/properties/maxInputBytes': [1, SAFE],
};

function collect(node: unknown, path: string, onNode: (n: Record<string, unknown>, p: string) => void): void {
  if (Array.isArray(node)) return node.forEach((x, i) => collect(x, `${path}/${i}`, onNode));
  if (node === null || typeof node !== 'object') return;
  onNode(node as Record<string, unknown>, path);
  for (const [k, v] of Object.entries(node)) collect(v, `${path}/${k}`, onNode);
}

describe('integer pinning', () => {
  it('every integer node in the document equals the literal PINNED_INTEGERS', () => {
    const found: Record<string, readonly [number, number]> = {};
    for (const [name, def] of Object.entries(defs)) {
      collect(def, name, (n, p) => {
        if (n.type === 'integer') found[p] = [n.minimum as number, n.maximum as number];
      });
    }
    expect(found).toEqual(PINNED_INTEGERS);
  });

  it('every pinned bound is a safe integer with minimum not above maximum', () => {
    for (const [path, [min, max]] of Object.entries(PINNED_INTEGERS)) {
      expect(Number.isSafeInteger(min) && Number.isSafeInteger(max), path).toBe(true);
      expect(min, path).toBeLessThanOrEqual(max);
    }
  });

  it('no integer node lacks a bound, and no schema node of type number carries bounds', () => {
    for (const [name, def] of Object.entries(defs)) {
      collect(def, name, (n, p) => {
        if (n.type === 'integer') {
          expect(typeof n.minimum, p).toBe('number');
          expect(typeof n.maximum, p).toBe('number');
        }
        if (n.type === 'number') {
          expect(n, p).not.toHaveProperty('minimum');
          expect(n, p).not.toHaveProperty('maximum');
        }
      });
    }
  });

  it('every integer FieldSpec in the tables maps to type integer with exactly its bounds', () => {
    const specs: Extract<FieldSpec, { kind: 'integer' }>[] = [];
    const walkSpec = (spec: FieldSpec): void => {
      switch (spec.kind) {
        case 'integer': specs.push(spec); break;
        case 'stringArray': walkSpec(spec.item); break;
        case 'map': walkSpec(spec.value); break;
        case 'objectArray': case 'object': walkObject(spec.fields); break;
        case 'byTag': Object.values(spec.variants).forEach(walkObject); break;
        default: break;
      }
    };
    const walkObject = (fields: ObjectSpec): void => Object.values(fields).forEach(walkSpec);
    for (const table of [CLIENT_TABLE, SERVER_TABLE, HTTP_TABLE] as Record<string, { fields: ObjectSpec }>[]) {
      Object.values(table).forEach((row) => walkObject(row.fields));
    }
    walkObject(AGENT_SPEC);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(fieldSpecToSchema(spec)).toEqual({ type: 'integer', minimum: spec.min, maximum: spec.max });
    }
    expect(JSON.stringify(fieldSpecToSchema({ kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER }))).toContain(
      '"maximum":9007199254740991',
    );
    expect(fieldSpecToSchema({ kind: 'number' })).toEqual({ type: 'number' });
  });

  it('integer fields reject fractions and out-of-range values', () => {
    const resize = { type: 'agent:resize', agentId: 'a', cols: 80, rows: 24 };
    expect(ok('client.agent:resize', resize)).toBe(true);
    expect(ok('client.agent:resize', { ...resize, cols: 80.5 })).toBe(false);
    expect(ok('client.agent:resize', { ...resize, cols: 1001 })).toBe(false);
    expect(ok('client.agent:resize', { ...resize, cols: 0 })).toBe(false);
  });
});

describe('patterns', () => {
  it('the set of pattern values equals the two named constants', () => {
    const patterns = new Set<string>();
    collect(doc, '#', (n) => {
      if (typeof n.pattern === 'string') patterns.add(n.pattern);
    });
    expect([...patterns].sort()).toEqual([CONTROL_CHAR_FREE_PATTERN, LOWER_TOKEN_PATTERN].sort());
  });
});

describe('extension by registering a group', () => {
  const fleet: SchemaGroup = {
    prefix: 'fleet',
    tagged: false,
    table: {
      ROW: {
        fields: {
          host: { kind: 'string', min: 1, max: 64 },
          slots: { kind: 'integer', min: 0, max: 64 },
          state: { kind: 'enum', values: ['up', 'down'] },
        },
      },
    },
  };
  const extended = generateJsonSchema([...SCHEMA_GROUPS, fleet]);
  const extDefs = extended.$defs as Record<string, JsonSchema>;

  it('adds fleet.ROW and leaves every other definition byte-identical', () => {
    expect(Object.keys(extDefs).sort()).toEqual([...Object.keys(defs), 'fleet.ROW'].sort());
    for (const [name, def] of Object.entries(defs)) expect(JSON.stringify(extDefs[name]), name).toBe(JSON.stringify(def));
  });

  it('validates fixture-like values against the new definition', () => {
    expect(ok('fleet.ROW', { host: 'h', slots: 3, state: 'up' }, extended)).toBe(true);
    expect(ok('fleet.ROW', { host: 'h', slots: 3.5, state: 'up' }, extended)).toBe(false);
    expect(ok('fleet.ROW', { host: 'h', slots: 3, state: 'sideways' }, extended)).toBe(false);
    expect(() => assertSupported(extended)).not.toThrow();
  });
});
