import type { AgentCapability, GatewayCapability } from './capabilities.js';
import type { FieldSpec, MessageSpec, ObjectSpec, Rule } from './fieldspec.js';
import { LIMITS } from './limits.js';
import type { WSMessageClient } from './messages.js';
import { CLIENT_MODES, GROUP_SPEC, TAGS_SPEC, idSpec, inputData, reqIdSpec, seqSpec } from './specs.js';

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

/** Client messages that are not operations: connection handshake and heartbeat. */
export const UNCATALOGUED_CLIENT_MESSAGES: readonly WSMessageClient['type'][] = ['hello', 'ping'];

/** HTTP routes that are not operations: liveness and health probes. */
export const UNCATALOGUED_HTTP_ROUTES: readonly string[] = ['GET /health', 'GET /api/health'];

// ---------------------------------------------------------------------------
// Param sets. agent.close reuses the agent.kill spec objects (identical references).
// ---------------------------------------------------------------------------

const KILL_PARAMS = {
  agentId: idSpec,
  killSession: { kind: 'boolean', optional: true },
  confirm: { kind: 'boolean', optional: true },
  reqId: reqIdSpec,
} as const satisfies ObjectSpec;

const CLOSE_PARAMS = { agentId: KILL_PARAMS.agentId, reqId: KILL_PARAMS.reqId } as const satisfies ObjectSpec;

const optionalBool: FieldSpec = { kind: 'boolean', optional: true };

