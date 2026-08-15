import { MockStreamGenerator } from './mockStreamGenerator';
import { WSMessageClient, WSMessageServer } from './wsProtocol';

type Listener = (msg: WSMessageServer) => void;

export class AgentSocketService {
  private listeners: Set<Listener> = new Set();
  private isMockMode: boolean = true;
  private ws: WebSocket | null = null;
  private mockIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor() {
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';
    this.connectLive(wsUrl);
  }

  private connectLive(url: string) {
    try {
      this.ws = new WebSocket(url);
      this.isMockMode = false;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as WSMessageServer;
        this.notify(msg);
      };
      this.ws.onerror = (err) => {
        console.warn('Live WS error, switching to mock mode', err);
        this.isMockMode = true;
      };
      this.ws.onclose = () => {
        console.info('Live WS closed, switching to mock mode');
        this.isMockMode = true;
        this.ws = null;
      };
    } catch (e) {
      console.warn('Live WS failed, falling back to mock driver', e);
      this.isMockMode = true;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(msg: WSMessageServer) {
    this.listeners.forEach((fn) => fn(msg));
  }

  send(msg: WSMessageClient) {
    if (!this.isMockMode && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }

    // Mock mode handling
    if (msg.type === 'agent:input') {
      const output = MockStreamGenerator.handleMockCommand(msg.data, msg.agentId);
      this.notify({
        type: 'agent:output',
        agentId: msg.agentId,
        data: output,
      });
    }
  }

  startMockStream(agentId: string, name: string, mode: string, targetHost: string) {
    this.stopMockStream(agentId);

    // Send initial banner
    const banner = MockStreamGenerator.getInitialBanner(name, mode, targetHost);
    this.notify({ type: 'agent:output', agentId, data: banner });

    // Periodic heartbeat log simulation
    const intervalId = setInterval(() => {
      const logs = [
        `\x1b[36m[info]\x1b[0m agent heartbeat ok (${new Date().toLocaleTimeString()})\r\n`,
        `\x1b[32m[task]\x1b[0m context sync completed.\r\n`,
      ];
      const randomLog = logs[Math.floor(Math.random() * logs.length)];
      this.notify({ type: 'agent:output', agentId, data: randomLog });
    }, 15000);

    this.mockIntervals.set(agentId, intervalId);
  }

  stopMockStream(agentId: string) {
    const id = this.mockIntervals.get(agentId);
    if (id) {
      clearInterval(id);
      this.mockIntervals.delete(agentId);
    }
  }
}

export const agentSocket = new AgentSocketService();
