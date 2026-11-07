import type { Agent } from './agent.js';
import type { WSMessageClient, WSMessageServer } from './messages.js';
import { LIMITS } from './limits.js';

export type ParseFailureReason = 'not_object' | 'missing_type' | 'unknown_type' | 'invalid_field';

export type ParseResult<T> =
  | { ok: true; msg: T }
  | { ok: false; reason: ParseFailureReason; field?: string; detail?: string };

// ---------------------------------------------------------------------------
// Field-spec vocabulary
// ---------------------------------------------------------------------------

type Optionality = { optional?: boolean };

type FieldSpec = Optionality &
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
  );

type ObjectSpec = Readonly<Record<string, FieldSpec>>;

type FieldResult = { ok: true; value: unknown } | { ok: false; field: string; detail: string };

const fail = (field: string, detail: string): FieldResult => ({ ok: false, field, detail });

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const isPlainObjectLike = (v: unknown): v is Record<string, unknown> =>
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
  }
}

/** Reads only the declared keys into a fresh plain object; unknown keys are never copied. */
function validateObject(fields: ObjectSpec, value: unknown, path: string): FieldResult {
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

// ---------------------------------------------------------------------------
// Shared specs
// ---------------------------------------------------------------------------

const STATUSES = ['idle', 'running', 'thinking', 'error', 'disconnected'] as const;
const CLIENT_MODES = ['tmux', 'ssh'] as const;

const idSpec: FieldSpec = { kind: 'string', min: 1, max: LIMITS.MAX_ID_LENGTH };
const statusSpec: FieldSpec = { kind: 'enum', values: STATUSES };

const LAYOUT_SPEC: ObjectSpec = {
  isFloating: { kind: 'boolean' },
  x: { kind: 'number', optional: true },
  y: { kind: 'number', optional: true },
  width: { kind: 'number', optional: true },
  height: { kind: 'number', optional: true },
  zIndex: { kind: 'number', optional: true },
  isMinimized: { kind: 'boolean', optional: true },
};

const AGENT_SPEC: ObjectSpec = {
  id: idSpec,
  name: { kind: 'string', min: 1, max: LIMITS.MAX_NAME_LENGTH },
  mode: { kind: 'token', max: LIMITS.MAX_MODE_LENGTH },
  targetHost: { kind: 'string', min: 1, max: LIMITS.MAX_TARGET_HOST_LENGTH },
  status: statusSpec,
  unreadOutput: { kind: 'boolean' },
  layout: { kind: 'object', fields: LAYOUT_SPEC },
  createdAt: { kind: 'number' },
  lastActivity: { kind: 'number' },
};

const inputData: FieldSpec = {
  kind: 'string',
  min: 0,
  max: LIMITS.MAX_INPUT_BYTES,
  maxBytes: LIMITS.MAX_INPUT_BYTES,
};

// ---------------------------------------------------------------------------
// Tables: one row per message type. `satisfies Record<type, ObjectSpec>` makes a
// missing or surplus row a compile error when the unions change.
// ---------------------------------------------------------------------------

const CLIENT_TABLE = {
  'agent:input': { agentId: idSpec, data: inputData },
  'agent:resize': {
    agentId: idSpec,
    cols: { kind: 'integer', min: 1, max: 1000 },
    rows: { kind: 'integer', min: 1, max: 1000 },
  },
  'agent:create': {
    name: { kind: 'string', min: 1, max: LIMITS.MAX_NAME_LENGTH, trim: true, noControl: true },
    mode: { kind: 'enum', values: CLIENT_MODES },
    targetHost: {
      kind: 'string',
      min: 1,
      max: LIMITS.MAX_TARGET_HOST_LENGTH,
      noControl: true,
    },
    initialCmd: { kind: 'string', min: 0, max: LIMITS.MAX_INITIAL_CMD_LENGTH, optional: true },
  },
  'agent:kill': { agentId: idSpec },
  'agent:broadcast': {
    targetAgentIds: {
      kind: 'stringArray',
      minItems: 1,
      maxItems: LIMITS.MAX_BROADCAST_TARGETS,
      item: idSpec,
    },
    data: inputData,
  },
} satisfies Record<WSMessageClient['type'], ObjectSpec>;

const SERVER_TABLE = {
  'agent:output': {
    agentId: idSpec,
    data: {
      kind: 'string',
      min: 0,
      max: LIMITS.MAX_FRAME_BYTES,
      maxBytes: LIMITS.MAX_FRAME_BYTES,
    },
  },
  'agent:status_change': { agentId: idSpec, status: statusSpec },
  'agent:init_list': {
    agents: { kind: 'objectArray', maxItems: LIMITS.MAX_AGENTS, fields: AGENT_SPEC },
  },
} satisfies Record<WSMessageServer['type'], ObjectSpec>;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseWith<T>(table: Readonly<Record<string, ObjectSpec>>, input: unknown): ParseResult<T> {
  try {
    if (!isPlainObjectLike(input)) {
      return { ok: false, reason: 'not_object', detail: 'message must be an object' };
    }
    const type = hasOwn(input, 'type') ? input.type : undefined;
    if (typeof type !== 'string') {
      return { ok: false, reason: 'missing_type', field: 'type', detail: 'type must be a string' };
    }
    if (!hasOwn(table, type)) {
      return { ok: false, reason: 'unknown_type', field: 'type', detail: 'unrecognised message type' };
    }
    const r = validateObject(table[type], input, '');
    if (!r.ok) {
      return { ok: false, reason: 'invalid_field', field: r.field, detail: r.detail };
    }
    return { ok: true, msg: { type, ...(r.value as object) } as T };
  } catch {
    return { ok: false, reason: 'invalid_field', detail: 'input could not be read safely' };
  }
}

/** Validates an untrusted client-to-server frame. Never throws; strips unknown fields. */
export function parseClientMessage(input: unknown): ParseResult<WSMessageClient> {
  return parseWith<WSMessageClient>(CLIENT_TABLE, input);
}

/** Validates an untrusted server-to-client frame. Never throws; strips unknown fields. */
export function parseServerMessage(input: unknown): ParseResult<WSMessageServer> {
  return parseWith<WSMessageServer>(SERVER_TABLE, input);
}

/** Validates a single Agent record. Never throws; strips unknown fields. */
export function parseAgent(input: unknown): ParseResult<Agent> {
  try {
    const r = validateObject(AGENT_SPEC, input, '');
    if (!r.ok) return { ok: false, reason: 'invalid_field', field: r.field, detail: r.detail };
    return { ok: true, msg: r.value as Agent };
  } catch {
    return { ok: false, reason: 'invalid_field', detail: 'input could not be read safely' };
  }
}
