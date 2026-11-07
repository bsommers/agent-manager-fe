import { describe, it, expect, expectTypeOf } from 'vitest';
import { CONTRACT_VERSION } from '../index.js';
import type { Agent, WSMessageClient, WSMessageServer } from '../index.js';

describe('protocol exports', () => {
  it('exposes CONTRACT_VERSION 1', () => {
    expect(CONTRACT_VERSION).toBe(1);
  });

  it('round-trips client and server messages through JSON', () => {
    const c: WSMessageClient = { type: 'agent:input', agentId: 'a1', data: 'ls\n' };
    const s: WSMessageServer = { type: 'agent:output', agentId: 'a1', data: 'ok' };
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('compiles an Agent literal with all required fields', () => {
    const a: Agent = {
      id: 'a1',
      name: 'one',
      mode: 'tmux',
      targetHost: 'localhost',
      status: 'idle',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: 1,
      lastActivity: 2,
    };
    expectTypeOf(a).toMatchTypeOf<Agent>();
    expect(a.id).toBe('a1');
  });
});
