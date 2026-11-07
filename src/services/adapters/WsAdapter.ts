import type { WSMessageClient, WSMessageServer } from '../wsProtocol';
import { Transport, type HeartbeatConfig, type WebSocketCtor } from '../transport/Transport';
import type { BackoffConfig } from '../transport/backoff';
import {
  INITIAL_SNAPSHOT,
  type BackendAdapter,
  type ConnSnapshot,
  type MessageListener,
  type StateListener,
} from './types';

export interface WsAdapterOptions {
  WebSocketImpl?: WebSocketCtor;
  /** When set, connect() does nothing and the snapshot is closed with this reason. */
  disabledReason?: string | null;
  backoff?: BackoffConfig;
  heartbeat?: HeartbeatConfig | false;
  maxRetries?: number;
  random?: () => number;
}

export class WsAdapter implements BackendAdapter {
  readonly id = 'ws';
  readonly mode = 'live' as const;
  private snapshot: ConnSnapshot = { ...INITIAL_SNAPSHOT };
  private readonly stateListeners = new Set<StateListener>();
  private readonly messageListeners = new Set<MessageListener>();
  private readonly transport: Transport;
  private readonly disabledReason: string | null;

  constructor(url: string, opts: WsAdapterOptions = {}) {
    this.disabledReason = opts.disabledReason ?? null;
    this.transport = new Transport({
      url,
      WebSocketImpl: opts.WebSocketImpl,
      backoff: opts.backoff,
      heartbeat: opts.heartbeat,
      maxRetries: opts.maxRetries,
      random: opts.random,
      onState: (patch) => this.patch(patch),
      onFrame: (text) => this.handleFrame(text),
    });
    if (this.disabledReason) {
      this.snapshot = { ...this.snapshot, state: 'closed', lastError: this.disabledReason };
    }
  }

  connect(): void {
    if (this.disabledReason) return;
    this.transport.connect();
  }

  disconnect(): void {
    if (this.disabledReason) return;
    this.transport.close();
  }

  reconnectNow(): void {
    if (this.disabledReason) return;
    this.transport.reconnectNow();
  }

  getSnapshot(): ConnSnapshot {
    return this.snapshot;
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  send(msg: WSMessageClient): boolean {
    return this.transport.send(JSON.stringify(msg));
  }

  private patch(patch: Partial<ConnSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.stateListeners.forEach((fn) => {
      try {
        fn(this.snapshot);
      } catch (e) {
        console.error('state listener threw', e);
      }
    });
  }

  private handleFrame(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.patch({ malformedFrames: this.snapshot.malformedFrames + 1 });
      return;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      this.patch({ malformedFrames: this.snapshot.malformedFrames + 1 });
      return;
    }
    // Heartbeat reply: already counted as liveness by the transport.
    if ((parsed as { type: string }).type === 'pong') return;
    const msg = parsed as WSMessageServer;
    this.messageListeners.forEach((fn) => {
      try {
        fn(msg);
      } catch (e) {
        console.error('message listener threw', e);
      }
    });
  }
}
