import { WSMessageClient, WSMessageServer } from './wsProtocol';
import type { BackendAdapter, ConnState } from './adapters/types';
import { AgentRequests, type RequestHandle } from './agentRequests';
import { createBackend, resolveBackendConfig } from './backend';
import { useConnectionStore } from '../store/connectionStore';

type Listener = (msg: WSMessageServer) => void;

export class AgentSocketService {
  private listeners: Set<Listener> = new Set();
  private readonly adapter: BackendAdapter;
  private unsubs: Array<() => void> = [];
  private warned = false;
  private prevState: ConnState;
  /** Correlates agent:create / kill / update with their agent:ack or agent:error by reqId. */
  readonly requests: AgentRequests;

  constructor(adapter?: BackendAdapter) {
    this.adapter = adapter ?? createBackend(resolveBackendConfig());
    // Late-bound so a spy on this.send keeps intercepting what the request layer transmits.
    this.requests = new AgentRequests({ send: (m) => this.send(m) });
    this.prevState = this.adapter.getSnapshot().state;
    this.unsubs.push(this.adapter.onMessage((msg) => this.notify(msg)));
    this.unsubs.push(
      this.adapter.onState((snapshot) => {
        if (snapshot.state === 'open') this.warned = false;
        useConnectionStore.getState().applySnapshot(snapshot);
        const reopened = snapshot.state === 'open' && this.prevState !== 'open';
        this.prevState = snapshot.state;
        if (reopened) this.requests.resendInFlight();
      }),
    );
    const store = useConnectionStore.getState();
    store.setMode(this.adapter.mode);
    store.applySnapshot(this.adapter.getSnapshot());
    this.adapter.connect();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(msg: WSMessageServer) {
    // An answer to a request settles it and goes no further; everything else reaches the listeners.
    if (this.requests.handleServerMessage(msg) === 'consumed') return;
    this.listeners.forEach((fn) => fn(msg));
  }

  /**
   * Sends the frame built from a fresh reqId and resolves with the matching agent:ack, or rejects with
   * an AgentRequestError. Throws NOT_CONNECTED synchronously when the connection is not open.
   */
  request(build: (reqId: string) => WSMessageClient): RequestHandle {
    return this.requests.request(build);
  }

  /** Returns true only when the adapter wrote the message to an open connection. */
  send(msg: WSMessageClient): boolean {
    const delivered = this.adapter.send(msg);
    if (!delivered && !this.warned) {
      this.warned = true;
      console.warn(`agentSocket: message "${msg.type}" not sent, connection is not open`);
    }
    return delivered;
  }

  startMockStream(agentId: string, name: string, mode: string, targetHost: string) {
    this.adapter.startMockStream?.(agentId, name, mode, targetHost);
  }

  stopMockStream(agentId: string) {
    this.adapter.stopMockStream?.(agentId);
  }

  reconnect(): void {
    this.adapter.reconnectNow();
  }

  dispose(): void {
    this.requests.dispose();
    this.unsubs.forEach((fn) => fn());
    this.unsubs = [];
    this.adapter.disconnect();
  }

  getAdapter(): BackendAdapter {
    return this.adapter;
  }
}

export const agentSocket = new AgentSocketService();

if (import.meta.hot) {
  import.meta.hot.dispose(() => agentSocket.dispose());
}
