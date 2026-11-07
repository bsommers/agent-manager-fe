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
