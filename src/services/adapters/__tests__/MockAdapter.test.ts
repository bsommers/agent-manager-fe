import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockAdapter } from '../MockAdapter';
import type { WSMessageServer } from '../../wsProtocol';

describe('MockAdapter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('connect reports open immediately with demo mode', () => {
    const a = new MockAdapter();
    const states: string[] = [];
    a.onState((s) => states.push(s.state));
    a.connect();
    expect(a.mode).toBe('demo');
    expect(states).toEqual(['open']);
    expect(a.getSnapshot().state).toBe('open');
  });

  it('produces no output before a send or startMockStream', () => {
    const a = new MockAdapter();
    const l = vi.fn();
    a.onMessage(l);
    a.connect();
    vi.advanceTimersByTime(60000);
    expect(l).not.toHaveBeenCalled();
  });

  it('agent:input yields one agent:output', () => {
    const a = new MockAdapter();
    const got: WSMessageServer[] = [];
    a.onMessage((m) => got.push(m));
    a.send({ type: 'agent:input', agentId: 'm1', data: 'help' });
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('agent:output');
  });

  it('agent:broadcast yields one output per target', () => {
    const a = new MockAdapter();
    const got: WSMessageServer[] = [];
    a.onMessage((m) => got.push(m));
    a.send({ type: 'agent:broadcast', targetAgentIds: ['a', 'b', 'c'], data: 'help' } as never);
    expect(got).toHaveLength(3);
  });

  it('startMockStream emits banner then heartbeat every 15 s until stopped', () => {
    const a = new MockAdapter();
    const got: WSMessageServer[] = [];
    a.onMessage((m) => got.push(m));
    a.startMockStream('x', 'X', 'tmux', 'h');
    expect(got).toHaveLength(1);
    vi.advanceTimersByTime(15000);
    expect(got).toHaveLength(2);
    vi.advanceTimersByTime(15000);
    expect(got).toHaveLength(3);
    a.stopMockStream('x');
    vi.advanceTimersByTime(60000);
    expect(got).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
