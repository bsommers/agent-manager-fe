import { MockStreamGenerator } from '../mockStreamGenerator';
import type { WSMessageClient, WSMessageServer } from '../wsProtocol';
import {
  INITIAL_SNAPSHOT,
  type BackendAdapter,
  type ConnSnapshot,
  type MessageListener,
  type StateListener,
} from './types';

/** Demo-mode adapter: simulated output, selected only by explicit configuration. */
export class MockAdapter implements BackendAdapter {
  readonly id = 'mock';
  readonly mode = 'demo' as const;
  private snapshot: ConnSnapshot = { ...INITIAL_SNAPSHOT };
  private readonly stateListeners = new Set<StateListener>();
  private readonly messageListeners = new Set<MessageListener>();
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();

  connect(): void {
    this.snapshot = { ...this.snapshot, state: 'open', lastConnectedAt: Date.now(), lastError: null };
    this.emitState();
  }

  disconnect(): void {
    this.intervals.forEach((id) => clearInterval(id));
    this.intervals.clear();
    this.snapshot = { ...this.snapshot, state: 'closed' };
    this.emitState();
  }

  reconnectNow(): void {
    this.connect();
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
    if (msg.type === 'agent:input') {
      const output = MockStreamGenerator.processInput(msg.agentId, msg.data, msg.agentId);
      this.emit({ type: 'agent:output', agentId: msg.agentId, data: output });
    }
    if (msg.type === 'agent:broadcast') {
      msg.targetAgentIds.forEach((agentId) => {
        const output = MockStreamGenerator.processInput(agentId, msg.data, agentId);
        this.emit({ type: 'agent:output', agentId, data: output });
      });
    }
    return true;
  }

  startMockStream(agentId: string, name: string, mode: string, targetHost: string): void {
    this.stopMockStream(agentId);
    const banner = MockStreamGenerator.getInitialBanner(name, mode, targetHost);
    this.emit({ type: 'agent:output', agentId, data: banner });
    const intervalId = setInterval(() => {
      const logs = [
        `\x1b[36m[info]\x1b[0m agent heartbeat ok (${new Date().toLocaleTimeString()})\r\n`,
        `\x1b[32m[task]\x1b[0m context sync completed.\r\n`,
      ];
      const randomLog = logs[Math.floor(Math.random() * logs.length)];
      this.emit({ type: 'agent:output', agentId, data: randomLog });
    }, 15000);
    this.intervals.set(agentId, intervalId);
  }

  stopMockStream(agentId: string): void {
    const id = this.intervals.get(agentId);
    if (id) {
      clearInterval(id);
      this.intervals.delete(agentId);
    }
  }

  private emit(msg: WSMessageServer): void {
    this.messageListeners.forEach((fn) => {
      try {
        fn(msg);
      } catch (e) {
        console.error('message listener threw', e);
      }
    });
  }

  private emitState(): void {
    this.stateListeners.forEach((fn) => {
      try {
        fn(this.snapshot);
      } catch (e) {
        console.error('state listener threw', e);
      }
    });
  }
}
