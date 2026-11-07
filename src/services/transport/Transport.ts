import type { ConnSnapshot } from '../adapters/types';
import { computeDelay, DEFAULT_BACKOFF, type BackoffConfig } from './backoff';

const WS_OPEN = 1;
const CLOSE_AUTH_FAILED = 4401;

export interface WebSocketLike {
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

/** Heartbeat ping. wsProtocol has no ping variant, so it is typed locally. */
type PingFrame = { type: 'ping'; t: number };

export interface HeartbeatConfig {
  intervalMs: number;
  timeoutMs: number;
}

export const DEFAULT_HEARTBEAT: HeartbeatConfig = { intervalMs: 15000, timeoutMs: 10000 };

export interface TransportOptions {
  url: string;
  WebSocketImpl?: WebSocketCtor;
  onState: (patch: Partial<ConnSnapshot>) => void;
  onFrame: (text: string) => void;
  backoff?: BackoffConfig;
  /** false disables the heartbeat. */
  heartbeat?: HeartbeatConfig | false;
  /** Retries allowed before giving up; default unlimited. */
  maxRetries?: number;
  random?: () => number;
}

/**
 * Reconnecting WebSocket transport (contract spec 2.2 to 2.4): capped jittered
 * exponential backoff, application-level heartbeat, close code 4401 handling.
 */
export class Transport {
  private readonly url: string;
  private readonly Impl: WebSocketCtor;
  private readonly onState: (patch: Partial<ConnSnapshot>) => void;
  private readonly onFrame: (text: string) => void;
  private readonly backoff: BackoffConfig;
  private readonly heartbeat: HeartbeatConfig | false;
  private readonly maxRetries: number;
  private readonly random: () => number;

  private socket: WebSocketLike | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: TransportOptions) {
    this.url = opts.url;
    this.Impl = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);
    this.onState = opts.onState;
    this.onFrame = opts.onFrame;
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.heartbeat = opts.heartbeat === undefined ? DEFAULT_HEARTBEAT : opts.heartbeat;
    this.maxRetries = opts.maxRetries ?? Infinity;
    this.random = opts.random ?? Math.random;
  }

  connect(): void {
    this.teardown();
    this.attempt = 0;
    this.onState({ state: 'connecting', attempt: 0, nextRetryAt: null, lastError: null });
    this.openSocket();
  }

  /** Manual retry: no-op while open, otherwise reset backoff and connect now. */
  reconnectNow(): void {
    if (this.socket && this.socket.readyState === WS_OPEN) return;
    this.connect();
  }

  /** Returns true only when the text was written to an open socket. */
  send(text: string): boolean {
    if (!this.socket || this.socket.readyState !== WS_OPEN) return false;
    try {
      this.socket.send(text);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.teardown();
    this.attempt = 0;
    this.onState({ state: 'closed', attempt: 0, nextRetryAt: null });
  }

  private openSocket(): void {
    let socket: WebSocketLike;
    try {
      socket = new this.Impl(this.url);
    } catch {
      this.handleUnexpectedClose('could not create socket');
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.onState({ state: 'open', lastConnectedAt: Date.now(), lastError: null, nextRetryAt: null });
      this.armIdleTimer();
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      if (typeof ev.data !== 'string') return;
      this.clearTimer('pong');
      this.armIdleTimer();
      if (this.attempt !== 0) {
        this.attempt = 0;
        this.onState({ attempt: 0 });
      }
      this.onFrame(ev.data);
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearHeartbeat();
      if (ev?.code === CLOSE_AUTH_FAILED) {
        this.onState({
          state: 'auth_failed',
          nextRetryAt: null,
          lastError: `authentication failed (code ${CLOSE_AUTH_FAILED})`,
        });
        return;
      }
      this.handleUnexpectedClose(`connection closed (code ${ev?.code ?? 'unknown'})`);
    };
  }

  private handleUnexpectedClose(reason: string): void {
    const delay = computeDelay(this.attempt, this.backoff, this.random);
    const nextAttempt = this.attempt + 1;
    if (nextAttempt > this.maxRetries) {
      this.attempt = nextAttempt;
      this.onState({ state: 'closed', attempt: nextAttempt, nextRetryAt: null, lastError: 'retry limit reached' });
      return;
    }
    this.attempt = nextAttempt;
    this.onState({
      state: 'reconnecting',
      attempt: nextAttempt,
      nextRetryAt: Date.now() + delay,
      lastError: reason,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.onState({ nextRetryAt: null });
      this.openSocket();
    }, delay);
  }

  private armIdleTimer(): void {
    if (this.heartbeat === false) return;
    this.clearTimer('idle');
    const { intervalMs, timeoutMs } = this.heartbeat;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const ping: PingFrame = { type: 'ping', t: Date.now() };
      this.send(JSON.stringify(ping));
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        this.abandonSocket();
        this.handleUnexpectedClose('heartbeat timeout');
      }, timeoutMs);
    }, intervalMs);
  }

  private abandonSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.clearHeartbeat();
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
  }

  private clearTimer(which: 'retry' | 'idle' | 'pong'): void {
    const key = `${which}Timer` as 'retryTimer' | 'idleTimer' | 'pongTimer';
    if (this[key] !== null) {
      clearTimeout(this[key] as ReturnType<typeof setTimeout>);
      this[key] = null;
    }
  }

  private clearHeartbeat(): void {
    this.clearTimer('idle');
    this.clearTimer('pong');
  }

  /** Cancel every timer and detach the current socket. */
  private teardown(): void {
    this.clearTimer('retry');
    this.abandonSocket();
  }
}
