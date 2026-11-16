import { describe, it, expect } from 'vitest';
import { vi, afterEach } from 'vitest';
import { resolveBackendConfig, createBackend } from '../backend';
import { isLoopbackHostname } from '../backend';
import { setToken, setCandidate, clearToken, getToken, TOKEN_STORAGE_KEY } from '../auth/tokenStore';
import type { WebSocketLike } from '../transport/Transport';
import { parseClientMessage } from '../wsProtocol';
import { MockAdapter } from '../adapters/MockAdapter';
import { WsAdapter } from '../adapters/WsAdapter';

describe('resolveBackendConfig', () => {
  it('defaults to live localhost:8088', () => {
    expect(resolveBackendConfig({}, '')).toEqual({
      mode: 'live',
      wsUrl: 'ws://localhost:8088/ws',
      httpBase: 'http://localhost:8088',
      configError: null,
    });
  });

  it('derives wss and /ws from an https origin, ignoring path and trailing slash', () => {
    const c = resolveBackendConfig({ VITE_BACKEND_URL: 'https://gw.example.com:9000/some/path/' }, '');
    expect(c.wsUrl).toBe('wss://gw.example.com:9000/ws');
    expect(c.httpBase).toBe('https://gw.example.com:9000');
    expect(c.configError).toBeNull();
  });

  it('honours VITE_WS_URL alone', () => {
    const c = resolveBackendConfig({ VITE_WS_URL: 'ws://127.0.0.1:1234/ws' }, '');
    expect(c.wsUrl).toBe('ws://127.0.0.1:1234/ws');
    expect(c.httpBase).toBe('http://127.0.0.1:1234');
  });

  it('VITE_BACKEND_URL wins over VITE_WS_URL', () => {
    const c = resolveBackendConfig(
      { VITE_BACKEND_URL: 'http://127.0.0.1:1', VITE_WS_URL: 'ws://localhost:2/ws' },
      '',
    );
    expect(c.wsUrl).toBe('ws://127.0.0.1:1/ws');
  });

  it('reports configError for an unsupported scheme and keeps safe defaults', () => {
    const c = resolveBackendConfig({ VITE_BACKEND_URL: 'ftp://x' }, '');
    expect(c.configError).toBeTruthy();
    expect(c.wsUrl).toBe('ws://localhost:8088/ws');
    expect(c.httpBase).toBe('http://localhost:8088');
  });

  it('reports configError for unparsable text', () => {
    expect(resolveBackendConfig({ VITE_BACKEND_URL: 'not a url' }, '').configError).toBeTruthy();
    expect(resolveBackendConfig({ VITE_WS_URL: '::' }, '').configError).toBeTruthy();
  });

  it.each(['1', 'true', 'TRUE', 'True'])('demo mode for VITE_DEMO_MODE=%s', (v) => {
    expect(resolveBackendConfig({ VITE_DEMO_MODE: v }, '').mode).toBe('demo');
  });

  it('demo mode from ?demo=1 only', () => {
    expect(resolveBackendConfig({}, '?x=1&demo=1').mode).toBe('demo');
    expect(resolveBackendConfig({}, '?demo=0').mode).toBe('live');
    expect(resolveBackendConfig({ VITE_DEMO_MODE: '0' }, '').mode).toBe('live');
  });
});

describe('createBackend', () => {
  it('returns MockAdapter in demo mode', () => {
    expect(createBackend(resolveBackendConfig({ VITE_DEMO_MODE: '1' }, ''))).toBeInstanceOf(MockAdapter);
  });

  it('returns WsAdapter in live mode', () => {
    expect(createBackend(resolveBackendConfig({}, ''))).toBeInstanceOf(WsAdapter);
  });

  it('returns a disabled WsAdapter (never a mock) on config error', () => {
    const a = createBackend(resolveBackendConfig({ VITE_BACKEND_URL: 'ftp://x' }, ''));
    expect(a).toBeInstanceOf(WsAdapter);
    expect(a.getSnapshot().state).toBe('closed');
  });
});

