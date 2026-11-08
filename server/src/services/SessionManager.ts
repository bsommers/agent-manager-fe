import { WebSocket } from 'ws';
import { Agent, WSMessageClient, WSMessageServer } from '../protocol/wsProtocol.js';
import type { TmuxDriver } from './TmuxDriver.js';
import type { SshDriver } from './SshDriver.js';
import { AgentService } from './AgentService.js';
import { errorFrame } from './serviceResult.js';

type Reply = (msg: WSMessageServer) => void;

/**
 * The WebSocket side of the gateway: the client set, the snapshot sent on connect, the fan-out
 * broadcast and the legacy mapping from client messages to AgentService calls. Every agent
 * operation runs in the service, which publishes through this class's broadcast.
 */
export class SessionManager {
  private clients: Set<WebSocket> = new Set();
  readonly service: AgentService = new AgentService((msg) => this.broadcast(msg));

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

  handleClientMessage(msg: WSMessageClient, reply?: Reply): void {
    switch (msg.type) {
      case 'agent:create':
        this.createAgent(msg.name, msg.mode, msg.targetHost, msg.initialCmd);
        break;

      case 'agent:input':
        this.sendInput(msg.agentId, msg.data);
        break;

      case 'agent:resize':
        this.resizeSession(msg.agentId, msg.cols, msg.rows);
        break;

      case 'agent:kill':
        if (msg.killSession === true) {
          // The service never rejects; the promise is deliberately not awaited.
          void this.service.destroy(msg.agentId, { confirm: msg.confirm }).then((result) => {
            if (result.ok) return;
            if (result.error.code === 'NOT_FOUND') {
              // Legacy shim (removed by plan 06-02): an unknown id on a kill is an unchanged snapshot.
              this.publishSnapshot();
              return;
            }
            if (!reply) return;
            try {
              reply(errorFrame(result.error));
            } catch {
              // The requesting socket may be gone.
            }
          });
        } else {
          this.killAgent(msg.agentId);
        }
        break;

      case 'agent:broadcast':
        // Per-target through sendInput: the legacy mapping ignores per-target results.
        msg.targetAgentIds.forEach((id) => this.sendInput(id, msg.data));
        break;
    }
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
    const result = this.service.close(agentId);
    // Legacy shim (removed by plan 06-02): an unknown id is an unchanged snapshot to every client.
    if (!result.ok && result.error.code === 'NOT_FOUND') this.publishSnapshot();
  }

  private publishSnapshot(): void {
    this.broadcast({ type: 'agent:init_list', agents: this.service.list() });
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
