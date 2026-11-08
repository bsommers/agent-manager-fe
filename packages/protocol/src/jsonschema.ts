import { CONTRACT_VERSION } from './limits.js';
import { AGENT_SPEC, CLIENT_TABLE, SERVER_TABLE } from './validate.js';
import { HTTP_TABLE } from './http.js';
import type { FieldSpec, MessageSpec, ObjectSpec, Rule } from './fieldspec.js';

// ---------------------------------------------------------------------------
// JSON Schema (draft 2020-12) generated from the FieldSpec tables.
//
// The schema describes what a conforming SENDER emits: strict on enums, bounds and integer-ness,
// never forbidding unknown fields. Constraints JSON Schema cannot express are kept as `x-` annotations.
// The validators in validate.ts remain normative.
// ---------------------------------------------------------------------------

export type JsonSchema = { [keyword: string]: unknown };

/** A set of message rows that becomes `$defs` entries named `<prefix>.<key>`. */
export interface SchemaGroup {
  prefix: string;
  table: Readonly<Record<string, MessageSpec>>;
  /** Tagged rows get a `type` property equal to the row key; untagged rows (HTTP bodies) do not. */
  tagged: boolean;
  /** Optional name of a `oneOf` union over every row of the group. */
  union?: string;
}

export const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** The only two regular expressions the generator can emit (ECMA-262 syntax, linear character classes). */
export const CONTROL_CHAR_FREE_PATTERN = '^[^\\u0000-\\u001f\\u007f-\\u009f]*$';
export const LOWER_TOKEN_PATTERN = '^[a-z0-9_-]+$';

/** Keys that the validators refuse inside maps; mirrored as a `propertyNames` exclusion. */
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

export const SCHEMA_GROUPS: readonly SchemaGroup[] = [
  { prefix: 'client', table: CLIENT_TABLE, tagged: true, union: 'ClientMessage' },
  { prefix: 'server', table: SERVER_TABLE, tagged: true, union: 'ServerMessage' },
  { prefix: 'http', table: HTTP_TABLE, tagged: false },
];

/** Per-call context: object specs that are emitted once as a named definition and referenced elsewhere. */
interface Ctx {
  refs: ReadonlyMap<ObjectSpec, string>;
}

const NO_REFS: Ctx = { refs: new Map() };

function sortedKeys<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

function requireSafe(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new Error(`jsonschema: ${what} is not a safe integer: ${n}`);
  return n;
}

function refTo(name: string): JsonSchema {
  return { $ref: `#/$defs/${name}` };
}

function objectOrRef(fields: ObjectSpec, ctx: Ctx): JsonSchema {
  const name = ctx.refs.get(fields);
  return name !== undefined ? refTo(name) : objectSpecToSchema(fields, undefined, ctx);
}

export function fieldSpecToSchema(spec: FieldSpec, ctx: Ctx = NO_REFS): JsonSchema {
  switch (spec.kind) {
    case 'string': {
      const out: JsonSchema = { type: 'string', minLength: spec.min, maxLength: spec.max };
      if (spec.maxBytes !== undefined) out['x-maxBytes'] = spec.maxBytes;
      if (spec.noControl) out.pattern = CONTROL_CHAR_FREE_PATTERN;
      if (spec.trim) out['x-trim'] = true;
      return out;
    }
    case 'token':
      return { type: 'string', minLength: 1, maxLength: spec.max, pattern: LOWER_TOKEN_PATTERN };
    case 'integer':
      return {
        type: 'integer',
        minimum: requireSafe(spec.min, 'integer minimum'),
        maximum: requireSafe(spec.max, 'integer maximum'),
      };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum': {
      const out: JsonSchema = { type: 'string', enum: [...spec.values] };
      if (spec.dropUnknown) out['x-dropUnknown'] = true;
      return out;
    }
    case 'literal':
      return { const: spec.value };
    case 'scalar':
      return { type: ['string', 'number', 'boolean'], maxLength: spec.maxString };
    case 'stringArray':
      return {
        type: 'array',
        minItems: spec.minItems,
        maxItems: spec.maxItems,
        items: fieldSpecToSchema(spec.item, ctx),
      };
    case 'objectArray':
      return { type: 'array', maxItems: spec.maxItems, items: objectOrRef(spec.fields, ctx) };
    case 'object':
      return objectOrRef(spec.fields, ctx);
    case 'enumList':
      return {
        type: 'array',
        maxItems: spec.maxItems,
        uniqueItems: true,
        items: { type: 'string', enum: [...spec.values] },
        'x-dropUnknown': true,
      };
    case 'map':
      return {
        type: 'object',
        maxProperties: spec.maxEntries,
        additionalProperties: fieldSpecToSchema(spec.value, ctx),
        propertyNames: { minLength: 1, maxLength: spec.keyMax, not: { enum: [...RESERVED_KEYS] } },
      };
    case 'json': {
      const out: JsonSchema = spec.objectOnly ? { type: 'object' } : {};
      out['x-maxDepth'] = spec.maxDepth;
      out['x-maxChars'] = spec.maxChars;
      return out;
    }
    case 'byTag':
      // The variants are attached by the parent object (they depend on a sibling field).
      return { type: 'object' };
    default:
      throw new Error(`jsonschema: unsupported field-spec kind ${JSON.stringify((spec as { kind: unknown }).kind)}`);
  }
}

