// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CLIENT_TABLE, describeSurface, diffSurface } from '../index.js';
import { OPERATIONS, clientRowFor } from '../operations.js';
import type { Surface } from '../index.js';

describe('operations catalog: agent.create tracer', () => {
  const op = OPERATIONS['agent.create'];

  it('has the agent:create shape and bindings', () => {
    expect(Object.keys(op.params)).toEqual(['name', 'mode', 'targetHost', 'initialCmd', 'backend', 'params', 'reqId']);
    expect(op.requires).toEqual({});
    expect(op.readOnly).toBe(false);
    expect(op.destructive).toBe(false);
    expect(op.ws).toEqual({ type: 'agent:create' });
    expect(op.http).toEqual({
      method: 'POST',
      path: '/api/agents',
      input: 'body',
      status: 201,
      headerParams: { 'Idempotency-Key': 'reqId' },
    });
    expect(op.mcp).toEqual({ tool: 'agent_create' });
    expect(op.palette).toEqual({ id: 'agent.new' });
  });

  it('the validator row is built from the catalog entry (same fields object)', () => {
    expect(CLIENT_TABLE['agent:create'].fields).toBe(op.params);
    expect(clientRowFor('agent:create').fields).toBe(op.params);
  });

  it('clientRowFor throws for a type no operation owns', () => {
    expect(() => clientRowFor('ping' as never)).toThrow();
  });
});

describe('describeSurface operations section', () => {
  it('describes agent.create', () => {
    const entry = describeSurface().operations?.['agent.create'];
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      destructive: false,
      readOnly: false,
      requires: {},
      rules: [],
      ws: { type: 'agent:create' },
      http: { method: 'POST', path: '/api/agents', status: 201 },
      mcp: { tool: 'agent_create' },
      palette: { id: 'agent.new' },
    });
    expect(entry?.params.name).toMatchObject({ kind: 'string', required: true, trim: true });
    expect(entry).not.toHaveProperty('summary');
  });
});

describe('diffSurface with the operations section', () => {
  it('a base without operations gives only an additive entry', () => {
    const next = describeSurface();
    const prev = JSON.parse(JSON.stringify(next)) as Surface;
    delete prev.operations;
    const d = diffSurface(prev, next);
    expect(d.breaking).toEqual([]);
    expect(d.additive).toContain('operations.agent.create: added');
  });
});