export const OPERATIONS = {
  'agent.list': {
    summary: 'List all agents known to the gateway.',
    params: {},
    requires: {},
    readOnly: true,
    destructive: false,
    ws: { none: 'the gateway pushes agent:init_list on connect; there is no client request' },
    http: { method: 'GET', path: '/api/agents', input: 'none', status: 200 },
    mcp: { tool: 'agent_list' },
    palette: { none: 'the agent list is always visible in the UI' },
  },
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
  'agent.close': {
    summary: 'Close an agent and leave its backend session running.',
    params: CLOSE_PARAMS,
    requires: { agent: 'kill' },
    readOnly: false,
    destructive: false,
    ws: { type: 'agent:kill', when: { field: 'killSession', is: false } },
    http: {
      method: 'DELETE',
      path: '/api/agents/:id',
      input: 'none',
      status: 200,
      pathParams: { id: 'agentId' },
    },
    mcp: { tool: 'agent_close' },
    palette: { none: 'closing is done from the agent window, not the palette' },
  },
  'agent.kill': {
    summary: 'Kill an agent and end its backend session (requires explicit confirmation).',
    params: KILL_PARAMS,
    requires: { agent: 'kill' },
    readOnly: false,
    destructive: true,
    confirmParam: 'confirm',
    ws: { type: 'agent:kill', when: { field: 'killSession', is: true }, row: true },
    http: { none: 'contract section 7 defines no confirmation form; Phase 6 adds one additively' },
    mcp: { tool: 'agent_kill' },
    palette: { none: 'destructive operations are never offered in the palette' },
  },
  'agent.update': {
    summary: 'Rename an agent or change its tags or group.',
    params: {
      agentId: idSpec,
      name: {
        kind: 'string',
        min: 1,
        max: LIMITS.MAX_NAME_LENGTH,
        trim: true,
        noControl: true,
        optional: true,
      },
      tags: TAGS_SPEC,
      group: GROUP_SPEC,
      reqId: reqIdSpec,
    },
    rules: [{ kind: 'atLeastOne', fields: ['name', 'tags', 'group'] }],
    requires: {},
    readOnly: false,
    destructive: false,
    ws: { type: 'agent:update' },
    http: { none: 'contract section 7 defines no update route' },
    mcp: { tool: 'agent_update' },
    palette: { none: 'edited from the agent window' },
  },
  'agent.input': {
    summary: 'Send keystrokes or text to an agent terminal.',
    params: { agentId: idSpec, data: inputData },
    requires: { gateway: 'terminal', agent: 'input' },
    readOnly: false,
    destructive: false,
    ws: { type: 'agent:input' },
    http: { none: 'streaming input is WS only' },
    mcp: { tool: 'agent_input' },
    palette: { none: 'typing goes to the focused terminal' },
  },
  'agent.resize': {
    summary: 'Resize an agent terminal.',
    params: {
      agentId: idSpec,
      cols: { kind: 'integer', min: 1, max: 1000 },
      rows: { kind: 'integer', min: 1, max: 1000 },
    },
    requires: { gateway: 'terminal', agent: 'resize' },
    readOnly: false,
    destructive: false,
    ws: { type: 'agent:resize' },
    http: { none: 'resize follows the live terminal and is WS only' },
    mcp: { none: 'a headless client has no viewport to resize' },
    palette: { none: 'driven by the terminal viewport' },
  },
  'agent.broadcast': {
    summary: 'Send the same input to several agents.',
    params: {
      targetAgentIds: {
        kind: 'stringArray',
        minItems: 1,
        maxItems: LIMITS.MAX_BROADCAST_TARGETS,
        item: idSpec,
      },
      data: inputData,
      reqId: reqIdSpec,
    },
    requires: { gateway: 'broadcast', agent: 'broadcast' },
    readOnly: false,
    destructive: false,
    ws: { type: 'agent:broadcast' },
    http: { none: 'contract section 7 defines no broadcast route' },
    mcp: { tool: 'agent_broadcast' },
    palette: { id: 'broadcast.open' },
  },
  'agent.history': {
    summary: 'Fetch a page of recorded terminal output over the WebSocket.',
    params: {
      agentId: idSpec,
      beforeSeq: seqSpec,
      afterSeq: seqSpec,
      limit: { kind: 'integer', min: 1, max: 1000, optional: true },
      reqId: reqIdSpec,
    },
    rules: [{ kind: 'exactlyOne', fields: ['beforeSeq', 'afterSeq'] }],
    requires: { gateway: 'history', agent: 'history' },
    readOnly: true,
    destructive: false,
    ws: { type: 'agent:history' },
    http: { none: 'HTTP serves the line view through agent.logs' },
    mcp: { none: 'MCP reads output through agent_logs' },
    palette: { none: 'scrolling triggers history loads' },
  },
  'agent.logs': {
    summary: 'Read recorded output of an agent as lines.',
    params: {
      agentId: idSpec,
      beforeSeq: seqSpec,
      afterSeq: seqSpec,
      limit: { kind: 'integer', min: 1, max: 2000, optional: true },
    },
    requires: { gateway: 'history' },
    readOnly: true,
    destructive: false,
    ws: { none: 'the WS equivalent is agent.history' },
    http: {
      method: 'GET',
      path: '/api/agents/:id/logs',
      input: 'query',
      status: 200,
      pathParams: { id: 'agentId' },
    },
    mcp: { tool: 'agent_logs' },
    palette: { none: 'logs are read from the agent window' },
  },
  'agent.approve': {
    summary: 'Approve or deny a pending gate of an agent.',
    params: {
      agentId: idSpec,
      gateId: idSpec,
      decision: { kind: 'enum', values: ['approve', 'deny'] },
      reqId: reqIdSpec,
    },
    requires: { gateway: 'gates', agent: 'approve' },
    readOnly: false,
    destructive: false,
    ws: { type: 'agent:approve' },
    http: { none: 'contract section 7 defines no approval route' },
    mcp: { none: 'approval is a human decision, not exposed to tool callers' },
    palette: { none: 'approval happens on the gate prompt' },
  },
  'search.query': {
    summary: 'Search recorded output across agents.',
    params: {
      q: { kind: 'string', min: 1, max: LIMITS.MAX_SEARCH_QUERY_LENGTH },
      regex: optionalBool,
      caseSensitive: optionalBool,
      wholeWord: optionalBool,
      // The contract does not bound the agentId list; the broadcast target limit is the smallest consistent
      // value. Phase 16 may raise it additively.
      agentId: {
        kind: 'stringArray',
        minItems: 1,
        maxItems: LIMITS.MAX_BROADCAST_TARGETS,
        item: idSpec,
        optional: true,
      },
      from: { kind: 'number', optional: true },
      to: { kind: 'number', optional: true },
      context: { kind: 'integer', min: 0, max: 5, optional: true },
      limit: { kind: 'integer', min: 1, max: 1000, optional: true },
      cursor: { kind: 'string', min: 1, max: 512, optional: true },
    },
    requires: { gateway: 'search' },
    readOnly: true,
    destructive: false,
    ws: { none: 'search is HTTP only so it is cancellable and cursor-paginated (contract section 7)' },
    http: { method: 'GET', path: '/api/search', input: 'query', status: 200 },
    mcp: { tool: 'search_output' },
    palette: { id: 'search.open' },
  },
} as const satisfies Record<string, OperationSpec>;

export type OperationName = keyof typeof OPERATIONS;

/** Operations offered in the command palette; the FE keys its command record by this union. */
export type PaletteOperationName = {
  [K in OperationName]: (typeof OPERATIONS)[K]['palette'] extends { readonly id: string } ? K : never;
}[OperationName];

