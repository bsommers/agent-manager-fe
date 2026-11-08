// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_TABLE,
  LIMITS,
  OPERATIONS,
  UNCATALOGUED_CLIENT_MESSAGES,
  UNCATALOGUED_HTTP_ROUTES,
  checkSurfaceCoverage,
  clientRowFor,
  describeSurface,
  diffSurface,
  listHttpRoutes,
  listMcpTools,
  listOperations,
  operationForClientMessage,
  parseClientMessage,
  surfaceIdentities,
} from '../index.js';
import type { OperationName, PaletteOperationName, Surface } from '../index.js';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const NAMES = Object.keys(OPERATIONS) as OperationName[];
const ops = listOperations();

describe('operations catalog: shape', () => {
  it('holds exactly the twelve operations', () => {
    expect([...NAMES].sort()).toEqual(
      [
        'agent.approve',
        'agent.broadcast',
        'agent.close',
        'agent.create',
        'agent.history',
        'agent.input',
        'agent.kill',
        'agent.list',
        'agent.logs',
        'agent.resize',
        'agent.update',
        'search.query',
      ].sort(),
    );
  });

  it('agent.create has the agent:create shape and bindings', () => {
    const op = OPERATIONS['agent.create'];
    expect(Object.keys(op.params)).toEqual(['name', 'mode', 'targetHost', 'initialCmd', 'backend', 'params', 'reqId']);
    expect(op.requires).toEqual({});
    expect(op.ws).toEqual({ type: 'agent:create' });
    expect(op.http).toMatchObject({ method: 'POST', path: '/api/agents', status: 201, input: 'body' });
    expect(op.http).toMatchObject({ headerParams: { 'Idempotency-Key': 'reqId' } });
    expect(op.mcp).toEqual({ tool: 'agent_create' });
    expect(op.palette).toEqual({ id: 'agent.new' });
  });

  it('every none carries a non-empty reason', () => {
    for (const [name, op] of ops) {
      for (const key of ['ws', 'http', 'mcp', 'palette'] as const) {
        const b = op[key] as Record<string, unknown>;
        if ('none' in b) expect(typeof b.none === 'string' && b.none.length > 0, `${name}.${key}`).toBe(true);
      }
    }
  });

  it('pins the destructive set to exactly agent.kill', () => {
    expect(ops.filter(([, o]) => o.destructive).map(([n]) => n)).toEqual(['agent.kill']);
    const kill = OPERATIONS['agent.kill'];
    expect(kill.confirmParam).toBe('confirm');
    expect(kill.ws).toMatchObject({ type: 'agent:kill', when: { field: 'killSession', is: true } });
    expect('none' in kill.palette).toBe(true);
    expect('none' in kill.http).toBe(true);
    expect(OPERATIONS['agent.close'].destructive).toBe(false);
    expect(OPERATIONS['agent.close'].ws).toMatchObject({ type: 'agent:kill', when: { field: 'killSession', is: false } });
    expect(OPERATIONS['agent.close'].http).toMatchObject({ method: 'DELETE', path: '/api/agents/:id' });
  });

  it('destructive and read-only invariants hold', () => {
    for (const [name, op] of ops) {
      if (op.destructive) {
        expect(op.confirmParam, name).toBeDefined();
        expect(op.params[op.confirmParam as string]?.kind, name).toBe('boolean');
        expect(op.readOnly, name).toBe(false);
        expect('none' in op.palette, name).toBe(true);
        expect('none' in op.http, name).toBe(true);
      } else {
        expect(op.confirmParam, name).toBeUndefined();
      }
      if ('method' in op.http) {
        expect(op.readOnly, name).toBe(op.http.method === 'GET');
        if (op.http.status === 201) expect(op.http.method, name).toBe('POST');
      }
    }
  });

  it('search.query and agent.logs params follow contract section 7', () => {
    const q = OPERATIONS['search.query'].params;
    expect(q.q).toMatchObject({ kind: 'string', min: 1, max: LIMITS.MAX_SEARCH_QUERY_LENGTH });
    expect(q.context).toMatchObject({ kind: 'integer', min: 0, max: 5, optional: true });
    expect(q.limit).toMatchObject({ kind: 'integer', min: 1, max: 1000, optional: true });
    expect(q.agentId).toMatchObject({ kind: 'stringArray', maxItems: LIMITS.MAX_BROADCAST_TARGETS });
    expect(OPERATIONS['agent.logs'].params.limit).toMatchObject({ kind: 'integer', min: 1, max: 2000 });
  });
});

