// ---------------------------------------------------------------------------
// Field-spec vocabulary
// ---------------------------------------------------------------------------

export type Optionality = { optional?: boolean };

export type FieldSpec = Optionality &
  (
    | {
        kind: 'string';
        min: number;
        max: number;
        /** Maximum UTF-8 byte length. */
        maxBytes?: number;
        noControl?: boolean;
        trim?: boolean;
      }
    | { kind: 'integer'; min: number; max: number }
    | { kind: 'number' }
    | { kind: 'boolean' }
    /** `dropUnknown`: on an optional field an unknown value yields an absent field instead of a failure. */
    | { kind: 'enum'; values: readonly string[]; dropUnknown?: boolean }
    /** Exactly this value (e.g. `ok: true`). */
    | { kind: 'literal'; value: string | number | boolean }
    /** Any JSON value, bounded by container depth, serialized size and forbidden keys; the result is a deep copy. */
    | { kind: 'json'; maxDepth: number; maxChars: number; objectOnly?: boolean }
    /** Object whose field set depends on the value of the sibling field `tag`. */
    | { kind: 'byTag'; tag: string; variants: Readonly<Record<string, ObjectSpec>> }
    | { kind: 'token'; max: number }
    | { kind: 'stringArray'; minItems: number; maxItems: number; item: FieldSpec }
    | { kind: 'objectArray'; maxItems: number; fields: ObjectSpec }
    | { kind: 'object'; fields: ObjectSpec }
    /** Plain-object map: bounded entry count and key length, every value checked by `value`. */
    | { kind: 'map'; maxEntries: number; keyMax: number; value: FieldSpec }
    /** String (bounded), finite number or boolean. */
    | { kind: 'scalar'; maxString: number }
    /** Array of strings filtered to a known list (order kept, duplicates and unknowns dropped). */
    | { kind: 'enumList'; values: readonly string[]; maxItems: number }
  );

export type ObjectSpec = Readonly<Record<string, FieldSpec>>;

/** A message table row: its fields plus cross-field rules (rule kinds arrive with the messages that need them). */
export type MessageSpec = {
  readonly fields: ObjectSpec;
  readonly rules?: readonly Rule[];
};

export type Rule =
  | { kind: 'exactlyOne' | 'atLeastOne'; fields: readonly string[] }
  /** Numeric field `field` must be at least numeric field `other` (checked when both are present). */
  | { kind: 'gte'; field: string; other: string };

/** `reason` is set only for failures that are an unknown discriminator rather than an invalid value. */
export type FieldResult =
  | { ok: true; value: unknown }
  | { ok: false; field: string; detail: string; reason?: 'unknown_type' };

const fail = (field: string, detail: string): FieldResult => ({ ok: false, field, detail });

const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export const isPlainObjectLike = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** UTF-8 byte length over code points; lone surrogates count as 3 (U+FFFD). */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) bytes += 1;
    else if (cp < 0x800) bytes += 2;
    else if (cp < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

function isLowerToken(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const lower = c >= 0x61 && c <= 0x7a;
    const digit = c >= 0x30 && c <= 0x39;
    if (!(lower || digit || c === 0x2d || c === 0x5f)) return false;
  }
  return s.length > 0;
}

type JsonBudget = { left: number };

/**
 * Deep-copies a JSON value. `left` is a lower bound on the serialized size, spent while copying so an
 * oversized input is rejected early; the caller then checks the exact size.
 */
