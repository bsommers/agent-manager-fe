import type { AgentCapability, GatewayCapability } from './capabilities.js';
import type { MessageSpec, ObjectSpec, Rule } from './fieldspec.js';
import { LIMITS } from './limits.js';
import type { WSMessageClient } from './messages.js';
import { CLIENT_MODES, reqIdSpec } from './specs.js';

// ---------------------------------------------------------------------------
// Operations catalog: one entry per thing a client can ask the gateway to do.
// WS validator rows, the HTTP route list, the MCP tool list and the palette
// identities derive from it. This module never imports validate.ts.
// ---------------------------------------------------------------------------

/** A surface the operation deliberately does not have, with the reason. Never omitted. */
export type NoBinding = { readonly none: string };

/**
 * WS binding. `when` selects between operations sharing one message type: `is: true` matches only that exact
 * value, `is: false` matches absent or any non-true value. `row: true` marks the operation that owns the
 * validator row of a shared message type.
 */
export interface WsBinding {
  readonly type: WSMessageClient['type'];
  readonly when?: { readonly field: string; readonly is: boolean };
  readonly row?: true;
}

export interface HttpBinding {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly input: 'none' | 'body' | 'query';
  readonly status: 200 | 201;
  /** Path segment name -> param name. */
  readonly pathParams?: Readonly<Record<string, string>>;
  /** Header name -> param name. */
  readonly headerParams?: Readonly<Record<string, string>>;
}

export interface McpBinding {
  readonly tool: string;
}

/** The palette command id only; titles, hints and other UI strings stay in the FE. */
export interface PaletteBinding {
  readonly id: string;
}

export interface OperationSpec {
  readonly summary: string;
  readonly params: ObjectSpec;
  readonly rules?: readonly Rule[];
  readonly requires: { readonly gateway?: GatewayCapability; readonly agent?: AgentCapability };
  readonly readOnly: boolean;
  readonly destructive: boolean;
  /** Boolean param the gateway requires to be exactly true before it runs a destructive operation (Phase 6). */
  readonly confirmParam?: string;
  readonly ws: WsBinding | NoBinding;
  readonly http: HttpBinding | NoBinding;
  readonly mcp: McpBinding | NoBinding;
  readonly palette: PaletteBinding | NoBinding;
}

/** Client messages that are not operations: handshake and heartbeat. */
export const UNCATALOGUED_CLIENT_MESSAGES: readonly WSMessageClient['type'][] = ['hello', 'ping'];

export const OPERATIONS = {
  'agent.create': {
    summary: 'Create a new agent (terminal session) on a backend.',
    params: {
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
    requires: {},
    readOnly: false,
    destructive: false,
    ws: { type: 'agent:create' },
    http: {
      method: 'POST',
      path: '/api/agents',
      input: 'body',
      status: 201,
      headerParams: { 'Idempotency-Key': 'reqId' },
    },
    mcp: { tool: 'agent_create' },
    palette: { id: 'agent.new' },
  },
} as const satisfies Record<string, OperationSpec>;

export type OperationName = keyof typeof OPERATIONS;

const ALL: Readonly<Record<string, OperationSpec>> = OPERATIONS;

const isBound = <T extends object>(b: T | NoBinding): b is T => !('none' in b);

/** The validator row of a client message type, taken from the operation that owns it. Throws if none does. */
export function clientRowFor(type: WSMessageClient['type']): MessageSpec {
  const bound = Object.values(ALL).filter((op) => isBound(op.ws) && op.ws.type === type);
  const owner = bound.length === 1 ? bound[0] : bound.find((op) => isBound(op.ws) && op.ws.row === true);
  if (owner === undefined) throw new Error(`operations: no operation owns the WS message type ${type}`);
  return owner.rules === undefined ? { fields: owner.params } : { fields: owner.params, rules: owner.rules };
}
