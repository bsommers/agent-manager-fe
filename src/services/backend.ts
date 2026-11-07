import { MockAdapter } from './adapters/MockAdapter';
import { WsAdapter } from './adapters/WsAdapter';
import type { BackendAdapter, BackendMode } from './adapters/types';

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
      const secure = u.protocol === 'https:' || u.protocol === 'wss:';
      httpBase = `${secure ? 'https' : 'http'}://${u.host}`;
      wsUrl = `${secure ? 'wss' : 'ws'}://${u.host}/ws`;
    } else if (legacyWs) {
      const u = new URL(legacyWs);
      if (!['ws:', 'wss:', 'http:', 'https:'].includes(u.protocol)) {
        throw new Error('unsupported scheme');
      }
      const secure = u.protocol === 'wss:' || u.protocol === 'https:';
      wsUrl = legacyWs;
      httpBase = `${secure ? 'https' : 'http'}://${u.host}`;
    }
  } catch {
    configError = 'Invalid backend URL configuration (VITE_BACKEND_URL / VITE_WS_URL)';
    wsUrl = DEFAULT_WS;
    httpBase = DEFAULT_HTTP;
  }

  return { mode, wsUrl, httpBase, configError };
}

export function createBackend(config: BackendConfig): BackendAdapter {
  if (config.mode === 'demo') return new MockAdapter();
  return new WsAdapter(config.wsUrl, { disabledReason: config.configError });
}
