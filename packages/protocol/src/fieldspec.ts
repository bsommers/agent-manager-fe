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
    | { kind: 'enum'; values: readonly string[] }
    | { kind: 'token'; max: number }
    | { kind: 'stringArray'; minItems: number; maxItems: number; item: FieldSpec }
    | { kind: 'objectArray'; maxItems: number; fields: ObjectSpec }
    | { kind: 'object'; fields: ObjectSpec }
    /** Plain-object map: bounded entry count and key length, every value checked by `value`. */
    | { kind: 'map'; maxEntries: number; keyMax: number; value: FieldSpec }
    /** Array of strings filtered to a known list (order kept, duplicates and unknowns dropped). */
    | { kind: 'enumList'; values: readonly string[]; maxItems: number }
  );

export type ObjectSpec = Readonly<Record<string, FieldSpec>>;

/** A message table row: its fields plus cross-field rules (rule kinds arrive with the messages that need them). */
export type MessageSpec = {
  readonly fields: ObjectSpec;
  readonly rules?: readonly Rule[];
};

export type Rule = { kind: 'exactlyOne' | 'atLeastOne'; fields: readonly string[] };

export type FieldResult = { ok: true; value: unknown } | { ok: false; field: string; detail: string };

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

function validateValue(spec: FieldSpec, value: unknown, path: string): FieldResult {
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
    const r = validateValue(spec, value[key], fieldPath);
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