function copyJson(value: unknown, depth: number, maxDepth: number, budget: JsonBudget, path: string): FieldResult {
  const spend = (n: number): boolean => {
    budget.left -= n;
    return budget.left >= 0;
  };
  if (value === null) return spend(4) ? { ok: true, value: null } : fail(path, 'is too large');
  switch (typeof value) {
    case 'string':
      return spend(value.length + 2) ? { ok: true, value } : fail(path, 'is too large');
    case 'boolean':
      return spend(4) ? { ok: true, value } : fail(path, 'is too large');
    case 'number':
      if (!Number.isFinite(value)) return fail(path, 'must be a finite number');
      return spend(1) ? { ok: true, value } : fail(path, 'is too large');
    case 'object':
      break;
    default:
      return fail(path, 'must be a JSON value');
  }
  if (depth > maxDepth) return fail(path, `must be nested at most ${maxDepth} levels deep`);
  if (Array.isArray(value)) {
    if (!spend(2)) return fail(path, 'is too large');
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!spend(1)) return fail(path, 'is too large');
      const r = copyJson(value[i], depth + 1, maxDepth, budget, `${path}[${i}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (!spend(2)) return fail(path, 'is too large');
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (RESERVED_KEYS.has(key)) return fail(path, 'must not contain a reserved key');
    if (!spend(key.length + 4)) return fail(path, 'is too large');
    const r = copyJson(src[key], depth + 1, maxDepth, budget, `${path}.${key}`);
    if (!r.ok) return r;
    out[key] = r.value;
  }
  return { ok: true, value: out };
}

function validateValue(
  spec: FieldSpec,
  value: unknown,
  path: string,
  parent?: Record<string, unknown>,
  parentPath = '',
): FieldResult {
  switch (spec.kind) {
    case 'string': {
      if (typeof value !== 'string') return fail(path, 'must be a string');
      const s = spec.trim ? value.trim() : value;
      if (s.length < spec.min) return fail(path, `must be at least ${spec.min} characters`);
      if (s.length > spec.max) return fail(path, `must be at most ${spec.max} characters`);
      if (spec.noControl && hasControlChars(s)) return fail(path, 'must not contain control characters');
      // UTF-16 length never exceeds byte length, so this rejects oversized input before iterating.
      if (spec.maxBytes !== undefined) {
        if (s.length > spec.maxBytes || utf8ByteLength(s) > spec.maxBytes) {
          return fail(path, `must be at most ${spec.maxBytes} bytes`);
        }
      }
      return { ok: true, value: s };
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return fail(path, 'must be an integer');
      if (value < spec.min || value > spec.max) {
        return fail(path, `must be between ${spec.min} and ${spec.max}`);
      }
      return { ok: true, value };
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'must be a finite number');
      return { ok: true, value };
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
      return { ok: true, value };
    }
    case 'enum': {
      if (typeof value !== 'string' || !spec.values.includes(value)) {
        return fail(path, `must be one of ${spec.values.join(', ')}`);
      }
      return { ok: true, value };
    }
    case 'literal': {
      if (value !== spec.value) return fail(path, `must be ${JSON.stringify(spec.value)}`);
      return { ok: true, value };
    }
    case 'json': {
      if (spec.objectOnly && !isPlainObjectLike(value)) return fail(path, 'must be an object');
      const r = copyJson(value, 1, spec.maxDepth, { left: spec.maxChars }, path);
      // Report the field itself, never a path built from attacker-chosen keys.
      if (!r.ok) return fail(path, r.detail);
      const size = JSON.stringify(r.value).length;
      if (size > spec.maxChars) return fail(path, `must serialize to at most ${spec.maxChars} characters`);
      return r;
    }
    case 'byTag': {
      const tagPath = parentPath ? `${parentPath}.${spec.tag}` : spec.tag;
      const tag = parent ? parent[spec.tag] : undefined;
      if (typeof tag !== 'string' || !hasOwn(spec.variants, tag)) {
        return { ok: false, field: tagPath, detail: `unrecognised ${spec.tag}`, reason: 'unknown_type' };
      }
      return validateObject(spec.variants[tag], value, path);
    }
    case 'token': {
      if (typeof value !== 'string') return fail(path, 'must be a string');
      if (value.length > spec.max) return fail(path, `must be at most ${spec.max} characters`);
      if (!isLowerToken(value)) return fail(path, 'must be a lowercase token');
      return { ok: true, value };
    }
    case 'stringArray': {
      if (!Array.isArray(value)) return fail(path, 'must be an array');
      if (value.length < spec.minItems) return fail(path, `must have at least ${spec.minItems} items`);
      if (value.length > spec.maxItems) return fail(path, `must have at most ${spec.maxItems} items`);
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = validateValue(spec.item, value[i], `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case 'objectArray': {
      if (!Array.isArray(value)) return fail(path, 'must be an array');
      if (value.length > spec.maxItems) return fail(path, `must have at most ${spec.maxItems} items`);
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = validateObject(spec.fields, value[i], `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case 'object':
      return validateObject(spec.fields, value, path);
    case 'map': {
      if (!isPlainObjectLike(value)) return fail(path, 'must be an object');
      const keys = Object.keys(value);
      if (keys.length > spec.maxEntries) return fail(path, `must have at most ${spec.maxEntries} entries`);
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        if (RESERVED_KEYS.has(key)) return fail(path, 'must not contain a reserved key');
        if (key.length < 1 || key.length > spec.keyMax) {
          return fail(path, `keys must be 1 to ${spec.keyMax} characters`);
        }
        const r = validateValue(spec.value, value[key], `${path}.${key}`);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      return { ok: true, value: out };
    }
    case 'scalar': {
      if (typeof value === 'string') {
        if (value.length > spec.maxString) return fail(path, `must be at most ${spec.maxString} characters`);
        return { ok: true, value };
      }
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
      if (typeof value === 'boolean') return { ok: true, value };
      return fail(path, 'must be a string, finite number or boolean');
    }
    case 'enumList': {
      if (!Array.isArray(value)) return fail(path, 'must be an array');
      if (value.length > spec.maxItems) return fail(path, `must have at most ${spec.maxItems} items`);
      const out: string[] = [];
      for (const item of value) {
        if (typeof item === 'string' && spec.values.includes(item) && !out.includes(item)) out.push(item);
      }
      return { ok: true, value: out };
    }
  }
}

/** Reads only the declared keys into a fresh plain object; unknown keys are never copied. */
export function validateObject(fields: ObjectSpec, value: unknown, path: string): FieldResult {
  if (!isPlainObjectLike(value)) return fail(path, 'must be an object');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    const spec = fields[key];
    const fieldPath = path ? `${path}.${key}` : key;
    const present = hasOwn(value, key) && value[key] !== undefined;
    if (!present) {
      if (spec.optional) continue;
      return fail(fieldPath, 'is required');
    }
    if (spec.kind === 'enum' && spec.dropUnknown && spec.optional) {
      const v = value[key];
      if (typeof v !== 'string' || !spec.values.includes(v)) continue;
    }
    const r = validateValue(spec, value[key], fieldPath, value, path);
    if (!r.ok) return r;
    out[key] = r.value;
  }
  return { ok: true, value: out };
}


/** Evaluates cross-field rules on the validated copy; returns the first failure naming the first listed field. */
export function evaluateRules(
  rules: readonly Rule[] | undefined,
  value: Record<string, unknown>,
): { field: string; detail: string } | null {
  if (!rules) return null;
  for (const rule of rules) {
    if (rule.kind === 'gte') {
      const a = value[rule.field];
      const b = value[rule.other];
      if (typeof a === 'number' && typeof b === 'number' && a < b) {
        return { field: rule.field, detail: `must be at least ${rule.other}` };
      }
      continue;
    }
    const present = rule.fields.filter((f) => hasOwn(value, f)).length;
    if (rule.kind === 'exactlyOne' && present !== 1) {
      return { field: rule.fields[0], detail: `exactly one of ${rule.fields.join(', ')} is required` };
    }
    if (rule.kind === 'atLeastOne' && present < 1) {
      return { field: rule.fields[0], detail: `at least one of ${rule.fields.join(', ')} is required` };
    }
  }
  return null;
}
