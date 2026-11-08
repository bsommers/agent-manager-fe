import type { Agent } from './agent.js';
import type { MetaScope, WSMessageClient, WSMessageServer } from './messages.js';
import { LIMITS } from './limits.js';
import { AGENT_CAPABILITIES, GATEWAY_CAPABILITIES } from './capabilities.js';
import { ERROR_CODES } from './errors.js';
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

/** Depth and serialized-size caps for free-form JSON values (contract spec section 5). */
const JSON_MAX_DEPTH = 8;
const JSON_MAX_CHARS = 65536;

const AGENT_KINDS = ['terminal', 'sandbox', 'pipeline'] as const;
const TAGS_SPEC: FieldSpec = {
  kind: 'stringArray',
  minItems: 0,
  maxItems: 32,
  item: { kind: 'string', min: 1, max: 64, noControl: true },
  optional: true,
};
const GROUP_SPEC: FieldSpec = { kind: 'string', min: 1, max: 64, noControl: true, optional: true };
const META_SPEC: FieldSpec = {
  kind: 'json',
  maxDepth: JSON_MAX_DEPTH,
  maxChars: JSON_MAX_CHARS,
  objectOnly: true,
  optional: true,
};

export const AGENT_SPEC: ObjectSpec = {
  id: idSpec,
  name: { kind: 'string', min: 1, max: LIMITS.MAX_NAME_LENGTH },
  mode: { kind: 'token', max: LIMITS.MAX_MODE_LENGTH },
  targetHost: { kind: 'string', min: 1, max: LIMITS.MAX_TARGET_HOST_LENGTH },
  status: statusSpec,
  unreadOutput: { kind: 'boolean' },
  layout: { kind: 'object', fields: LAYOUT_SPEC },
  createdAt: { kind: 'number' },
  lastActivity: { kind: 'number' },
  kind: { kind: 'enum', values: AGENT_KINDS, dropUnknown: true, optional: true },
  backend: { kind: 'token', max: 64, optional: true },
  capabilities: { kind: 'enumList', values: AGENT_CAPABILITIES, maxItems: 64, optional: true },
  tags: TAGS_SPEC,
  group: GROUP_SPEC,
  meta: META_SPEC,
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

const OUTPUT_DATA: FieldSpec = {
  kind: 'string',
  min: 0,
  max: LIMITS.MAX_FRAME_BYTES,
  maxBytes: LIMITS.MAX_FRAME_BYTES,
};
const errorCodeSpec: FieldSpec = { kind: 'enum', values: ERROR_CODES };

const AGENT_SPEC_FIELD_SPEC: ObjectSpec = {
  name: { kind: 'string', min: 1, max: 64 },
  label: { kind: 'string', min: 1, max: 128 },
  type: { kind: 'enum', values: ['string', 'number', 'boolean', 'enum'] },
  required: { kind: 'boolean', optional: true },
  options: {
    kind: 'stringArray',
    minItems: 0,
    maxItems: 64,
    item: { kind: 'string', min: 1, max: 256 },
    optional: true,
  },
};

/** Per-scope `agent:meta` payloads (contract spec section 6.4). */
const META_VARIANTS = {
  cost: {
    spent: { kind: 'number' },
    cap: { kind: 'number', optional: true },
    currency: { kind: 'string', min: 1, max: 16, optional: true },
    tokens: {
      kind: 'object',
      fields: { in: { kind: 'number' }, out: { kind: 'number' } },
      optional: true,
    },
  },
  quota: {
    used: { kind: 'number' },
    limit: { kind: 'number' },
    window: { kind: 'string', min: 1, max: 64, optional: true },
    resetAt: { kind: 'number', optional: true },
  },
  task: {
    id: idSpec,
    title: { kind: 'string', min: 0, max: 256, optional: true },
    state: { kind: 'enum', values: ['queued', 'running', 'done', 'failed'] },
    exitCode: { kind: 'integer', min: -2147483648, max: 2147483647, optional: true },
  },
  pipeline: {
    stage: { kind: 'string', min: 1, max: 128 },
    wave: { kind: 'string', min: 1, max: 128, optional: true },
    state: { kind: 'enum', values: ['running', 'passed', 'failed', 'waiting_gate'], optional: true },
  },
  sandbox: {
    state: { kind: 'enum', values: ['creating', 'running', 'stopped', 'snapshotting', 'deleting', 'error'] },
    detail: { kind: 'string', min: 0, max: 1024, optional: true },
  },
} as const satisfies Record<MetaScope, ObjectSpec>;

export const SERVER_TABLE = {
  pong: { fields: { t: { kind: 'number' } } },
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
          agentSpecs: {
            kind: 'objectArray',
            maxItems: 16,
            optional: true,
            fields: {
              mode: { kind: 'token', max: LIMITS.MAX_MODE_LENGTH },
              kind: { kind: 'enum', values: AGENT_KINDS },
              title: { kind: 'string', min: 1, max: 128 },
              fields: { kind: 'objectArray', maxItems: 32, fields: AGENT_SPEC_FIELD_SPEC },
            },
          },
        },
      },
    },
  },
  'agent:init_list': {
    fields: {
      agents: { kind: 'objectArray', maxItems: LIMITS.MAX_AGENTS, fields: AGENT_SPEC },
    },
  },
  'agent:added': { fields: { agent: { kind: 'object', fields: AGENT_SPEC } } },
  'agent:removed': {
    fields: {
      agentId: idSpec,
      reason: { kind: 'enum', values: ['killed', 'exited', 'gone', 'backend_down'], optional: true },
    },
  },
  'agent:updated': {
    fields: {
      agentId: idSpec,
      patch: {
        kind: 'object',
        fields: {
          name: { kind: 'string', min: 1, max: LIMITS.MAX_NAME_LENGTH, optional: true },
          tags: TAGS_SPEC,
          group: GROUP_SPEC,
          meta: META_SPEC,
          capabilities: { kind: 'enumList', values: AGENT_CAPABILITIES, maxItems: 64, optional: true },
        },
      },
    },
  },
  'agent:status_change': {
    fields: {
      agentId: idSpec,
      status: statusSpec,
      reason: { kind: 'string', min: 0, max: 256, optional: true },
      exitCode: { kind: 'integer', min: -2147483648, max: 2147483647, optional: true },
    },
  },
  'agent:output': {
    fields: {
      agentId: idSpec,
      data: OUTPUT_DATA,
      seq: { kind: 'integer', min: 1, max: Number.MAX_SAFE_INTEGER, optional: true },
      replay: { kind: 'boolean', optional: true },
    },
  },
  'agent:gap': {
    fields: { agentId: idSpec, fromSeq: positiveInt, toSeq: positiveInt },
    rules: [{ kind: 'gte', field: 'toSeq', other: 'fromSeq' }],
  },
  'agent:history_chunk': {
    fields: {
      agentId: idSpec,
      chunks: {
        kind: 'objectArray',
        maxItems: 1000,
        fields: { seq: positiveInt, ts: { kind: 'number' }, data: OUTPUT_DATA },
      },
      hasMore: { kind: 'boolean' },
      reqId: reqIdSpec,
    },
  },
  'agent:ack': {
    fields: {
      reqId: idSpec,
      op: { kind: 'enum', values: ['create', 'kill', 'update', 'broadcast'] },
      ok: { kind: 'literal', value: true },
      agent: { kind: 'object', fields: AGENT_SPEC, optional: true },
      results: {
        kind: 'objectArray',
        maxItems: LIMITS.MAX_BROADCAST_TARGETS,
        optional: true,
        fields: {
          agentId: idSpec,
          status: { kind: 'enum', values: ['sent', 'failed', 'offline', 'unsupported'] },
          code: { ...errorCodeSpec, optional: true },
          message: { kind: 'string', min: 0, max: 512, optional: true },
        },
      },
    },
  },
  'agent:error': {
    fields: {
      reqId: reqIdSpec,
      agentId: { ...idSpec, optional: true },
      code: errorCodeSpec,
      message: { kind: 'string', min: 0, max: 1024 },
      retryable: { kind: 'boolean' },
      detail: { kind: 'json', maxDepth: JSON_MAX_DEPTH, maxChars: JSON_MAX_CHARS, optional: true },
    },
  },
  'agent:meta': {
    fields: {
      agentId: idSpec,
      scope: { kind: 'string', min: 1, max: 32 },
      data: { kind: 'byTag', tag: 'scope', variants: META_VARIANTS },
    },
  },
  'agent:gate': {
    fields: {
      agentId: idSpec,
      gateId: idSpec,
      prompt: { kind: 'string', min: 0, max: 4096 },
      expiresAt: { kind: 'number', optional: true },
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
      return { ok: false, reason: r.reason ?? 'invalid_field', field: r.field, detail: r.detail };
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
