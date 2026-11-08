import type { Agent } from './agent.js';
import type { ErrorCode } from './errors.js';
import { ERROR_CODES } from './errors.js';
import { LIMITS } from './limits.js';
import { hasOwn, isPlainObjectLike, validateObject } from './fieldspec.js';
import type { FieldSpec, MessageSpec, ObjectSpec } from './fieldspec.js';
import { AGENT_SPEC } from './validate.js';
import type { ParseFailureReason } from './validate.js';

// ---------------------------------------------------------------------------
// Types (contract spec section 7)
// ---------------------------------------------------------------------------

export interface LogLine {
  agentId: string;
  seq: number;
  line: number;
  ts: number;
  text: string;
}

export interface SearchHit extends LogLine {
  matchIndex: number;
  matchLength: number;
  before?: string[];
  after?: string[];
}

export interface HealthBody {
  ok: true;
  contract: number;
  epoch: string;
  backends: Array<{ id: string; up: boolean }>;
  /** Integer count of agents, matching legacy `/health`; omitted when unauthenticated and auth is required. */
  agents?: number;
}
export interface AgentsBody {
  ok: true;
  agents: Agent[];
}
export interface AgentBody {
  ok: true;
  agent: Agent;
}
export interface OkBody {
  ok: true;
}
export interface LogsBody {
  ok: true;
  lines: LogLine[];
  hasMore: boolean;
}
export interface SearchBody {
  ok: true;
  results: SearchHit[];
  nextCursor?: string;
  truncated?: boolean;
}
export interface ErrorBody {
  ok: false;
  error: { code: ErrorCode; message: string; retryable: boolean; detail?: unknown };
}

export interface HttpBodies {
  health: HealthBody;
  agents: AgentsBody;
  agent: AgentBody;
  ok: OkBody;
  logs: LogsBody;
  search: SearchBody;
  error: ErrorBody;
}
export type HttpKind = keyof HttpBodies;

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const idSpec: FieldSpec = { kind: 'string', min: 1, max: LIMITS.MAX_ID_LENGTH };
const okTrue: FieldSpec = { kind: 'literal', value: true };
const textSpec: FieldSpec = { kind: 'string', min: 0, max: LIMITS.MAX_FRAME_BYTES, maxBytes: LIMITS.MAX_FRAME_BYTES };
const positiveInt: FieldSpec = { kind: 'integer', min: 1, max: Number.MAX_SAFE_INTEGER };
const nonNegativeInt: FieldSpec = { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER };

const LOG_LINE: ObjectSpec = {
  agentId: idSpec,
  seq: positiveInt,
  line: nonNegativeInt,
  ts: { kind: 'number' },
  text: textSpec,
};

const SEARCH_HIT: ObjectSpec = {
  ...LOG_LINE,
  matchIndex: nonNegativeInt,
  matchLength: nonNegativeInt,
  before: { kind: 'stringArray', minItems: 0, maxItems: 5, item: textSpec, optional: true },
  after: { kind: 'stringArray', minItems: 0, maxItems: 5, item: textSpec, optional: true },
};

export const HTTP_TABLE = {
  health: {
    fields: {
      ok: okTrue,
      contract: positiveInt,
      epoch: { kind: 'string', min: 1, max: 128 },
      backends: {
        kind: 'objectArray',
        maxItems: 16,
        fields: { id: idSpec, up: { kind: 'boolean' } },
      },
      agents: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER, optional: true },
    },
  },
  agents: {
    fields: {
      ok: okTrue,
      agents: { kind: 'objectArray', maxItems: LIMITS.MAX_AGENTS, fields: AGENT_SPEC },
    },
  },
  agent: { fields: { ok: okTrue, agent: { kind: 'object', fields: AGENT_SPEC } } },
  ok: { fields: { ok: okTrue } },
  logs: {
    fields: {
      ok: okTrue,
      lines: { kind: 'objectArray', maxItems: 2000, fields: LOG_LINE },
      hasMore: { kind: 'boolean' },
    },
  },
  search: {
    fields: {
      ok: okTrue,
      results: { kind: 'objectArray', maxItems: 1000, fields: SEARCH_HIT },
      nextCursor: { kind: 'string', min: 1, max: 512, optional: true },
      truncated: { kind: 'boolean', optional: true },
    },
  },
  error: {
    fields: {
      ok: { kind: 'literal', value: false },
      error: {
        kind: 'object',
        fields: {
          code: { kind: 'enum', values: ERROR_CODES },
          message: { kind: 'string', min: 0, max: 1024 },
          retryable: { kind: 'boolean' },
          detail: { kind: 'json', maxDepth: 8, maxChars: 65536, optional: true },
        },
      },
    },
  },
} as const satisfies Record<HttpKind, MessageSpec>;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export type HttpParseResult<K extends HttpKind> =
  | { ok: true; body: HttpBodies[K] }
  | { ok: false; reason: ParseFailureReason; field?: string; detail?: string };

/** Validates an untrusted HTTP response body. Never throws; strips unknown fields. */
export function parseHttpBody<K extends HttpKind>(kind: K, input: unknown): HttpParseResult<K> {
  try {
    if (typeof kind !== 'string' || !hasOwn(HTTP_TABLE, kind)) {
      return { ok: false, reason: 'unknown_type', field: 'kind', detail: 'unrecognised body kind' };
    }
    if (!isPlainObjectLike(input)) {
      return { ok: false, reason: 'not_object', detail: 'body must be an object' };
    }
    const r = validateObject(HTTP_TABLE[kind].fields, input, '');
    if (!r.ok) return { ok: false, reason: r.reason ?? 'invalid_field', field: r.field, detail: r.detail };
    return { ok: true, body: r.value as HttpBodies[K] };
  } catch {
    return { ok: false, reason: 'invalid_field', detail: 'input could not be read safely' };
  }
}

/** Cross-source dedupe key for merging server hits with local ring-buffer hits. */
export function hitKey(hit: Pick<LogLine, 'agentId' | 'seq' | 'line'>): string {
  return `${hit.agentId}:${hit.seq}:${hit.line}`;
}
