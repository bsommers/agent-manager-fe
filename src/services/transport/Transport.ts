import type { ConnSnapshot } from '../adapters/types';

const WS_OPEN = 1;

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

export interface TransportOptions {
  url: string;
  WebSocketImpl?: WebSocketCtor;
  onState: (patch: Partial<ConnSnapshot>) => void;
  onFrame: (text: string) => void;
}

/**
 * Plain WebSocket transport: connect, send, close and state reporting.
 */
export class Transport {
  private readonly url: string;
  private readonly Impl: WebSocketCtor;
  private readonly onState: (patch: Partial<ConnSnapshot>) => void;
  private readonly onFrame: (text: string) => void;
  private socket: WebSocketLike | null = null;

  constructor(opts: TransportOptions) {
    this.url = opts.url;
    this.Impl = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);
    this.onState = opts.onState;
    this.onFrame = opts.onFrame;
  }

  connect(): void {
    this.onState({ state: 'connecting', lastError: null });
    this.openSocket();
  }

  private openSocket(): void {
    let socket: WebSocketLike;
    try {
      socket = new this.Impl(this.url);
    } catch {
      this.onState({ state: 'closed', lastError: 'could not create socket' });
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.onState({ state: 'open', lastConnectedAt: Date.now(), lastError: null });
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      if (typeof ev.data !== 'string') return;
      this.onFrame(ev.data);
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onState({ state: 'closed', lastError: `connection closed (code ${ev?.code ?? 'unknown'})` });
    };
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
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    this.onState({ state: 'closed', nextRetryAt: null });
  }
}
