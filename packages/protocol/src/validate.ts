import type { Agent } from './agent.js';
import type { WSMessageClient, WSMessageServer } from './messages.js';
import { LIMITS } from './limits.js';
import { GATEWAY_CAPABILITIES } from './capabilities.js';
import { hasOwn, isPlainObjectLike, validateObject } from './fieldspec.js';
import { evaluateRules } from './fieldspec.js';
import type { FieldSpec, MessageSpec, ObjectSpec } from './fieldspec.js';

export type ParseFailureReason = 'not_object' | 'missing_type' | 'unknown_type' | 'invalid_field';

export type ParseResult<T> =
  | { ok: true; msg: T }
  | { ok: false; reason: ParseFailureReason; field?: string; detail?: string };

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

const nameSpec: FieldSpec = { kind: 'string', min: 1, max: 64 };
const versionSpec: FieldSpec = { kind: 'string', min: 1, max: 32 };
const reqIdSpec: FieldSpec = { kind: 'string', min: 1, max: LIMITS.MAX_ID_LENGTH, optional: true };
const seqSpec: FieldSpec = { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER, optional: true };

const positiveInt: FieldSpec = { kind: 'integer', min: 1, max: Number.MAX_SAFE_INTEGER };

export const CLIENT_TABLE = {
  hello: {
    fields: {
      contract: positiveInt,
      token: { kind: 'string', min: 0, max: 512, noControl: true, optional: true },
      epoch: { kind: 'string', min: 1, max: 128, optional: true },
      resumeFrom: {
        kind: 'map',
        maxEntries: 1000,
        keyMax: LIMITS.MAX_ID_LENGTH,
        value: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
        optional: true,
      },
      client: {
        kind: 'object',
        fields: { name: nameSpec, version: versionSpec },
        optional: true,
      },
    },
  },
  ping: { fields: { t: { kind: 'number' } } },
  'agent:input': { fields: { agentId: idSpec, data: inputData } },
  'agent:resize': {
    fields: {
      agentId: idSpec,
      cols: { kind: 'integer', min: 1, max: 1000 },
      rows: { kind: 'integer', min: 1, max: 1000 },
    },
  },
  'agent:create': {
    fields: {
      name: { kind: 'string', min: 1, max: LIMITS.MAX_NAME_LENGTH, trim: true, noControl: true },
      mode: { kind: 'enum', values: CLIENT_MODES },
      targetHost: {
        kind: 'string',
        min: 1,
        max: LIMITS.MAX_TARGET_HOST_LENGTH,
        noControl: true,
      },
      initialCmd: { kind: 'string', min: 0, max: LIMITS.MAX_INITIAL_CMD_LENGTH, optional: true },
      backend: { kind: 'token', max: 64, optional: true },
      params: {
        kind: 'map',
        maxEntries: 32,
        keyMax: 64,
        value: { kind: 'scalar', maxString: 1024 },
        optional: true,
      },
      reqId: reqIdSpec,
    },
  },
  'agent:kill': { fields: { agentId: idSpec, reqId: reqIdSpec } },
  'agent:update': {
    fields: {
      agentId: idSpec,
      name: {
        kind: 'string',
        min: 1,
        max: LIMITS.MAX_NAME_LENGTH,
        trim: true,
        noControl: true,
        optional: true,
      },
      tags: {
        kind: 'stringArray',
        minItems: 0,
        maxItems: 32,
        item: { kind: 'string', min: 1, max: 64, noControl: true },
        optional: true,
      },
      group: { kind: 'string', min: 1, max: 64, noControl: true, optional: true },
      reqId: reqIdSpec,
    },
    rules: [{ kind: 'atLeastOne', fields: ['name', 'tags', 'group'] }],
  },
  'agent:history': {
    fields: {
      agentId: idSpec,
      beforeSeq: seqSpec,
      afterSeq: seqSpec,
      limit: { kind: 'integer', min: 1, max: 1000, optional: true },
      reqId: reqIdSpec,
    },
    rules: [{ kind: 'exactlyOne', fields: ['beforeSeq', 'afterSeq'] }],
  },
  'agent:approve': {
    fields: {
      agentId: idSpec,
      gateId: idSpec,
      decision: { kind: 'enum', values: ['approve', 'deny'] },
      reqId: reqIdSpec,
    },
  },
  'agent:broadcast': {
    fields: {
      targetAgentIds: {
        kind: 'stringArray',
        minItems: 1,
        maxItems: LIMITS.MAX_BROADCAST_TARGETS,
        item: idSpec,
      },
      data: inputData,
      reqId: reqIdSpec,
    },
  },
} as const satisfies Record<WSMessageClient['type'], MessageSpec>;

export const SERVER_TABLE = {
  hello_ack: {
    fields: {
      contract: positiveInt,
      epoch: { kind: 'string', min: 1, max: 128 },
      server: { kind: 'object', fields: { name: nameSpec, version: versionSpec } },
      auth: { kind: 'object', fields: { required: { kind: 'boolean' } } },
      limits: {
        kind: 'object',
        fields: {
          maxFrameBytes: positiveInt,
          maxInputBytes: positiveInt,
          maxBroadcastTargets: positiveInt,
        },
      },
      backends: {
        kind: 'objectArray',
        maxItems: 16,
        fields: {
          id: idSpec,
          label: { kind: 'string', min: 1, max: LIMITS.MAX_NAME_LENGTH },
          up: { kind: 'boolean' },
          capabilities: { kind: 'enumList', values: GATEWAY_CAPABILITIES, maxItems: 64 },
        },
      },
    },
  },
  'agent:output': {
    fields: {
      agentId: idSpec,
      data: {
        kind: 'string',
        min: 0,
        max: LIMITS.MAX_FRAME_BYTES,
        maxBytes: LIMITS.MAX_FRAME_BYTES,
      },
    },
  },
  'agent:status_change': { fields: { agentId: idSpec, status: statusSpec } },
  'agent:init_list': {
    fields: {
      agents: { kind: 'objectArray', maxItems: LIMITS.MAX_AGENTS, fields: AGENT_SPEC },
    },
  },
} as const satisfies Record<WSMessageServer['type'], MessageSpec>;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseWith<T>(table: Readonly<Record<string, MessageSpec>>, input: unknown): ParseResult<T> {
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
    const row = table[type];
    const r = validateObject(row.fields, input, '');
    if (!r.ok) {
      return { ok: false, reason: 'invalid_field', field: r.field, detail: r.detail };
    }
    const ruleFail = evaluateRules(row.rules, r.value as Record<string, unknown>);
    if (ruleFail) {
      return { ok: false, reason: 'invalid_field', field: ruleFail.field, detail: ruleFail.detail };
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