describe('operations catalog: WS rows', () => {
  it('clientRowFor throws for a type no operation owns', () => {
    expect(() => clientRowFor('ping')).toThrow();
    expect(() => clientRowFor('hello')).toThrow();
  });

  it('exactly one owner per message type; sharers have a when clause and a subset of identical specs', () => {
    const byType = new Map<string, Array<[string, (typeof ops)[number][1]]>>();
    for (const [name, op] of ops) {
      if ('type' in op.ws) byType.set(op.ws.type, [...(byType.get(op.ws.type) ?? []), [name, op]]);
    }
    for (const [type, list] of byType) {
      const owners = list.length === 1 ? list : list.filter(([, o]) => 'row' in o.ws && o.ws.row === true);
      expect(owners.length, type).toBe(1);
      const owner = owners[0][1];
      for (const [name, op] of list) {
        if (op === owner) continue;
        expect('when' in op.ws, name).toBe(true);
        for (const key of Object.keys(op.params)) expect(op.params[key], `${name}.${key}`).toBe(owner.params[key]);
      }
    }
  });

  it('every CLIENT_TABLE row is owned by an operation or exempt, and uses its owner params object', () => {
    for (const type of Object.keys(CLIENT_TABLE)) {
      if ((UNCATALOGUED_CLIENT_MESSAGES as readonly string[]).includes(type)) continue;
      const row = clientRowFor(type as Parameters<typeof clientRowFor>[0]);
      expect((CLIENT_TABLE as Record<string, { fields: unknown }>)[type].fields, type).toBe(row.fields);
    }
    expect([...UNCATALOGUED_CLIENT_MESSAGES]).toEqual(['hello', 'ping']);
  });

  it('operationForClientMessage maps killSession exactly true to agent.kill, else agent.close', () => {
    expect(operationForClientMessage({ type: 'agent:kill', agentId: 'a', killSession: true })).toBe('agent.kill');
    expect(operationForClientMessage({ type: 'agent:kill', agentId: 'a' })).toBe('agent.close');
    expect(operationForClientMessage({ type: 'agent:kill', agentId: 'a', killSession: false })).toBe('agent.close');
    expect(operationForClientMessage({ type: 'hello', contract: 1 })).toBeNull();
    expect(operationForClientMessage({ type: 'ping', t: 1 })).toBeNull();
    expect(operationForClientMessage({ type: 'agent:create', name: 'n', mode: 'tmux', targetHost: 'h' })).toBe('agent.create');
  });

  it('each committed client fixture maps as expected', () => {
    const fixtures = JSON.parse(read('../../fixtures/client.json')) as Array<{ name: string; message: Record<string, unknown> }>;
    const expected: Record<string, string> = {
      kill: 'agent.close',
      'kill-session': 'agent.kill',
      'kill-session-unconfirmed': 'agent.kill',
      'kill-session-false': 'agent.close',
    };
    let seen = 0;
    for (const f of fixtures) {
      const parsed = parseClientMessage(f.message);
      if (!parsed.ok) continue;
      const name = operationForClientMessage(parsed.msg);
      if (parsed.msg.type === 'hello' || parsed.msg.type === 'ping') expect(name, f.name).toBeNull();
      else expect(name, f.name).not.toBeNull();
      if (f.name in expected) {
        expect(name, f.name).toBe(expected[f.name]);
        seen++;
      }
    }
    expect(seen).toBe(4);
  });
});

