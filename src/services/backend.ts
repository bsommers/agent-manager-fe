import { MockAdapter } from './adapters/MockAdapter';
import { WsAdapter } from './adapters/WsAdapter';
import type { BackendAdapter, BackendMode } from './adapters/types';
import { clearToken, commitCandidate, getToken } from './auth/tokenStore';

export interface BackendConfig {
  mode: BackendMode;
  wsUrl: string;
  httpBase: string;
  configError: string | null;
}

export interface BackendEnv {
  VITE_BACKEND_URL?: string;
  VITE_WS_URL?: string;
  VITE_DEMO_MODE?: string;
}

const DEFAULT_HTTP = 'http://localhost:8088';
const DEFAULT_WS = 'ws://localhost:8088/ws';

/** A message that is safe to show: it never contains any part of the configured URL text. */
class ConfigError extends Error {}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * True only for the loopback names D-11 allows without TLS: exactly localhost, ::1 (bare or
 * bracketed) and 127.0.0.0/8. Anchored: no suffix or substring match, no trailing dot, not 0.0.0.0.
 * Expects a hostname as produced by the URL parser (already lower-cased, shorthand IPv4 normalized).
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true;
  const m = IPV4.exec(hostname);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  return octets[0] === 127 && octets.every((o) => o >= 0 && o <= 255);
}

function assertCleanUrl(u: URL): void {
  if (u.username || u.password || u.search || u.hash) {
    throw new ConfigError(
      'The backend URL must not contain credentials, a query string or a fragment',
    );
  }
}

function assertSecureOrLoopback(secure: boolean, u: URL): void {
  if (!secure && !isLoopbackHostname(u.hostname)) {
    throw new ConfigError(
      `Plaintext ws:// to "${u.hostname}" is refused: use an https:// backend URL (wss://) behind TLS, or a loopback host`,
    );
  }
}

function isDemo(env: BackendEnv, search: string): boolean {
  const flag = (env.VITE_DEMO_MODE ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  return new URLSearchParams(search).get('demo') === '1';
}

export function resolveBackendConfig(
  env: BackendEnv = import.meta.env as unknown as BackendEnv,
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): BackendConfig {
  const mode: BackendMode = isDemo(env, search) ? 'demo' : 'live';
  let wsUrl = DEFAULT_WS;
  let httpBase = DEFAULT_HTTP;
  let configError: string | null = null;

  const backendUrl = env.VITE_BACKEND_URL?.trim();
  const legacyWs = env.VITE_WS_URL?.trim();
  try {
    if (backendUrl) {
      const u = new URL(backendUrl);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) {
        throw new Error('unsupported scheme');
      }
      assertCleanUrl(u);
      const secure = u.protocol === 'https:' || u.protocol === 'wss:';
      assertSecureOrLoopback(secure, u);
      httpBase = `${secure ? 'https' : 'http'}://${u.host}`;
      wsUrl = `${secure ? 'wss' : 'ws'}://${u.host}/ws`;
    } else if (legacyWs) {
      const u = new URL(legacyWs);
      if (!['ws:', 'wss:', 'http:', 'https:'].includes(u.protocol)) {
        throw new Error('unsupported scheme');
      }
      assertCleanUrl(u);
      const secure = u.protocol === 'wss:' || u.protocol === 'https:';
      assertSecureOrLoopback(secure, u);
      wsUrl = legacyWs;
      httpBase = `${secure ? 'https' : 'http'}://${u.host}`;
    }
  } catch (e) {
    configError =
      e instanceof ConfigError ? e.message : 'Invalid backend URL configuration (VITE_BACKEND_URL / VITE_WS_URL)';
    wsUrl = DEFAULT_WS;
    httpBase = DEFAULT_HTTP;
  }

  return { mode, wsUrl, httpBase, configError };
}

export function createBackend(config: BackendConfig): BackendAdapter {
  if (config.mode === 'demo') return new MockAdapter();
  return new WsAdapter(config.wsUrl, {
    disabledReason: config.configError,
    getToken,
    // A token is stored only once the gateway has accepted it, and dropped as soon as it is refused.
    onAuthAccepted: commitCandidate,
    onAuthRejected: clearToken,
  });
}
