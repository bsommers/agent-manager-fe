import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Transport, type WebSocketLike } from '../Transport';

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
  simulateClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function setup() {
  FakeWebSocket.instances = [];
  const states: Array<Record<string, unknown>> = [];
  const frames: string[] = [];
  const t = new Transport({
    url: 'ws://x/ws',
    WebSocketImpl: FakeWebSocket,
    onState: (p) => states.push(p),
    onFrame: (f) => frames.push(f),
  });
  return { t, states, frames, ws: () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1] };
}

describe('Transport (basic)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reports connecting then open with lastConnectedAt', () => {
    const { t, states, ws } = setup();
    t.connect();
    expect(states[0]).toMatchObject({ state: 'connecting' });
    ws().simulateOpen();
    expect(states[states.length - 1]).toMatchObject({ state: 'open' });
    expect(typeof states[states.length - 1].lastConnectedAt).toBe('number');
  });

  it('delivers string frames and ignores non-string frames', () => {
    const { t, frames, ws } = setup();
    t.connect();
    ws().simulateOpen();
    ws().simulateMessage('{"type":"x"}');
    ws().simulateMessage(new ArrayBuffer(4));
    expect(frames).toEqual(['{"type":"x"}']);
  });

  it('send returns true only while open', () => {
    const { t, ws } = setup();
    t.connect();
    expect(t.send('a')).toBe(false);
    ws().simulateOpen();
    expect(t.send('a')).toBe(true);
    expect(ws().sent).toEqual(['a']);
  });

  it('close reports closed and ignores later socket events', () => {
    const { t, states, frames, ws } = setup();
    t.connect();
    const sock = ws();
    sock.simulateOpen();
    t.close();
    const before = states.length;
    expect(states[before - 1]).toMatchObject({ state: 'closed' });
    sock.onmessage?.({ data: 'late' });
    sock.onclose?.({ code: 1006 });
    expect(frames).toEqual([]);
    expect(states.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Transport (reconnect and heartbeat)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(extra: Partial<ConstructorParameters<typeof Transport>[0]> = {}) {
    FakeWebSocket.instances = [];
    const states: Array<Record<string, unknown>> = [];
    const frames: string[] = [];
    const t = new Transport({
      url: 'ws://x/ws',
      WebSocketImpl: FakeWebSocket,
      random: () => 1,
      onState: (p) => states.push(p),
      onFrame: (f) => frames.push(f),
      ...extra,
    });
    const last = () => states[states.length - 1];
    const ws = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    return { t, states, frames, last, ws };
  }

  it('unexpected close schedules a retry with attempt, nextRetryAt and error', () => {
    const { t, last, ws } = make({ heartbeat: false });
    t.connect();
    ws().simulateOpen();
    ws().simulateClose(1006);
    expect(last()).toMatchObject({
      state: 'reconnecting',
      attempt: 1,
      nextRetryAt: Date.now() + 500,
      lastError: 'connection closed (code 1006)',
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    ws().simulateOpen();
    expect(last()).toMatchObject({ state: 'open' });
  });

  it('first inbound frame resets attempt to 0', () => {
    const { t, last, ws } = make({ heartbeat: false });
    t.connect();
    ws().simulateOpen();
    ws().simulateClose();
    vi.advanceTimersByTime(500);
    ws().simulateOpen();
    expect(last()).toMatchObject({ state: 'open' });
    ws().simulateMessage('{"type":"x"}');
    expect(last()).toEqual({ attempt: 0 });
  });

  it('consecutive failures use the growing ceilings', () => {
    const { t, last, ws } = make({ heartbeat: false });
    t.connect();
    ws().simulateClose();
    for (const ceil of [500, 1000, 2000, 4000, 8000, 15000, 15000]) {
      expect(Number(last().nextRetryAt) - Date.now()).toBe(ceil);
      const count = FakeWebSocket.instances.length;
      vi.advanceTimersByTime(ceil - 1);
      expect(FakeWebSocket.instances.length).toBe(count);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances.length).toBe(count + 1);
      ws().simulateClose();
    }
  });

  it('maxRetries yields closed with no timers or socket left', () => {
    const { t, last, ws } = make({ heartbeat: false, maxRetries: 2 });
    t.connect();
    ws().simulateClose();
    vi.advanceTimersByTime(500);
    ws().simulateClose();
    expect(last()).toMatchObject({ state: 'reconnecting', attempt: 2 });
    vi.advanceTimersByTime(1000);
    ws().simulateClose();
    expect(last()).toMatchObject({ state: 'closed', lastError: 'retry limit reached' });
    expect(vi.getTimerCount()).toBe(0);
    expect(t.send('x')).toBe(false);
  });

  it('close code 4401 reports auth_failed with no retry', () => {
    const { t, last, ws } = make();
    t.connect();
    ws().simulateOpen();
    ws().simulateClose(4401);
    expect(last()).toMatchObject({ state: 'auth_failed', nextRetryAt: null });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('sends a ping after the idle interval and restarts on inbound frames', () => {
    const { t, ws } = make();
    t.connect();
    ws().simulateOpen();
    vi.advanceTimersByTime(14999);
    expect(ws().sent).toEqual([]);
    ws().simulateMessage('{"type":"x"}');
    vi.advanceTimersByTime(14999);
    expect(ws().sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ws().sent).toEqual([JSON.stringify({ type: 'ping', t: Date.now() })]);
  });

  it('an inbound frame after a ping cancels the timeout', () => {
    const { t, last, ws } = make();
    t.connect();
    ws().simulateOpen();
    vi.advanceTimersByTime(15000);
    vi.advanceTimersByTime(9000);
    ws().simulateMessage('{"type":"pong","t":1}');
    vi.advanceTimersByTime(9000);
    expect(last()).toMatchObject({ state: 'open' });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('abandons the socket and reconnects when the pong times out', () => {
    const { t, last, ws } = make();
    t.connect();
    const first = ws();
    first.simulateOpen();
    vi.advanceTimersByTime(15000);
    vi.advanceTimersByTime(10000);
    expect(last()).toMatchObject({ state: 'reconnecting', attempt: 1, lastError: 'heartbeat timeout' });
    expect(first.onmessage).toBeNull();
    expect(first.readyState).toBe(3);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('heartbeat can be disabled', () => {
    const { t, ws } = make({ heartbeat: false });
    t.connect();
    ws().simulateOpen();
    vi.advanceTimersByTime(120000);
    expect(ws().sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('heartbeat intervals are configurable', () => {
    const { t, last, ws } = make({ heartbeat: { intervalMs: 100, timeoutMs: 50 } });
    t.connect();
    ws().simulateOpen();
    vi.advanceTimersByTime(100);
    expect(ws().sent).toHaveLength(1);
    vi.advanceTimersByTime(50);
    expect(last()).toMatchObject({ state: 'reconnecting' });
  });

  it('reconnectNow from reconnecting cancels the timer and connects at once', () => {
    const { t, last, ws } = make({ heartbeat: false });
    t.connect();
    ws().simulateOpen();
    ws().simulateClose();
    t.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(last()).toMatchObject({ state: 'connecting', attempt: 0, nextRetryAt: null });
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('reconnectNow from closed connects; from open it is a no-op', () => {
    const { t, last, ws } = make({ heartbeat: false });
    t.connect();
    ws().simulateOpen();
    t.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(1);
    t.close();
    expect(last()).toMatchObject({ state: 'closed' });
    t.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('close after reconnect scheduling cancels the timer; nothing survives', () => {
    const { t, last, ws } = make();
    t.connect();
    ws().simulateOpen();
    ws().simulateClose();
    expect(vi.getTimerCount()).toBe(1);
    t.close();
    expect(last()).toMatchObject({ state: 'closed', nextRetryAt: null });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('close while open clears heartbeat timers', () => {
    const { t, ws } = make();
    t.connect();
    ws().simulateOpen();
    expect(vi.getTimerCount()).toBe(1);
    t.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
