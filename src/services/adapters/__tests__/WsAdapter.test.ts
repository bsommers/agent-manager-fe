import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsAdapter } from '../WsAdapter';
import type { WebSocketLike } from '../../transport/Transport';

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  simulateMessage(data: unknown) {
    this.onmessage?.({ data });
  }
}

function setup() {
  FakeWebSocket.instances = [];
  const adapter = new WsAdapter('ws://x/ws', { WebSocketImpl: FakeWebSocket });
  adapter.connect();
  const ws = FakeWebSocket.instances[0];
  ws.simulateOpen();
  return { adapter, ws };
}

describe('WsAdapter (basic)', () => {
  it('delivers a valid frame to every listener', () => {
    const { adapter, ws } = setup();
    const a = vi.fn();
    const b = vi.fn();
    adapter.onMessage(a);
    adapter.onMessage(b);
    ws.simulateMessage('{"type":"agent:output","agentId":"1","data":"hi"}');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid json', '{nope'],
    ['non-object', '42'],
    ['array', '[1]'],
    ['null', 'null'],
    ['missing type', '{"a":1}'],
    ['non-string type', '{"type":5}'],
  ])('drops %s and counts it as malformed', (_n, frame) => {
    const { adapter, ws } = setup();
    const l = vi.fn();
    adapter.onMessage(l);
    ws.simulateMessage(frame);
    expect(l).not.toHaveBeenCalled();
    expect(adapter.getSnapshot().malformedFrames).toBe(1);
  });

  it('isolates a throwing listener', () => {
    const { adapter, ws } = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    adapter.onMessage(() => {
      throw new Error('boom');
    });
    adapter.onMessage(good);
    ws.simulateMessage('{"type":"agent:output","agentId":"1","data":"x"}');
    expect(good).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('send writes JSON when open and returns false when not', () => {
    FakeWebSocket.instances = [];
    const adapter = new WsAdapter('ws://x/ws', { WebSocketImpl: FakeWebSocket });
    const msg = { type: 'agent:input', agentId: '1', data: 'x' } as const;
    expect(adapter.send(msg)).toBe(false);
    adapter.connect();
    FakeWebSocket.instances[0].simulateOpen();
    expect(adapter.send(msg)).toBe(true);
    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify(msg)]);
  });

  it('disabledReason keeps the adapter closed and never opens a socket', () => {
    FakeWebSocket.instances = [];
    const adapter = new WsAdapter('ws://x/ws', {
      WebSocketImpl: FakeWebSocket,
      disabledReason: 'bad config',
    });
    adapter.connect();
    expect(FakeWebSocket.instances.length).toBe(0);
    expect(adapter.getSnapshot()).toMatchObject({ state: 'closed', lastError: 'bad config' });
  });

  it('unsubscribe stops delivery', () => {
    const { adapter, ws } = setup();
    const l = vi.fn();
    const off = adapter.onMessage(l);
    off();
    ws.simulateMessage('{"type":"agent:output","agentId":"1","data":"x"}');
    expect(l).not.toHaveBeenCalled();
  });
});

describe('WsAdapter (reconnect)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('consumes pong frames without forwarding or counting them malformed', () => {
    const { adapter, ws } = setup();
    const l = vi.fn();
    adapter.onMessage(l);
    ws.simulateMessage('{"type":"pong","t":1}');
    expect(l).not.toHaveBeenCalled();
    expect(adapter.getSnapshot().malformedFrames).toBe(0);
    adapter.disconnect();
  });

  it('forwards reconnectNow and disconnect and keeps malformedFrames across reconnects', () => {
    FakeWebSocket.instances = [];
    const adapter = new WsAdapter('ws://x/ws', {
      WebSocketImpl: FakeWebSocket,
      random: () => 1,
      heartbeat: false,
    });
    adapter.connect();
    const first = FakeWebSocket.instances[0];
    first.simulateOpen();
    first.simulateMessage('{bad');
    first.onclose?.({ code: 1006 });
    expect(adapter.getSnapshot()).toMatchObject({ state: 'reconnecting', malformedFrames: 1 });
    adapter.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(adapter.getSnapshot()).toMatchObject({ state: 'connecting', malformedFrames: 1 });
    FakeWebSocket.instances[1].simulateOpen();
    adapter.disconnect();
    expect(adapter.getSnapshot().state).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
