import { CONTRACT_VERSION, LIMITS } from './limits.js';
import { AGENT_CAPABILITIES, GATEWAY_CAPABILITIES } from './capabilities.js';
import { ERROR_CODES, ERROR_HTTP_STATUS } from './errors.js';
import { CLIENT_TABLE, SERVER_TABLE } from './validate.js';
import { HTTP_TABLE } from './http.js';
import type { FieldSpec, MessageSpec, ObjectSpec } from './fieldspec.js';

// ---------------------------------------------------------------------------
// Surface description: a deterministic, JSON-serialisable view of the whole
// contract, derived from the executable tables so it cannot drift from them.
// ---------------------------------------------------------------------------

/** One field (or nested value) of the contract. `required` is present on object members only. */
export interface FieldEntry {
  kind: string;
  required?: boolean;
  [attribute: string]: unknown;
}

export type FieldMap = Record<string, FieldEntry>;

export interface MessageEntry {
  fields: FieldMap;
  rules: unknown[];
}

export interface Surface {
  contract: number;
  client: Record<string, MessageEntry>;
  server: Record<string, MessageEntry>;
  http: Record<string, MessageEntry>;
  errorCodes: Record<string, number>;
  gatewayCapabilities: string[];
  agentCapabilities: string[];
  limits: Record<string, unknown>;
}

/** Recursively sorts object keys; array order is preserved (it is meaningful for enums and rules). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

function describeFieldMap(fields: ObjectSpec): FieldMap {
  const out: FieldMap = {};
  for (const key of Object.keys(fields)) {
    out[key] = { ...describeSpec(fields[key]), required: fields[key].optional !== true };
  }
  return out;
}

/**
 * Converts one field spec to its surface entry. Throws on a kind it does not know so a kind added to the
 * engine cannot be silently left out of the snapshot (the surface test exercises this).
 */
export function describeSpec(spec: FieldSpec): FieldEntry {
  switch (spec.kind) {
    case 'string': {
      const e: FieldEntry = { kind: 'string', min: spec.min, max: spec.max };
      if (spec.maxBytes !== undefined) e.maxBytes = spec.maxBytes;
      if (spec.noControl) e.noControl = true;
      if (spec.trim) e.trim = true;
      return e;
    }
    case 'token':
      return { kind: 'token', max: spec.max };
    case 'integer':
      return { kind: 'integer', min: spec.min, max: spec.max };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'enum': {
      const e: FieldEntry = { kind: 'enum', values: [...spec.values] };
      if (spec.dropUnknown) e.dropUnknown = true;
      return e;
    }
    case 'enumList':
      return { kind: 'enumList', values: [...spec.values], maxItems: spec.maxItems };
    case 'literal':
      return { kind: 'literal', value: spec.value };
    case 'scalar':
      return { kind: 'scalar', maxString: spec.maxString };
    case 'json': {
      const e: FieldEntry = { kind: 'json', maxDepth: spec.maxDepth, maxChars: spec.maxChars };
      if (spec.objectOnly) e.objectOnly = true;
      return e;
    }
    case 'map':
      return {
        kind: 'map',
        maxEntries: spec.maxEntries,
        keyMax: spec.keyMax,
        value: describeSpec(spec.value),
      };
    case 'stringArray':
      return { kind: 'array', minItems: spec.minItems, maxItems: spec.maxItems, item: describeSpec(spec.item) };
    case 'objectArray':
      return { kind: 'array', maxItems: spec.maxItems, fields: describeFieldMap(spec.fields) };
    case 'object':
      return { kind: 'object', fields: describeFieldMap(spec.fields) };
    case 'byTag': {
      const variants: Record<string, FieldMap> = {};
      for (const tag of Object.keys(spec.variants)) variants[tag] = describeFieldMap(spec.variants[tag]);
      return { kind: 'byTag', tag: spec.tag, variants };
    }
    default: {
      const unknown = spec as { kind?: unknown };
      throw new Error(`surface: unsupported field-spec kind ${JSON.stringify(unknown.kind)}`);
    }
  }
}

function describeTable(table: Readonly<Record<string, MessageSpec>>): Record<string, MessageEntry> {
  const out: Record<string, MessageEntry> = {};
  for (const type of Object.keys(table)) {
    out[type] = {
      fields: describeFieldMap(table[type].fields),
      rules: (table[type].rules ?? []).map((r) => ({ ...r })),
    };
  }
  return out;
}

/** Deterministic description of the whole contract; key order is sorted so JSON.stringify is stable. */
export function describeSurface(): Surface {
  const surface = {
    contract: CONTRACT_VERSION,
    client: describeTable(CLIENT_TABLE),
    server: describeTable(SERVER_TABLE),
    http: describeTable(HTTP_TABLE),
    errorCodes: Object.fromEntries(ERROR_CODES.map((c) => [c, ERROR_HTTP_STATUS[c]])),
    gatewayCapabilities: [...GATEWAY_CAPABILITIES],
    agentCapabilities: [...AGENT_CAPABILITIES],
    limits: JSON.parse(JSON.stringify(LIMITS)) as Record<string, unknown>,
  };
  return sortKeys(surface) as Surface;
}

/** The text pinned in contract.snapshot.json. */
export function serializeSurface(surface: Surface = describeSurface()): string {
  return `${JSON.stringify(surface, null, 2)}\n`;
}
