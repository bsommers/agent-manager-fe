import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSocketService } from '../agentSocket';
import { MockAdapter } from '../adapters/MockAdapter';
import {
  INITIAL_SNAPSHOT,
  type BackendAdapter,
  type ConnSnapshot,
  type MessageListener,
  type StateListener,
} from '../adapters/types';
import { useConnectionStore } from '../../store/connectionStore';
import type { WSMessageClient, WSMessageServer } from '../wsProtocol';

class FakeLiveAdapter implements BackendAdapter {
  readonly id = 'fake';
  readonly mode = 'live' as const;
  snapshot: ConnSnapshot = { ...INITIAL_SNAPSHOT };
  stateL = new Set<StateListener>();
  msgL = new Set<MessageListener>();
  deliver = false;
  sent: WSMessageClient[] = [];
  connect = vi.fn();
  disconnect = vi.fn();
  reconnectNow = vi.fn();
  getSnapshot() {
    return this.snapshot;
  }
  onState(l: StateListener) {
    this.stateL.add(l);
    return () => this.stateL.delete(l);
  }
  onMessage(l: MessageListener) {
    this.msgL.add(l);
    return () => this.msgL.delete(l);
  }
  send(m: WSMessageClient) {
    this.sent.push(m);
    return this.deliver;
  }
  emitState(patch: Partial<ConnSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.stateL.forEach((l) => l(this.snapshot));
  }
  emitMessage(m: WSMessageServer) {
    this.msgL.forEach((l) => l(m));
  }
}

describe('AgentSocketService over a MockAdapter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('should allow listeners to subscribe and receive notifications', () => {
    const svc = new AgentSocketService(new MockAdapter());
    const l = vi.fn();
    const unsubscribe = svc.subscribe(l);
    svc.startMockStream('test-agent-1', 'Test Agent', 'tmux', 'localhost:test');
    expect(l).toHaveBeenCalled();
    const first = l.mock.calls[0][0] as WSMessageServer;
    expect(first.type).toBe('agent:output');
    if (first.type === 'agent:output') expect(first.agentId).toBe('test-agent-1');
    unsubscribe();
    svc.stopMockStream('test-agent-1');
    svc.dispose();
  });

  it('should trigger periodic mock heartbeat logs until stopped', () => {
    const svc = new AgentSocketService(new MockAdapter());
    const got: WSMessageServer[] = [];
    const unsubscribe = svc.subscribe((m) => got.push(m));
    svc.startMockStream('test-agent-hb', 'HB Agent', 'tmux', 'localhost:hb');
    expect(got.length).toBe(1);
    vi.advanceTimersByTime(15000);
    expect(got.length).toBeGreaterThanOrEqual(2);
    svc.stopMockStream('test-agent-hb');
    const before = got.length;
    vi.advanceTimersByTime(30000);
    expect(got.length).toBe(before);
    unsubscribe();
    svc.dispose();
  });

  it('should handle agent:input messages through the demo adapter', () => {
    const svc = new AgentSocketService(new MockAdapter());
    const got: WSMessageServer[] = [];
    svc.subscribe((m) => got.push(m));
    svc.send({ type: 'agent:input', agentId: 'test-agent-2', data: 'help' });
    expect(got.length).toBe(1);
    if (got[0].type === 'agent:output') expect(got[0].data).toContain('Available mock commands');
    svc.dispose();
  });
});

describe('AgentSocketService over a live adapter', () => {
  beforeEach(() => useConnectionStore.getState().reset());

  it('connects on construction and publishes mode and snapshot to the store', () => {
    const a = new FakeLiveAdapter();
    new AgentSocketService(a);
    expect(a.connect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().mode).toBe('live');
    a.emitState({ state: 'open', lastConnectedAt: 5 });
    expect(useConnectionStore.getState()).toMatchObject({ state: 'open', lastConnectedAt: 5 });
    a.emitState({ state: 'reconnecting', attempt: 2 });
    expect(useConnectionStore.getState()).toMatchObject({ state: 'reconnecting', attempt: 2 });
  });

  it('delivers adapter messages, supports unsubscribe and notify', () => {
    const a = new FakeLiveAdapter();
    const svc = new AgentSocketService(a);
    const l = vi.fn();
    const off = svc.subscribe(l);
    a.emitMessage({ type: 'agent:output', agentId: '1', data: 'x' });
    expect(l).toHaveBeenCalledTimes(1);
    (svc as unknown as { notify: (m: WSMessageServer) => void }).notify({
      type: 'agent:output', agentId: '1', data: 'y',
    });
    expect(l).toHaveBeenCalledTimes(2);
    off();
    a.emitMessage({ type: 'agent:output', agentId: '1', data: 'z' });
    expect(l).toHaveBeenCalledTimes(2);
  });

  it('warns once when not delivered, never simulates output, and re-arms after open', () => {
    const a = new FakeLiveAdapter();
    const svc = new AgentSocketService(a);
    const l = vi.fn();
    svc.subscribe(l);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg: WSMessageClient = { type: 'agent:input', agentId: '1', data: 'help' };
    expect(svc.send(msg)).toBe(false);
    svc.send(msg);
    svc.send(msg);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(l).not.toHaveBeenCalled();
    a.emitState({ state: 'open' });
    svc.send(msg);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('send returns true when the adapter delivered the message', () => {
    const a = new FakeLiveAdapter();
    a.deliver = true;
    const svc = new AgentSocketService(a);
    expect(svc.send({ type: 'agent:input', agentId: '1', data: 'x' })).toBe(true);
  });

  it('start/stopMockStream are no-ops for an adapter lacking them', () => {
    const svc = new AgentSocketService(new FakeLiveAdapter());
    expect(() => {
      svc.startMockStream('1', 'n', 'tmux', 'h');
      svc.stopMockStream('1');
    }).not.toThrow();
  });

  it('reconnect calls reconnectNow and dispose disconnects', () => {
    const a = new FakeLiveAdapter();
    const svc = new AgentSocketService(a);
    svc.reconnect();
    expect(a.reconnectNow).toHaveBeenCalledTimes(1);
    svc.dispose();
    expect(a.disconnect).toHaveBeenCalledTimes(1);
    expect(svc.getAdapter()).toBe(a);
  });
});
