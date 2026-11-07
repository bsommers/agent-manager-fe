import { WSMessageClient, WSMessageServer } from './wsProtocol';
import type { BackendAdapter } from './adapters/types';
import { createBackend, resolveBackendConfig } from './backend';
import { useConnectionStore } from '../store/connectionStore';

type Listener = (msg: WSMessageServer) => void;

export class AgentSocketService {
  private listeners: Set<Listener> = new Set();
  private readonly adapter: BackendAdapter;
  private unsubs: Array<() => void> = [];
  private warned = false;

  constructor(adapter?: BackendAdapter) {
    this.adapter = adapter ?? createBackend(resolveBackendConfig());
    this.unsubs.push(this.adapter.onMessage((msg) => this.notify(msg)));
    this.unsubs.push(
      this.adapter.onState((snapshot) => {
        if (snapshot.state === 'open') this.warned = false;
        useConnectionStore.getState().applySnapshot(snapshot);
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
    this.listeners.forEach((fn) => fn(msg));
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
