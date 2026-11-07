import { describe, it, expect } from 'vitest';
import { resolveBackendConfig, createBackend } from '../backend';
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
    const c = resolveBackendConfig({ VITE_WS_URL: 'ws://other:1234/ws' }, '');
    expect(c.wsUrl).toBe('ws://other:1234/ws');
    expect(c.httpBase).toBe('http://other:1234');
  });

  it('VITE_BACKEND_URL wins over VITE_WS_URL', () => {
    const c = resolveBackendConfig(
      { VITE_BACKEND_URL: 'http://a:1', VITE_WS_URL: 'ws://b:2/ws' },
      '',
    );
    expect(c.wsUrl).toBe('ws://a:1/ws');
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
