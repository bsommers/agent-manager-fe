import { WebSocket } from 'ws';
import { Agent, WSMessageClient, WSMessageServer } from '../protocol/wsProtocol.js';
import type { TmuxDriver } from './TmuxDriver.js';
import type { SshDriver } from './SshDriver.js';
import { AgentService } from './AgentService.js';
import { AgentApi } from '../gateway/dispatch.js';
import { repliesFor } from '../gateway/wsFrames.js';

type Reply = (msg: WSMessageServer) => void;

/**
 * The WebSocket side of the gateway: the client set, the snapshot sent on connect, the fan-out
 * broadcast and the reply layer over the shared AgentApi dispatch path. Every agent
 * operation runs in the service, which publishes through this class's broadcast.
 */
export class SessionManager {
  private clients: Set<WebSocket> = new Set();
  readonly service: AgentService = new AgentService((msg) => this.broadcast(msg));
  readonly api: AgentApi = new AgentApi(this.service);

  async initialize(): Promise<void> {
    await this.service.initialize();
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    // Send initial list of active agents
    const initMsg: WSMessageServer = {
      type: 'agent:init_list',
      agents: this.service.list(),
    };
    try {
      ws.send(JSON.stringify(initMsg));
    } catch {
      // Client may have disconnected immediately
    }
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  broadcast(msg: WSMessageServer): void {
    const json = JSON.stringify(msg);
    this.clients.forEach((ws) => {
      if (ws.readyState === undefined || ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(json);
        } catch {
          // Ignore send errors on broken sockets
        }
      }
    });
  }

  /**
   * Runs one validated client message through the shared dispatch path and writes the resulting
   * frames (ack or error) through `reply`. Synchronous operations complete before this returns;
   * replies follow when the outcome settles. It never throws or rejects.
   */
  handleClientMessage(msg: WSMessageClient, reply?: Reply): void {
    void this.api.execute(msg).then((outcome) => {
      if (!reply) return;
      for (const frame of repliesFor(msg, outcome)) {
        try {
          reply(frame);
        } catch {
          // The requesting socket may be gone.
        }
      }
    });
  }

  createAgent(name: string, mode: 'tmux' | 'ssh', targetHost: string, initialCmd?: string): Agent {
    const result = this.service.create({ name, mode, targetHost, initialCmd });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  sendInput(agentId: string, data: string): void {
    this.service.input(agentId, data);
  }

  resizeSession(agentId: string, cols: number, rows: number): void {
    this.service.resize(agentId, cols, rows);
  }

  killAgent(agentId: string): void {
    this.service.close(agentId);
  }

  getAgentCount(): number {
    return this.service.count();
  }

  getAgents(): Agent[] {
    return this.service.list();
  }

  getAgent(id: string): Agent | undefined {
    return this.service.get(id);
  }

  getDriver(id: string): TmuxDriver | SshDriver | undefined {
    return this.service.driverOf(id);
  }
}