const SAFE_WS = 'ws://localhost:8088/ws';
const SAFE_HTTP = 'http://localhost:8088';

describe('resolveBackendConfig: ws:// is loopback-only (D-11)', () => {
  it.each([
    ['http://localhost:8088', 'ws://localhost:8088/ws', 'http://localhost:8088'],
    ['http://127.0.0.1:8088', 'ws://127.0.0.1:8088/ws', 'http://127.0.0.1:8088'],
    ['http://127.5.6.7:1', 'ws://127.5.6.7:1/ws', 'http://127.5.6.7:1'],
    ['http://[::1]:8088', 'ws://[::1]:8088/ws', 'http://[::1]:8088'],
    ['http://127.1', 'ws://127.0.0.1/ws', 'http://127.0.0.1'],
    ['https://gw.example.com:9000/some/path/', 'wss://gw.example.com:9000/ws', 'https://gw.example.com:9000'],
    ['wss://gw.example.com', 'wss://gw.example.com/ws', 'https://gw.example.com'],
  ])('VITE_BACKEND_URL %s is accepted', (url, ws, http) => {
    const c = resolveBackendConfig({ VITE_BACKEND_URL: url }, '');
    expect(c.configError).toBeNull();
    expect(c.wsUrl).toBe(ws);
    expect(c.httpBase).toBe(http);
  });

  it.each([
    ['ws://localhost:1/ws'],
    ['ws://[::1]:1/ws'],
    ['wss://gw.example.com/ws'],
  ])('VITE_WS_URL %s is accepted verbatim', (url) => {
    const c = resolveBackendConfig({ VITE_WS_URL: url }, '');
    expect(c.configError).toBeNull();
    expect(c.wsUrl).toBe(url);
  });

  it.each([
    ['http://gw.example.com', 'gw.example.com'],
    ['http://localhost.evil.com', 'localhost.evil.com'],
    ['http://127.0.0.1.evil.com', '127.0.0.1.evil.com'],
    ['http://0.0.0.0:8088', '0.0.0.0'],
    ['http://10.0.0.5', '10.0.0.5'],
    ['http://192.168.1.2', '192.168.1.2'],
    ['http://localhost.:8088', 'localhost.'],
    ['ws://other:1234/ws', 'other'],
  ])('plaintext %s is refused with safe defaults', (url, host) => {
    for (const env of [{ VITE_BACKEND_URL: url }, { VITE_WS_URL: url }]) {
      const c = resolveBackendConfig(env, '');
      expect(c.configError).toContain(host);
      expect(c.configError).not.toContain(url);
      expect(c.configError).toContain('wss://');
      expect(c.wsUrl).toBe(SAFE_WS);
      expect(c.httpBase).toBe(SAFE_HTTP);
    }
  });

  it('isLoopbackHostname is anchored', () => {
    for (const h of ['localhost', '::1', '[::1]', '127.0.0.1', '127.255.255.255']) {
      expect(isLoopbackHostname(h)).toBe(true);
    }
    for (const h of ['', 'localhost.', 'xlocalhost', 'localhost.evil.com', '127.0.0.1.evil.com', '127.0.0.256', '128.0.0.1', '0.0.0.0', '::2', '[::2]']) {
      expect(isLoopbackHostname(h)).toBe(false);
    }
  });
});

