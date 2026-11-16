import type { ConnSnapshot } from '../adapters/types';
import { computeDelay, DEFAULT_BACKOFF, type BackoffConfig } from './backoff';

const WS_OPEN = 1;
/** Close code: unauthenticated or hello timeout (contract spec 2.6). */
export const CLOSE_AUTH_FAILED = 4401;
/** Close code: rate limited; the reason may carry retry-after-ms=N (contract spec 2.6). */
export const CLOSE_RATE_LIMITED = 4429;
/** With a token configured the gateway must acknowledge within this long (contract spec 2.5). */
export const ACK_TIMEOUT_MS = 3000;
/** Upper bound on the delay floor taken from a 4429 reason. */
export const MAX_RETRY_FLOOR_MS = 15 * 60 * 1000;

const RETRY_AFTER_PATTERN = /^retry-after-ms=(\d{1,9})$/;

function retryFloorFromReason(reason: unknown): number {
  if (typeof reason !== 'string') return 0;
  const m = RETRY_AFTER_PATTERN.exec(reason);
  if (!m) return 0;
  return Math.min(Number(m[1]), MAX_RETRY_FLOOR_MS);
}

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

/**
 * Handshake hook (contract spec 2.5). `frame` builds the serialized hello (or null to send
 * nothing) and is called at every socket open, so a token set between attempts is used. The frame
 * is written straight to the socket from the open handler, before the open state is reported; it
 * never goes through send().
 */
export interface HelloOptions {
  frame: () => string | null;
  /** True when a hello_ack is required (a token is configured). */
  expectAck: () => boolean;
  /** Overrides ACK_TIMEOUT_MS. */
  ackTimeoutMs?: number;
}

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
  hello?: HelloOptions;
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
  private readonly hello: HelloOptions | undefined;

  private socket: WebSocketLike | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set after a 4401: nothing reconnects until connect() is called again. */
  private authLatched = false;
  /** The socket is open but the gateway has not yet acknowledged the hello: state is not yet 'open' (IN-01). */
  private awaitingAck = false;

  constructor(opts: TransportOptions) {
    this.url = opts.url;
    this.Impl = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);
    this.onState = opts.onState;
    this.onFrame = opts.onFrame;
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.heartbeat = opts.heartbeat === undefined ? DEFAULT_HEARTBEAT : opts.heartbeat;
    this.maxRetries = opts.maxRetries ?? Infinity;
    this.random = opts.random ?? Math.random;
    this.hello = opts.hello;
  }

  connect(): void {
    this.teardown();
    this.authLatched = false;
    this.attempt = 0;
    this.onState({ state: 'connecting', attempt: 0, nextRetryAt: null, lastError: null });
    this.openSocket();
  }

  /** Manual retry: no-op while open, otherwise reset backoff and connect now. */
  reconnectNow(): void {
    if (this.authLatched) return;
    if (this.socket && this.socket.readyState === WS_OPEN) return;
    this.connect();
  }

  /** The gateway acknowledged the hello: cancel the ack watchdog. */
  acknowledge(): void {
    this.clearTimer('ack');
    if (!this.awaitingAck) return;
    this.awaitingAck = false;
    if (this.socket) this.reportOpen();
  }

  private reportOpen(): void {
    this.onState({ state: 'open', lastConnectedAt: Date.now(), lastError: null, nextRetryAt: null });
  }

  /** Returns true only when the text was written to an open, acknowledged socket. */
  send(text: string): boolean {
    if (this.awaitingAck) return false;
    return this.write(text);
  }

  private write(text: string): boolean {
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
    this.authLatched = false;
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
      this.sendHello(socket);
      // With a token the connection is not usable (nor "Connected") until the hello_ack arrives (IN-01).
      this.awaitingAck = Boolean(this.hello && this.hello.expectAck());
      if (!this.awaitingAck) this.reportOpen();
      this.armIdleTimer();
      this.armAckTimer(socket);
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
      this.awaitingAck = false;
      this.clearHeartbeat();
      this.clearTimer('ack');
      if (ev?.code === CLOSE_AUTH_FAILED) {
        this.authLatched = true;
        this.onState({
          state: 'auth_failed',
          nextRetryAt: null,
          lastError: `authentication failed (code ${CLOSE_AUTH_FAILED})`,
        });
        return;
      }
      if (ev?.code === CLOSE_RATE_LIMITED) {
        this.handleUnexpectedClose(
          `rate limited (code ${CLOSE_RATE_LIMITED})`,
          retryFloorFromReason(ev.reason),
        );
        return;
      }
      this.handleUnexpectedClose(`connection closed (code ${ev?.code ?? 'unknown'})`);
    };
  }

  private sendHello(socket: WebSocketLike): void {
    if (!this.hello) return;
    try {
      const frame = this.hello.frame();
      if (frame !== null) socket.send(frame);
    } catch {
      /* a failed hello surfaces as a missing ack or a server close, never as a throw here */
    }
  }

  private armAckTimer(socket: WebSocketLike): void {
    this.clearTimer('ack');
    if (!this.awaitingAck || !this.hello) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      if (this.socket !== socket) return;
      this.abandonSocket();
      this.authLatched = true;
      this.onState({
        state: 'auth_failed',
        nextRetryAt: null,
        lastError: 'gateway did not acknowledge authentication',
      });
    }, this.hello.ackTimeoutMs ?? ACK_TIMEOUT_MS);
  }

  private handleUnexpectedClose(reason: string, delayFloorMs = 0): void {
    const delay = Math.max(computeDelay(this.attempt, this.backoff, this.random), delayFloorMs);
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
      this.write(JSON.stringify(ping));
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
    this.awaitingAck = false;
    this.clearHeartbeat();
    this.clearTimer('ack');
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
  }

  private clearTimer(which: 'retry' | 'idle' | 'pong' | 'ack'): void {
    const key = `${which}Timer` as 'retryTimer' | 'idleTimer' | 'pongTimer' | 'ackTimer';
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