describe('operations catalog: HTTP routes', () => {
  const routes = listHttpRoutes();

  it('lists sorted unique ids', () => {
    const ids = routes.map((r) => r.id);
    expect(ids).toEqual([...new Set(ids)].sort());
    expect(ids).toEqual(
      ['DELETE /api/agents/:id', 'GET /api/agents', 'GET /api/agents/:id/logs', 'GET /api/search', 'POST /api/agents'].sort(),
    );
  });

  it('path params map to colon segments and existing params', () => {
    for (const r of routes) {
      const op = OPERATIONS[r.operation as OperationName];
      for (const [seg, param] of Object.entries(r.binding.pathParams ?? {})) {
        expect(r.binding.path.split('/'), r.id).toContain(`:${seg}`);
        expect(Object.keys(op.params), r.id).toContain(param);
      }
      for (const param of Object.values(r.binding.headerParams ?? {})) expect(Object.keys(op.params), r.id).toContain(param);
    }
  });

  it('matches contract spec section 7 in both directions', () => {
    const spec = read('../../../../docs/superpowers/specs/2026-11-07-fe-be-contract.md');
    const section = spec.slice(spec.indexOf('## 7. HTTP API'), spec.indexOf('## 8. Limits'));
    const listed = [...section.matchAll(/^\| `(GET|POST|DELETE|PUT|PATCH) (\/\S*)` \|/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(listed.length).toBeGreaterThanOrEqual(7);
    const r = checkSurfaceCoverage('http', listed, UNCATALOGUED_HTTP_ROUTES);
    expect(r).toEqual({ missing: [], unknown: [], duplicate: [] });
    expect([...UNCATALOGUED_HTTP_ROUTES].sort()).toEqual(['GET /api/health', 'GET /health']);
  });
});

describe('operations catalog: MCP tools', () => {
  const tools = listMcpTools();

  it('derives tools with annotations from the flags', () => {
    expect(tools.map((t) => t.name)).toEqual([...new Set(tools.map((t) => t.name))]);
    for (const t of tools) {
      const op = OPERATIONS[t.operation as OperationName];
      expect(t.name, t.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(t.annotations).toEqual({ readOnlyHint: op.readOnly, destructiveHint: op.destructive });
      expect(t.description).toBe(op.summary);
      expect(t.params).toBe(op.params);
    }
    expect(tools.find((t) => t.name === 'agent_kill')?.annotations.destructiveHint).toBe(true);
    expect(tools.filter((t) => t.annotations.destructiveHint).length).toBe(1);
  });

  it('operations with mcp none produce no tool', () => {
    const withTool = new Set(tools.map((t) => t.operation));
    for (const [name, op] of ops) expect(withTool.has(name), name).toBe('tool' in op.mcp);
    expect(withTool.has('agent.resize')).toBe(false);
    expect(withTool.has('agent.approve')).toBe(false);
  });
});

describe('contract spec section 4.3 operations table', () => {
  const spec = read('../../../../docs/superpowers/specs/2026-11-07-fe-be-contract.md');
  const start = spec.indexOf('### 4.3 Operations catalog');
  const section = start < 0 ? '' : spec.slice(start, spec.indexOf('## 5.', start));
  const rows = [...section.matchAll(/^\| `([a-z]+\.[a-z]+)` \|(.*)\|\s*$/gm)].map((m) => ({
    name: m[1],
    cells: m[2].split('|').map((c) => c.trim()),
  }));

  it('has a twelve-row table whose operation names equal the OPERATIONS keys', () => {
    expect(start).toBeGreaterThan(-1);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.name).sort()).toEqual([...NAMES].sort());
  });

  it('flags match the catalog: destructive exactly for agent.kill, read-only exactly for the readOnly operations', () => {
    for (const r of rows) {
      const flags = r.cells[r.cells.length - 1];
      const op = OPERATIONS[r.name as OperationName];
      expect(flags.includes('destructive'), `${r.name} destructive`).toBe(op.destructive);
      expect(flags.includes('read-only'), `${r.name} read-only`).toBe(op.readOnly);
    }
    const destructive = rows.filter((r) => r.cells[r.cells.length - 1].includes('destructive')).map((r) => r.name);
    expect(destructive).toEqual(['agent.kill']);
  });

  it('MCP tool and palette cells match the catalog bindings', () => {
    for (const r of rows) {
      const op = OPERATIONS[r.name as OperationName];
      const [, , mcp, palette] = r.cells;
      expect(mcp, `${r.name} mcp`).toBe('tool' in op.mcp ? `\`${op.mcp.tool}\`` : 'none');
      expect(palette, `${r.name} palette`).toBe('id' in op.palette ? `\`${op.palette.id}\`` : 'none');
    }
  });
});

describe('surface coverage', () => {
  it('real WS surface is covered', () => {
    const r = checkSurfaceCoverage('ws', Object.keys(CLIENT_TABLE), UNCATALOGUED_CLIENT_MESSAGES);
    expect(r).toEqual({ missing: [], unknown: [], duplicate: [] });
  });

  it('real MCP surface is covered', () => {
    expect(checkSurfaceCoverage('mcp', tools().map((t) => t.name))).toEqual({ missing: [], unknown: [], duplicate: [] });
  });

  it('synthetic lists: unknown, missing, duplicate and exempt', () => {
    const http = surfaceIdentities('http');
    expect(checkSurfaceCoverage('http', [...http, 'GET /api/nope']).unknown).toEqual(['GET /api/nope']);
    expect(checkSurfaceCoverage('http', http.slice(1)).missing).toEqual([http[0]]);
    expect(checkSurfaceCoverage('http', [...http, http[0]]).duplicate).toEqual([http[0]]);
    expect(checkSurfaceCoverage('http', [...http, 'GET /health'], ['GET /health'])).toEqual({
      missing: [],
      unknown: [],
      duplicate: [],
    });
    expect(checkSurfaceCoverage('mcp', ['agent_list']).missing).toContain('agent_kill');
    expect(checkSurfaceCoverage('ws', ['agent:input', 'agent:nope']).unknown).toEqual(['agent:nope']);
  });

  it('palette identities are exported for the FE', () => {
    expect(surfaceIdentities('palette')).toEqual(['agent.new', 'broadcast.open', 'search.open']);
    const names: PaletteOperationName[] = ['agent.create', 'agent.broadcast', 'search.query'];
    expect(names).toHaveLength(3);
  });
});

function tools() {
  return listMcpTools();
}

describe('describeSurface operations section', () => {
  const ops2 = describeSurface().operations ?? {};

  it('has twelve entries, only agent.kill destructive, summary excluded', () => {
    expect(Object.keys(ops2)).toHaveLength(12);
    expect(Object.entries(ops2).filter(([, o]) => o.destructive).map(([n]) => n)).toEqual(['agent.kill']);
    expect(ops2['agent.kill'].confirmParam).toBe('confirm');
    expect(ops2['agent.create']).not.toHaveProperty('summary');
    expect(ops2['agent.create'].params.name).toMatchObject({ kind: 'string', required: true, trim: true });
    expect(ops2['agent.list'].ws).toBeNull();
    expect(ops2['agent.create'].palette).toEqual({ id: 'agent.new' });
  });
});

describe('diffSurface with the operations section', () => {
  it('a base without operations gives only additive entries', () => {
    const next = describeSurface();
    const prev = JSON.parse(JSON.stringify(next)) as Surface;
    delete prev.operations;
    const d = diffSurface(prev, next);
    expect(d.breaking).toEqual([]);
    expect(d.additive).toContain('operations.agent.create: added');
  });
});
