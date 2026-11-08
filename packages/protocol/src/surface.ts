import { CONTRACT_VERSION, LIMITS } from './limits.js';
import { AGENT_CAPABILITIES, GATEWAY_CAPABILITIES } from './capabilities.js';
import { ERROR_CODES, ERROR_HTTP_STATUS } from './errors.js';
import { CLIENT_TABLE, SERVER_TABLE } from './validate.js';
import { HTTP_TABLE } from './http.js';
import { OPERATIONS } from './operations.js';
import type { OperationSpec } from './operations.js';
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

/** One catalogued operation. A surface the operation lacks is null (the reason lives in the catalog, not here). */
export interface OperationEntry {
  destructive: boolean;
  readOnly: boolean;
  confirmParam?: string;
  requires: { gateway?: string; agent?: string };
  params: FieldMap;
  rules: unknown[];
  ws: Record<string, unknown> | null;
  http: Record<string, unknown> | null;
  mcp: Record<string, unknown> | null;
  palette: Record<string, unknown> | null;
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
  /** Absent in snapshots from before the operations catalog; treated as empty when diffing. */
  operations?: Record<string, OperationEntry>;
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

const binding = (b: object): Record<string, unknown> | null => ('none' in b ? null : { ...b });

function describeOperations(catalog: Readonly<Record<string, OperationSpec>>): Record<string, OperationEntry> {
  const out: Record<string, OperationEntry> = {};
  for (const name of Object.keys(catalog)) {
    const op = catalog[name];
    const entry: OperationEntry = {
      destructive: op.destructive,
      readOnly: op.readOnly,
      requires: { ...op.requires },
      params: describeFieldMap(op.params),
      rules: (op.rules ?? []).map((r) => ({ ...r })),
      ws: binding(op.ws),
      http: binding(op.http),
      mcp: binding(op.mcp),
      palette: binding(op.palette),
    };
    if (op.confirmParam !== undefined) entry.confirmParam = op.confirmParam;
    out[name] = entry;
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
    operations: describeOperations(OPERATIONS),
  };
  return sortKeys(surface) as Surface;
}

/** The text pinned in contract.snapshot.json. */
export function serializeSurface(surface: Surface = describeSurface()): string {
  return `${JSON.stringify(surface, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Diff and gate
// ---------------------------------------------------------------------------

export interface SurfaceDiff {
  breaking: string[];
  additive: string[];
}

export interface Evaluation {
  /** True when the change may merge. */
  pass: boolean;
  breaking: string[];
  additive: string[];
  notices: string[];
}

/** Attributes where a larger value is looser for consumers (lowering them is breaking). */
const UPPER_BOUNDS: ReadonlySet<string> = new Set([
  'max',
  'maxItems',
  'maxBytes',
  'maxEntries',
  'keyMax',
  'maxString',
  'maxDepth',
  'maxChars',
]);
/** Attributes where a smaller value is looser (raising them is breaking). */
const LOWER_BOUNDS: ReadonlySet<string> = new Set(['min', 'minItems']);
/** Boolean restrictions: gaining one is breaking, losing one is additive. */
const RESTRICTIONS: ReadonlySet<string> = new Set(['noControl', 'objectOnly']);
/** Attributes holding a set of allowed values: removing one is breaking, adding one is additive. */
const VALUE_SETS: ReadonlySet<string> = new Set(['values']);
/** Attributes whose value is a nested entry or field map and is compared recursively. */
const NESTED_ENTRY: ReadonlySet<string> = new Set(['item', 'value']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const show = (v: unknown): string => (v === undefined ? 'unbounded' : String(v));

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function diffEntry(path: string, prev: FieldEntry, next: FieldEntry, out: SurfaceDiff): void {
  if (prev.kind !== next.kind) {
    out.breaking.push(`${path}: kind changed from ${prev.kind} to ${next.kind}`);
    return;
  }
  const attrs = new Set([...Object.keys(prev), ...Object.keys(next)]);
  attrs.delete('kind');
  attrs.delete('required');
  for (const attr of [...attrs].sort()) {
    const a = prev[attr];
    const b = next[attr];
    if (same(a, b)) continue;
    const here = `${path}.${attr}`;
    if (UPPER_BOUNDS.has(attr)) {
      const from = typeof a === 'number' ? a : Infinity;
      const to = typeof b === 'number' ? b : Infinity;
      if (to < from) out.breaking.push(`${here}: lowered from ${show(a)} to ${show(b)}`);
      else out.additive.push(`${here}: raised from ${show(a)} to ${show(b)}`);
    } else if (LOWER_BOUNDS.has(attr)) {
      const from = typeof a === 'number' ? a : -Infinity;
      const to = typeof b === 'number' ? b : -Infinity;
      if (to > from) out.breaking.push(`${here}: raised from ${show(a)} to ${show(b)}`);
      else out.additive.push(`${here}: lowered from ${show(a)} to ${show(b)}`);
    } else if (RESTRICTIONS.has(attr)) {
      if (b === true) out.breaking.push(`${here}: restriction added`);
      else out.additive.push(`${here}: restriction removed`);
    } else if (VALUE_SETS.has(attr)) {
      const was = Array.isArray(a) ? (a as unknown[]) : [];
      const now = Array.isArray(b) ? (b as unknown[]) : [];
      for (const v of was) if (!now.some((x) => same(x, v))) out.breaking.push(`${here}: value ${JSON.stringify(v)} removed`);
      for (const v of now) if (!was.some((x) => same(x, v))) out.additive.push(`${here}: value ${JSON.stringify(v)} added`);
    } else if (NESTED_ENTRY.has(attr) && isRecord(a) && isRecord(b)) {
      diffEntry(here, a as FieldEntry, b as FieldEntry, out);
    } else if (attr === 'fields' && isRecord(a) && isRecord(b)) {
      diffFieldMap(here, a as FieldMap, b as FieldMap, out);
    } else if (attr === 'variants' && isRecord(a) && isRecord(b)) {
      const va = a as Record<string, FieldMap>;
      const vb = b as Record<string, FieldMap>;
      for (const tag of Object.keys(va)) {
        if (!(tag in vb)) out.breaking.push(`${here}.${tag}: variant removed`);
        else diffFieldMap(`${here}.${tag}`, va[tag], vb[tag], out);
      }
      for (const tag of Object.keys(vb)) if (!(tag in va)) out.additive.push(`${here}.${tag}: variant added`);
    } else {
      // Any other attribute (literal value, tag field, trim, dropUnknown) changes behaviour: be conservative.
      out.breaking.push(`${here}: changed from ${JSON.stringify(a)} to ${JSON.stringify(b)}`);
    }
  }
}

function diffFieldMap(path: string, prev: FieldMap, next: FieldMap, out: SurfaceDiff): void {
  for (const name of Object.keys(prev)) {
    const here = `${path}.${name}`;
    if (!(name in next)) {
      out.breaking.push(`${here}: field removed`);
      continue;
    }
    if (prev[name].required === false && next[name].required === true) {
      out.breaking.push(`${here}: optional field made required`);
    } else if (prev[name].required === true && next[name].required === false) {
      out.additive.push(`${here}: required field made optional`);
    }
    diffEntry(here, prev[name], next[name], out);
  }
  for (const name of Object.keys(next)) {
    if (name in prev) continue;
    const here = `${path}.${name}`;
    if (next[name].required) out.breaking.push(`${here}: new required field`);
    else out.additive.push(`${here}: new optional field`);
  }
}

function diffTable(
  label: string,
  prev: Record<string, MessageEntry>,
  next: Record<string, MessageEntry>,
  out: SurfaceDiff,
): void {
  for (const type of Object.keys(prev)) {
    const here = `${label}.${type}`;
    if (!(type in next)) {
      out.breaking.push(`${here}: removed`);
      continue;
    }
    diffFieldMap(here, prev[type].fields, next[type].fields, out);
    const was = prev[type].rules.map((r) => JSON.stringify(r));
    const now = next[type].rules.map((r) => JSON.stringify(r));
    for (const r of now) if (!was.includes(r)) out.breaking.push(`${here}: rule added ${r}`);
    for (const r of was) if (!now.includes(r)) out.additive.push(`${here}: rule removed ${r}`);
  }
  for (const type of Object.keys(next)) {
    if (!(type in prev)) out.additive.push(`${label}.${type}: added`);
  }
}

function diffList(label: string, prev: string[], next: string[], out: SurfaceDiff): void {
  for (const v of prev) if (!next.includes(v)) out.breaking.push(`${label}: ${v} removed`);
  for (const v of next) if (!prev.includes(v)) out.additive.push(`${label}: ${v} added`);
}

function diffLimits(path: string, prev: Record<string, unknown>, next: Record<string, unknown>, out: SurfaceDiff): void {
  for (const key of Object.keys(prev)) {
    const here = `${path}.${key}`;
    if (!(key in next)) {
      out.breaking.push(`${here}: limit removed`);
      continue;
    }
    const a = prev[key];
    const b = next[key];
    if (isRecord(a) && isRecord(b)) diffLimits(here, a, b, out);
    else if (typeof a === 'number' && typeof b === 'number') {
      if (b < a) out.breaking.push(`${here}: lowered from ${a} to ${b}`);
      else if (b > a) out.additive.push(`${here}: raised from ${a} to ${b}`);
    } else if (!same(a, b)) out.breaking.push(`${here}: changed from ${JSON.stringify(a)} to ${JSON.stringify(b)}`);
  }
  for (const key of Object.keys(next)) if (!(key in prev)) out.additive.push(`${path}.${key}: limit added`);
}

function diffOperations(
  prev: Record<string, OperationEntry>,
  next: Record<string, OperationEntry>,
  out: SurfaceDiff,
): void {
  for (const name of Object.keys(prev)) if (!(name in next)) out.breaking.push(`operations.${name}: removed`);
  for (const name of Object.keys(next)) if (!(name in prev)) out.additive.push(`operations.${name}: added`);
}

/** Classifies every difference between two surfaces as breaking or additive. */
export function diffSurface(prev: Surface, next: Surface): SurfaceDiff {
  const out: SurfaceDiff = { breaking: [], additive: [] };
  if (next.contract < prev.contract) out.breaking.push(`contract: lowered from ${prev.contract} to ${next.contract}`);
  else if (next.contract > prev.contract) out.additive.push(`contract: raised from ${prev.contract} to ${next.contract}`);
  diffTable('client', prev.client, next.client, out);
  diffTable('server', prev.server, next.server, out);
  diffTable('http', prev.http, next.http, out);
  for (const code of Object.keys(prev.errorCodes)) {
    if (!(code in next.errorCodes)) out.breaking.push(`errorCodes.${code}: removed`);
    else if (prev.errorCodes[code] !== next.errorCodes[code]) {
      out.breaking.push(`errorCodes.${code}: HTTP status changed from ${prev.errorCodes[code]} to ${next.errorCodes[code]}`);
    }
  }
  for (const code of Object.keys(next.errorCodes)) {
    if (!(code in prev.errorCodes)) out.additive.push(`errorCodes.${code}: added`);
  }
  diffList('gatewayCapabilities', prev.gatewayCapabilities, next.gatewayCapabilities, out);
  diffList('agentCapabilities', prev.agentCapabilities, next.agentCapabilities, out);
  diffLimits('limits', prev.limits, next.limits, out);
  diffOperations(prev.operations ?? {}, next.operations ?? {}, out);
  return out;
}

/**
 * The merge gate. Fails only when the change is breaking and next.contract was not raised above
 * prev.contract; a breaking change with a raised contract passes with a notice.
 */
export function evaluate(prev: Surface, next: Surface): Evaluation {
  const { breaking, additive } = diffSurface(prev, next);
  const notices: string[] = [];
  if (breaking.length === 0) {
    if (additive.length > 0) notices.push(`${additive.length} additive change(s); no contract bump required`);
    return { pass: true, breaking, additive, notices };
  }
  if (next.contract > prev.contract) {
    notices.push(
      `${breaking.length} breaking change(s) accepted because contract was raised from ${prev.contract} to ${next.contract}`,
    );
    return { pass: true, breaking, additive, notices };
  }
  notices.push(`${breaking.length} breaking change(s) require raising CONTRACT_VERSION above ${prev.contract}`);
  return { pass: false, breaking, additive, notices };
}

const SAFE_REF = /^[A-Za-z0-9._/~^@-]{1,200}$/;

/** A git ref the CLI may pass to git: conservative charset, bounded length, never an option (leading hyphen). */
export function isSafeGitRef(ref: string): boolean {
  return SAFE_REF.test(ref) && !ref.startsWith('-');
}
