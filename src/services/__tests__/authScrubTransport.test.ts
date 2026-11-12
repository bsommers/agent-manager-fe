import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsAdapter } from '../adapters/WsAdapter';
import type { ConnSnapshot } from '../adapters/types';
import type { WebSocketLike } from '../transport/Transport';
import { setToken, getToken, clearToken, useAuthStore, TOKEN_STORAGE_KEY } from '../auth/tokenStore';
import { useConnectionStore } from '../../store/connectionStore';
import { redactJson, knownSecrets, REDACTED } from '../redact';

const CANARY = 'CANARY-8f3a91c2d4e5b6a7-do-not-leak';
const CANARY_2 = 'CANARY2-1b2c3d4e5f60718-do-not-leak';
const REJECTED = 'bad\u0007REJECTED-CANARY-9z8y7x';

const ACK = {
  type: 'hello_ack',
  contract: 1,
  epoch: 'ep-2026-11-07',
  server: { name: 'agent-manager-gateway', version: '2.0.0' },
  auth: { required: true },
  limits: { maxFrameBytes: 1048576, maxInputBytes: 65536, maxBroadcastTargets: 64 },
  backends: [],
};

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
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data });
  }
  closeWith(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

describe('token canary: the token reaches only the hello frame and one sessionStorage entry', () => {
  const consoleCalls: string[] = [];
  const snapshots: ConnSnapshot[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    consoleCalls.length = 0;
    snapshots.length = 0;
    FakeWebSocket.instances = [];
    for (const m of METHODS) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(args.map(safeJson).join(' '));
      });
    }
    clearToken();
    sessionStorage.clear();
    useConnectionStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearToken();
    sessionStorage.clear();
  });

  function drive() {
    const adapter = new WsAdapter('ws://localhost:8088/ws', {
      WebSocketImpl: FakeWebSocket,
      getToken,
      heartbeat: false,
      random: () => 1,
    });
    adapter.onState((s) => {
      snapshots.push(s);
      useConnectionStore.getState().applySnapshot(s);
    });
    return adapter;
  }

  function storageDump(): string {
    return safeJson(Object.entries(sessionStorage));
  }

  function surfaces(adapter: WsAdapter): Record<string, string> {
    return {
      console: consoleCalls.join('\n'),
      urls: FakeWebSocket.instances.map((w) => w.url).join('\n'),
      connectionStore: safeJson(useConnectionStore.getState()),
      authStore: safeJson(useAuthStore.getState()),
      snapshot: safeJson(adapter.getSnapshot()),
      snapshotsSeen: safeJson(snapshots),
      lastErrors: snapshots.map((s) => String(s.lastError)).join('\n'),
      redacted: safeJson(
        redactJson({ c: useConnectionStore.getState(), a: useAuthStore.getState(), s: adapter.getSnapshot() }),
      ),
    };
  }

  it('full session: connect, hello, ack, 4401, reconnect with a changed token, logout', () => {
    expect(setToken(CANARY)).toEqual({ ok: true });
    const adapter = drive();
    adapter.connect();
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message(JSON.stringify(ACK));
    first.closeWith(4401);
    expect(adapter.getSnapshot().state).toBe('auth_failed');

    // Exactly two places: the hello frame and the one storage entry.
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]).toContain(CANARY);
    expect(storageDump()).toContain(CANARY);
    expect(Object.keys(sessionStorage)).toEqual([TOKEN_STORAGE_KEY]);

    // Reconnect with a changed token.
    setToken(CANARY_2);
    adapter.connect();
    const second = FakeWebSocket.instances[1];
    second.open();
    second.message(JSON.stringify(ACK));
    expect(second.sent[0]).toContain(CANARY_2);
    expect(second.sent[0]).not.toContain(CANARY);
    expect(storageDump()).toContain(CANARY_2);
    expect(storageDump()).not.toContain(CANARY);

    for (const [name, text] of Object.entries(surfaces(adapter))) {
      expect(text, name).not.toContain(CANARY);
      expect(text, name).not.toContain(CANARY_2);
    }
    // The redactor finds nothing to redact in any state object: it equals its own redacted copy.
    const stateObjects = [useConnectionStore.getState(), useAuthStore.getState(), adapter.getSnapshot(), snapshots];
    for (const o of stateObjects) {
      expect(safeJson(redactJson(o, [CANARY, CANARY_2]))).toBe(safeJson(o));
    }
    // No frame other than the hello ever carried a token.
    for (const w of FakeWebSocket.instances) {
      expect(w.url).not.toContain('token');
      expect(w.sent.slice(1).join('')).not.toContain('CANARY');
    }

    // Logout path: the token disappears from storage and state.
    adapter.disconnect();
    clearToken();
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(getToken()).toBeUndefined();
    for (const [name, text] of Object.entries(surfaces(adapter))) {
      expect(text, name).not.toContain(CANARY_2);
    }
  });

  it('a wrong token ends in auth_failed with the token in no error string', () => {
    setToken(CANARY);
    const adapter = drive();
    adapter.connect();
    FakeWebSocket.instances[0].open();
    vi.advanceTimersByTime(3000); // no ack
    expect(adapter.getSnapshot()).toMatchObject({
      state: 'auth_failed',
      lastError: 'gateway did not acknowledge authentication',
    });
    for (const [name, text] of Object.entries(surfaces(adapter))) {
      expect(text, name).not.toContain(CANARY);
    }
  });

  it('a contract mismatch message does not carry the token', () => {
    setToken(CANARY);
    const adapter = drive();
    adapter.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message(JSON.stringify({ ...ACK, contract: 7 }));
    expect(adapter.getSnapshot().lastError).toBe('gateway speaks contract 7, this UI speaks 1');
    for (const [name, text] of Object.entries(surfaces(adapter))) {
      expect(text, name).not.toContain(CANARY);
    }
  });

  it('a rejected token leaves no trace of the input anywhere', () => {
    const r = setToken(REJECTED);
    expect(r.ok).toBe(false);
    const adapter = drive();
    const everything = [
      safeJson(r),
      storageDump(),
      ...Object.values(surfaces(adapter)),
    ].join('\n');
    expect(everything).not.toContain('REJECTED-CANARY');
    expect(getToken()).toBeUndefined();
  });

  it('the redactor removes the token from text and JSON built by other code', () => {
    setToken(CANARY);
    expect(knownSecrets()).toEqual([CANARY]);
    const out = safeJson(redactJson({ note: `Authorization: ${CANARY}`, nested: [{ frame: `{"token":"${CANARY}"}` }] }));
    expect(out).not.toContain(CANARY);
    expect(out).toContain(REDACTED);
  });

  it.todo('Copy diagnostics redacts the token (INT-10, Phase 21)');
});
