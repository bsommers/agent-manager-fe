// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_CHAR_FREE_PATTERN,
  LOWER_TOKEN_PATTERN,
  SCHEMA_DIALECT,
  SCHEMA_GROUPS,
  fieldSpecToSchema,
  generateJsonSchema,
  objectSpecToSchema,
  serializeJsonSchema,
} from '../jsonschema.js';
import type { JsonSchema, SchemaGroup } from '../jsonschema.js';
import { CLIENT_TABLE, SERVER_TABLE, AGENT_SPEC } from '../validate.js';
import { HTTP_TABLE } from '../http.js';
import { CONTRACT_VERSION } from '../limits.js';
import type { FieldSpec } from '../fieldspec.js';

const GENERATOR = 'npx vite-node packages/protocol/scripts/generate-schema.ts';
const defs = (): Record<string, JsonSchema> => generateJsonSchema().$defs as Record<string, JsonSchema>;

describe('document shape', () => {
  it('carries the dialect, id and contract version', () => {
    const doc = generateJsonSchema();
    expect(doc.$schema).toBe(SCHEMA_DIALECT);
    expect(SCHEMA_DIALECT).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(doc.$id).toBe(`urn:agent-manager:contract:${CONTRACT_VERSION}`);
    expect(doc['x-contract']).toBe(CONTRACT_VERSION);
  });

  it('has one definition per table row, in both directions', () => {
    const expected = [
      'Agent',
      'ClientMessage',
      'ServerMessage',
      ...Object.keys(CLIENT_TABLE).map((k) => `client.${k}`),
      ...Object.keys(SERVER_TABLE).map((k) => `server.${k}`),
      ...Object.keys(HTTP_TABLE).map((k) => `http.${k}`),
    ];
    expect(Object.keys(defs()).sort()).toEqual([...expected].sort());
  });

  it('message definitions pin type with a const; http definitions have no type property', () => {
    const d = defs();
    for (const key of Object.keys(CLIENT_TABLE)) {
      const def = d[`client.${key}`] as { properties: Record<string, unknown>; required: string[] };
      expect(def.properties.type).toEqual({ const: key });
      expect(def.required).toContain('type');
    }
    for (const key of Object.keys(SERVER_TABLE)) {
      const def = d[`server.${key}`] as { properties: Record<string, unknown> };
      expect(def.properties.type).toEqual({ const: key });
    }
    for (const key of Object.keys(HTTP_TABLE)) {
      expect((d[`http.${key}`] as { properties: Record<string, unknown> }).properties).not.toHaveProperty('type');
    }
  });

  it('unions list a $ref to every row', () => {
    const d = defs();
    expect(d.ClientMessage).toEqual({
      oneOf: Object.keys(CLIENT_TABLE)
        .map((k) => `#/$defs/client.${k}`)
        .sort()
        .map((r) => ({ $ref: r })),
    });
    expect((d.ServerMessage.oneOf as unknown[]).length).toBe(Object.keys(SERVER_TABLE).length);
  });

  it('sorts properties, required and $defs keys', () => {
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`));
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      for (const k of ['properties', '$defs'] as const) {
        if (obj[k] && typeof obj[k] === 'object') {
          const keys = Object.keys(obj[k] as object);
          expect(keys, `${path}.${k}`).toEqual([...keys].sort());
        }
      }
      if (Array.isArray(obj.required)) expect(obj.required, `${path}.required`).toEqual([...(obj.required as string[])].sort());
      for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
    };
    walk(generateJsonSchema(), '$');
  });

  it('required lists exactly the non-optional fields', () => {
    const d = defs();
    for (const [key, row] of Object.entries(CLIENT_TABLE)) {
      const fields = row.fields as Record<string, FieldSpec>;
      const want = [...Object.keys(fields).filter((f) => !fields[f].optional), 'type'].sort();
      expect((d[`client.${key}`].required as string[]) ?? []).toEqual(want);
    }
  });

  it('is deterministic and the committed file equals the generated schema', () => {
    expect(serializeJsonSchema()).toBe(serializeJsonSchema());
    expect(JSON.stringify(generateJsonSchema())).toBe(JSON.stringify(generateJsonSchema()));
    const committed = readFileSync(fileURLToPath(new URL('../../contract.schema.json', import.meta.url)), 'utf8');
    if (committed !== serializeJsonSchema()) {
      throw new Error(
        `packages/protocol/contract.schema.json is stale. Run ${GENERATOR}, review the diff and commit it.`,
      );
    }
  });

  it('never forbids unknown fields and serializes with a trailing newline', () => {
    expect(serializeJsonSchema().endsWith('}\n')).toBe(true);
    expect(serializeJsonSchema()).not.toContain('"additionalProperties": false');
  });
});

describe('Agent sharing', () => {
  it('emits the agent object once and references it everywhere else', () => {
    const d = defs();
    const ref = { $ref: '#/$defs/Agent' };
    expect(d.Agent.type).toBe('object');
    const added = d['server.agent:added'] as { properties: Record<string, unknown> };
    expect(added.properties.agent).toEqual(ref);
    const ack = d['server.agent:ack'] as { properties: Record<string, unknown> };
    expect(ack.properties.agent).toEqual(ref);
    const initList = d['server.agent:init_list'] as { properties: Record<string, { items: unknown }> };
    expect(initList.properties.agents.items).toEqual(ref);
    const httpAgents = d['http.agents'] as { properties: Record<string, { items: unknown }> };
    expect(httpAgents.properties.agents.items).toEqual(ref);
    expect((d['http.agent'] as { properties: Record<string, unknown> }).properties.agent).toEqual(ref);
  });

  it('standalone fieldSpecToSchema inlines the object', () => {
    const s = fieldSpecToSchema({ kind: 'object', fields: AGENT_SPEC });
    expect(s.type).toBe('object');
    expect(s).not.toHaveProperty('$ref');
  });
});

describe('fieldSpecToSchema per kind', () => {
  it('string', () => {
    expect(fieldSpecToSchema({ kind: 'string', min: 1, max: 5 })).toEqual({ type: 'string', minLength: 1, maxLength: 5 });
    expect(fieldSpecToSchema({ kind: 'string', min: 0, max: 5, maxBytes: 5 })).toMatchObject({ 'x-maxBytes': 5 });
    expect(fieldSpecToSchema({ kind: 'string', min: 0, max: 5, trim: true })).toMatchObject({ 'x-trim': true });
    expect(fieldSpecToSchema({ kind: 'string', min: 0, max: 5, noControl: true })).toMatchObject({
      pattern: CONTROL_CHAR_FREE_PATTERN,
    });
  });

  it('control-character pattern rejects C0, DEL and C1 and accepts text', () => {
    const re = new RegExp(CONTROL_CHAR_FREE_PATTERN, 'u');
    for (const bad of ['\u0000', '\u001f', '\u007f', '\u0080', '\u009f', 'a\nb']) expect(re.test(bad)).toBe(false);
    for (const ok of ['', 'plain text', ' ', 'café', '\u{1F600}']) expect(re.test(ok)).toBe(true);
  });

  it('token', () => {
    expect(fieldSpecToSchema({ kind: 'token', max: 9 })).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 9,
      pattern: LOWER_TOKEN_PATTERN,
    });
    const re = new RegExp(LOWER_TOKEN_PATTERN, 'u');
    expect(['cvm', 'a-b_9'].every((s) => re.test(s))).toBe(true);
    expect(['', 'CVM', 'a b'].some((s) => re.test(s))).toBe(false);
  });

  it('integer, number and boolean', () => {
    expect(fieldSpecToSchema({ kind: 'integer', min: -2, max: 7 })).toEqual({ type: 'integer', minimum: -2, maximum: 7 });
    expect(fieldSpecToSchema({ kind: 'number' })).toEqual({ type: 'number' });
    expect(fieldSpecToSchema({ kind: 'boolean' })).toEqual({ type: 'boolean' });
    expect(() => fieldSpecToSchema({ kind: 'integer', min: 0, max: 2 ** 60 })).toThrow(/safe integer/);
  });

  it('enum, literal and scalar', () => {
    expect(fieldSpecToSchema({ kind: 'enum', values: ['b', 'a'] })).toEqual({ type: 'string', enum: ['b', 'a'] });
    expect(fieldSpecToSchema({ kind: 'enum', values: ['a'], dropUnknown: true })).toMatchObject({ 'x-dropUnknown': true });
    expect(fieldSpecToSchema({ kind: 'literal', value: true })).toEqual({ const: true });
    expect(fieldSpecToSchema({ kind: 'scalar', maxString: 9 })).toEqual({
      type: ['string', 'number', 'boolean'],
      maxLength: 9,
    });
  });

  it('arrays', () => {
    expect(
      fieldSpecToSchema({ kind: 'stringArray', minItems: 1, maxItems: 3, item: { kind: 'string', min: 1, max: 2 } }),
    ).toEqual({ type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 2 } });
    expect(fieldSpecToSchema({ kind: 'objectArray', maxItems: 4, fields: { n: { kind: 'number' } } })).toEqual({
      type: 'array',
      maxItems: 4,
      items: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    });
    expect(fieldSpecToSchema({ kind: 'object', fields: { n: { kind: 'number', optional: true } } })).toEqual({
      type: 'object',
      properties: { n: { type: 'number' } },
    });
  });

  it('enumList', () => {
    expect(fieldSpecToSchema({ kind: 'enumList', values: ['x', 'y'], maxItems: 2 })).toEqual({
      type: 'array',
      maxItems: 2,
      uniqueItems: true,
      items: { type: 'string', enum: ['x', 'y'] },
      'x-dropUnknown': true,
    });
  });

  it('map', () => {
    expect(fieldSpecToSchema({ kind: 'map', maxEntries: 3, keyMax: 9, value: { kind: 'number' } })).toEqual({
      type: 'object',
      maxProperties: 3,
      additionalProperties: { type: 'number' },
      propertyNames: { minLength: 1, maxLength: 9, not: { enum: ['__proto__', 'constructor', 'prototype'] } },
    });
  });

  it('json', () => {
    expect(fieldSpecToSchema({ kind: 'json', maxDepth: 8, maxChars: 99 })).toEqual({ 'x-maxDepth': 8, 'x-maxChars': 99 });
    expect(fieldSpecToSchema({ kind: 'json', maxDepth: 8, maxChars: 99, objectOnly: true })).toEqual({
      type: 'object',
      'x-maxDepth': 8,
      'x-maxChars': 99,
    });
  });

  it('byTag gives an object property and one if/then per variant on the parent', () => {
    const s = objectSpecToSchema({
      scope: { kind: 'string', min: 1, max: 9 },
      data: { kind: 'byTag', tag: 'scope', variants: { b: { y: { kind: 'number' } }, a: { x: { kind: 'boolean' } } } },
    });
    expect((s.properties as Record<string, unknown>).data).toEqual({ type: 'object' });
    expect(s.allOf).toEqual([
      {
        if: { properties: { scope: { const: 'a' } }, required: ['scope'] },
        then: { properties: { data: { type: 'object', properties: { x: { type: 'boolean' } }, required: ['x'] } } },
      },
      {
        if: { properties: { scope: { const: 'b' } }, required: ['scope'] },
        then: { properties: { data: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] } } },
      },
    ]);
  });

  it('rules', () => {
    const fields = { a: { kind: 'number', optional: true }, b: { kind: 'number', optional: true } } as const;
    expect(objectSpecToSchema(fields, [{ kind: 'exactlyOne', fields: ['a', 'b'] }]).allOf).toEqual([
      { oneOf: [{ required: ['a'] }, { required: ['b'] }] },
    ]);
    expect(objectSpecToSchema(fields, [{ kind: 'atLeastOne', fields: ['a', 'b'] }]).allOf).toEqual([
      { anyOf: [{ required: ['a'] }, { required: ['b'] }] },
    ]);
    const gte = objectSpecToSchema(fields, [{ kind: 'gte', field: 'b', other: 'a' }]);
    expect(gte['x-rules']).toEqual([{ kind: 'gte', field: 'b', other: 'a' }]);
    expect(gte).not.toHaveProperty('allOf');
  });

  it('throws on an unknown kind', () => {
    expect(() => fieldSpecToSchema({ kind: 'bogus' } as unknown as FieldSpec)).toThrow(
      'jsonschema: unsupported field-spec kind "bogus"',
    );
  });
});

describe('groups', () => {
  it('SCHEMA_GROUPS tags client and server only', () => {
    expect(SCHEMA_GROUPS.map((g) => [g.prefix, g.tagged])).toEqual([
      ['client', true],
      ['server', true],
      ['http', false],
    ]);
  });

  it('accepts a custom group list', () => {
    const fleet: SchemaGroup = {
      prefix: 'fleet',
      tagged: true,
      table: { row: { fields: { n: { kind: 'integer', min: 0, max: 9 } } } },
    };
    const doc = generateJsonSchema([fleet]);
    expect(Object.keys(doc.$defs as object).sort()).toEqual(['Agent', 'fleet.row']);
  });

  it('rejects a tagged group whose row declares a type field', () => {
    const bad: SchemaGroup = {
      prefix: 'bad',
      tagged: true,
      table: { row: { fields: { type: { kind: 'number' } } } },
    };
    expect(() => generateJsonSchema([bad])).toThrow(/must not declare its own type field/);
  });

  it('rejects duplicate definition names', () => {
    const g: SchemaGroup = { prefix: 'client', tagged: true, table: { ping: { fields: {} } } };
    expect(() => generateJsonSchema([...SCHEMA_GROUPS, g])).toThrow(/duplicate definition/);
  });
});