describe('resolveBackendConfig: URL hygiene (no token can ride in a URL)', () => {
  it.each([
    ['wss://user:pw@h/ws', ['user', 'pw']],
    ['wss://h/ws?token=SECRET', ['SECRET', 'token']],
    ['wss://h/ws#fragZ9', ['fragZ9']],
    ['https://h/?token=SECRET', ['SECRET']],
    ['http://u@localhost', ['u@']],
  ])('%s is a configError that echoes none of it', (url, forbidden) => {
    for (const env of [{ VITE_BACKEND_URL: url }, { VITE_WS_URL: url }]) {
      const c = resolveBackendConfig(env, '');
      expect(c.configError).toBeTruthy();
      expect(c.wsUrl).toBe(SAFE_WS);
      expect(c.httpBase).toBe(SAFE_HTTP);
      for (const f of forbidden) {
        expect(c.configError).not.toContain(f);
        expect(c.wsUrl).not.toContain(f);
        expect(c.httpBase).not.toContain(f);
      }
    }
  });

  it('a plain https origin with a path is still valid', () => {
    expect(resolveBackendConfig({ VITE_BACKEND_URL: 'https://gw.example.com/some/path' }, '').configError).toBeNull();
  });

  it('unparsable text does not echo the input either', () => {
    const c = resolveBackendConfig({ VITE_BACKEND_URL: 'not a SECRET url' }, '');
    expect(c.configError).toBeTruthy();
    expect(c.configError).not.toContain('SECRET');
  });
});

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
}

describe('createBackend wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    sessionStorage.clear();
  });

  it('a refused URL yields a disabled WsAdapter that never creates a socket', () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const a = createBackend(resolveBackendConfig({ VITE_BACKEND_URL: 'http://gw.example.com' }, ''));
    expect(a).toBeInstanceOf(WsAdapter);
    expect(a.getSnapshot()).toMatchObject({ state: 'closed' });
    expect(a.getSnapshot().lastError).toContain('gw.example.com');
    a.connect();
    a.reconnectNow();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('a clean live config sends a hello with the token read at open time', () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const a = createBackend(resolveBackendConfig({}, ''));
    a.connect();
    setToken('late-token-0123456789');
    const sock = FakeSocket.instances[0];
    sock.readyState = 1;
    sock.onopen?.();
    const r = parseClientMessage(JSON.parse(sock.sent[0]));
    expect(r.ok).toBe(true);
    if (r.ok && r.msg.type === 'hello') expect(r.msg.token).toBe('late-token-0123456789');
    a.disconnect();
  });

  const ACK = {
    type: 'hello_ack',
    contract: 1,
    epoch: 'ep-1',
    server: { name: 'agent-manager-gateway', version: '1.0.0' },
    auth: { required: true },
    limits: { maxFrameBytes: 1048576, maxInputBytes: 65536, maxBroadcastTargets: 32 },
    backends: [{ id: 'local', label: 'Local', up: true, capabilities: ['terminal'] }],
  };

  it('persists a candidate token only after hello_ack (WR-03)', () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const a = createBackend(resolveBackendConfig({}, ''));
    setCandidate('candidate-token-0123456789');
    a.connect();
    const sock = FakeSocket.instances[0];
    sock.readyState = 1;
    sock.onopen?.();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    sock.onmessage?.({ data: JSON.stringify(ACK) });
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe('candidate-token-0123456789');
    a.disconnect();
  });

  it('removes the token on a 4401 close (WR-03)', () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const a = createBackend(resolveBackendConfig({}, ''));
    setToken('stored-token-0123456789');
    a.connect();
    const sock = FakeSocket.instances[0];
    sock.readyState = 1;
    sock.onopen?.();
    sock.onclose?.({ code: 4401, reason: 'unauthenticated' });
    expect(getToken()).toBeUndefined();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    a.disconnect();
  });

  it('removes a rejected candidate and never stores it (WR-03)', () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const a = createBackend(resolveBackendConfig({}, ''));
    setCandidate('wrong-token-0123456789');
    a.connect();
    const sock = FakeSocket.instances[0];
    sock.readyState = 1;
    sock.onopen?.();
    sock.onclose?.({ code: 4401, reason: 'unauthenticated' });
    expect(getToken()).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
    a.disconnect();
  });

  it('demo mode still yields MockAdapter', () => {
    expect(createBackend(resolveBackendConfig({ VITE_DEMO_MODE: '1' }, ''))).toBeInstanceOf(MockAdapter);
  });
});