export type CatalogSurface = 'ws' | 'http' | 'mcp' | 'palette';

const CATALOG: Readonly<Record<OperationName, OperationSpec>> = OPERATIONS;
const NAMES = Object.keys(CATALOG) as OperationName[];

const isBound = <T extends object>(b: T | NoBinding): b is T => !('none' in b);

export function listOperations(): Array<[OperationName, OperationSpec]> {
  return NAMES.map((n) => [n, CATALOG[n]]);
}

function wsOperations(type: string): OperationName[] {
  return NAMES.filter((n) => {
    const ws = CATALOG[n].ws;
    return isBound(ws) && ws.type === type;
  });
}

/** The validator row of a client message type, taken from the operation that owns it. Throws if none does. */
export function clientRowFor(type: WSMessageClient['type']): MessageSpec {
  const bound = wsOperations(type);
  const owner =
    bound.length === 1
      ? CATALOG[bound[0]]
      : bound.map((n) => CATALOG[n]).find((op) => isBound(op.ws) && op.ws.row === true);
  if (owner === undefined) throw new Error(`operations: no operation owns the WS message type ${type}`);
  return owner.rules === undefined ? { fields: owner.params } : { fields: owner.params, rules: owner.rules };
}

/**
 * The operation a parsed client message performs, or null for hello and ping. agent:kill with killSession
 * exactly true is agent.kill; anything else is agent.close. The confirm check is gateway policy, not parsing.
 */
export function operationForClientMessage(msg: { type: string } & Record<string, unknown>): OperationName | null {
  const candidates = wsOperations(msg.type);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  for (const n of candidates) {
    const ws = CATALOG[n].ws;
    if (!isBound(ws) || ws.when === undefined) continue;
    const value = msg[ws.when.field];
    if (ws.when.is ? value === true : value !== true) return n;
  }
  return null;
}

export interface HttpRoute {
  id: string;
  operation: OperationName;
  binding: HttpBinding;
}

/** HTTP routes derived from the catalog, sorted by id (METHOD plus space plus path). */
export function listHttpRoutes(): HttpRoute[] {
  const routes: HttpRoute[] = [];
  for (const n of NAMES) {
    const http = CATALOG[n].http;
    if (isBound(http)) routes.push({ id: `${http.method} ${http.path}`, operation: n, binding: http });
  }
  return routes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface McpTool {
  name: string;
  operation: OperationName;
  description: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  params: ObjectSpec;
}

/** MCP tool list derived from the catalog, sorted by tool name. */
export function listMcpTools(): McpTool[] {
  const tools: McpTool[] = [];
  for (const n of NAMES) {
    const op = CATALOG[n];
    if (!isBound(op.mcp)) continue;
    tools.push({
      name: op.mcp.tool,
      operation: n,
      description: op.summary,
      annotations: { readOnlyHint: op.readOnly, destructiveHint: op.destructive },
      params: op.params,
    });
  }
  return tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The sorted unique identities the catalog expects on a surface: WS types, route ids, tool names, palette ids. */
export function surfaceIdentities(surface: CatalogSurface): string[] {
  const ids = new Set<string>();
  for (const n of NAMES) {
    const op = CATALOG[n];
    if (surface === 'ws' && isBound(op.ws)) ids.add(op.ws.type);
    else if (surface === 'http' && isBound(op.http)) ids.add(`${op.http.method} ${op.http.path}`);
    else if (surface === 'mcp' && isBound(op.mcp)) ids.add(op.mcp.tool);
    else if (surface === 'palette' && isBound(op.palette)) ids.add(op.palette.id);
  }
  return [...ids].sort();
}

export interface CoverageResult {
  /** Expected by the catalog but not listed. */
  missing: string[];
  /** Listed but not in the catalog. */
  unknown: string[];
  /** Listed more than once. */
  duplicate: string[];
}

/**
 * Compares the identities a surface lists against the catalog, after removing the exempt ones. All three
 * results are empty exactly when the two sets are equal and nothing repeats.
 */
export function checkSurfaceCoverage(
  surface: CatalogSurface,
  listed: readonly string[],
  exempt: readonly string[] = [],
): CoverageResult {
  const skip = new Set(exempt);
  const mine = listed.filter((id) => !skip.has(id));
  const expected = new Set(surfaceIdentities(surface));
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of mine) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return {
    missing: [...expected].filter((id) => !seen.has(id)).sort(),
    unknown: [...seen].filter((id) => !expected.has(id)).sort(),
    duplicate: [...dup].sort(),
  };
}
