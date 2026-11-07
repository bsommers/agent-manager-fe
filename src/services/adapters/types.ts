import type { WSMessageClient, WSMessageServer } from '../wsProtocol';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'auth_failed';
export type BackendMode = 'live' | 'demo';

export interface ConnSnapshot {
  state: ConnState;
  attempt: number;
  nextRetryAt: number | null;
  lastError: string | null;
  lastConnectedAt: number | null;
  malformedFrames: number;
}

export type StateListener = (snapshot: ConnSnapshot) => void;
export type MessageListener = (msg: WSMessageServer) => void;

export interface BackendAdapter {
  readonly id: string;
  readonly mode: BackendMode;
  connect(): void;
  disconnect(): void;
  reconnectNow(): void;
  getSnapshot(): ConnSnapshot;
  onState(listener: StateListener): () => void;
  onMessage(listener: MessageListener): () => void;
  /** Returns true only when the message was written to an open connection. */
  send(msg: WSMessageClient): boolean;
  startMockStream?(agentId: string, name: string, mode: string, targetHost: string): void;
  stopMockStream?(agentId: string): void;
}

export const INITIAL_SNAPSHOT: ConnSnapshot = {
  state: 'connecting',
  attempt: 0,
  nextRetryAt: null,
  lastError: null,
  lastConnectedAt: null,
  malformedFrames: 0,
};