function ruleToSchema(rule: Rule): { allOf?: JsonSchema; annotation?: JsonSchema } {
  switch (rule.kind) {
    case 'exactlyOne':
      return { allOf: { oneOf: rule.fields.map((f) => ({ required: [f] })) } };
    case 'atLeastOne':
      return { allOf: { anyOf: rule.fields.map((f) => ({ required: [f] })) } };
    case 'gte':
      return { annotation: { kind: 'gte', field: rule.field, other: rule.other } };
    default:
      throw new Error(`jsonschema: unsupported rule kind ${JSON.stringify((rule as { kind: unknown }).kind)}`);
  }
}

export function objectSpecToSchema(fields: ObjectSpec, rules?: readonly Rule[], ctx: Ctx = NO_REFS): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const allOf: JsonSchema[] = [];
  for (const key of Object.keys(fields).sort()) {
    const spec = fields[key];
    properties[key] = fieldSpecToSchema(spec, ctx);
    if (!spec.optional) required.push(key);
    if (spec.kind === 'byTag') {
      for (const value of Object.keys(spec.variants).sort()) {
        allOf.push({
          if: { properties: { [spec.tag]: { const: value } }, required: [spec.tag] },
          then: { properties: { [key]: objectSpecToSchema(spec.variants[value], undefined, ctx) } },
        });
      }
    }
  }
  const annotations: JsonSchema[] = [];
  for (const rule of rules ?? []) {
    const r = ruleToSchema(rule);
    if (r.allOf) allOf.push(r.allOf);
    if (r.annotation) annotations.push(r.annotation);
  }
  const out: JsonSchema = { type: 'object', properties };
  if (required.length > 0) out.required = required;
  if (allOf.length > 0) out.allOf = allOf;
  if (annotations.length > 0) out['x-rules'] = annotations;
  return out;
}

function messageSchema(row: MessageSpec, name: string, tagged: boolean, ctx: Ctx): JsonSchema {
  const schema = objectSpecToSchema(row.fields, row.rules, ctx);
  if (!tagged) return schema;
  if (Object.prototype.hasOwnProperty.call(row.fields, 'type')) {
    throw new Error(`jsonschema: tagged row ${JSON.stringify(name)} must not declare its own type field`);
  }
  const properties = sortedKeys({ ...(schema.properties as Record<string, unknown>), type: { const: name } });
  const required = [...((schema.required as string[] | undefined) ?? []), 'type'].sort();
  return { ...schema, properties, required };
}

export function generateJsonSchema(groups: readonly SchemaGroup[] = SCHEMA_GROUPS): JsonSchema {
  const ctx: Ctx = { refs: new Map([[AGENT_SPEC, 'Agent']]) };
  const defs: Record<string, unknown> = { Agent: objectSpecToSchema(AGENT_SPEC, undefined, NO_REFS) };
  for (const group of groups) {
    const names: string[] = [];
    for (const key of Object.keys(group.table)) {
      const name = `${group.prefix}.${key}`;
      if (Object.prototype.hasOwnProperty.call(defs, name)) {
        throw new Error(`jsonschema: duplicate definition ${JSON.stringify(name)}`);
      }
      defs[name] = messageSchema(group.table[key], key, group.tagged, ctx);
      names.push(name);
    }
    if (group.union !== undefined) {
      if (Object.prototype.hasOwnProperty.call(defs, group.union)) {
        throw new Error(`jsonschema: duplicate definition ${JSON.stringify(group.union)}`);
      }
      defs[group.union] = { oneOf: names.sort().map(refTo) };
    }
  }
  return {
    $schema: SCHEMA_DIALECT,
    $id: `urn:agent-manager:contract:${CONTRACT_VERSION}`,
    title: 'agent-manager FE-BE contract',
    'x-contract': CONTRACT_VERSION,
    $defs: sortedKeys(defs),
  };
}

/** Two-space JSON plus trailing newline (same convention as serializeSurface). */
export function serializeJsonSchema(schema: JsonSchema = generateJsonSchema()): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
