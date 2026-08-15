import { WebSocket } from 'ws';
import { Agent, WSMessageClient, WSMessageServer } from '../protocol/wsProtocol.js';
import { TmuxDriver } from './TmuxDriver.js';
import { SshDriver } from './SshDriver.js';
import { discoverTmuxSessions } from './TmuxDiscovery.js';

export class SessionManager {
  private agents: Map<string, Agent> = new Map();
  private drivers: Map<string, TmuxDriver | SshDriver> = new Map();
  private clients: Set<WebSocket> = new Set();

  async initialize(): Promise<void> {
    const discovered = await discoverTmuxSessions();
    for (const agent of discovered) {
      this.agents.set(agent.id, agent);
    }
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    // Send initial list of active agents
    const initMsg: WSMessageServer = {
      type: 'agent:init_list',
      agents: Array.from(this.agents.values()),
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

  handleClientMessage(msg: WSMessageClient): void {
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
        this.killAgent(msg.agentId);
        break;
    }
  }

  createAgent(name: string, mode: 'tmux' | 'ssh', targetHost: string, initialCmd?: string): Agent {
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agent: Agent = {
      id,
      name,
      mode,
      targetHost,
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.agents.set(id, agent);

    const onData = (data: string) => {
      agent.lastActivity = Date.now();
      this.broadcast({ type: 'agent:output', agentId: id, data });
    };

    const onExit = () => {
      agent.status = 'disconnected';
      this.broadcast({ type: 'agent:status_change', agentId: id, status: 'disconnected' });
    };

    const onError = (err: Error) => {
      agent.status = 'error';
      this.broadcast({ type: 'agent:status_change', agentId: id, status: 'error' });
      this.broadcast({
        type: 'agent:output',
        agentId: id,
        data: `\r\n\x1b[31m[SSH Error] ${err.message}\x1b[0m\r\n`,
      });
    };

    let driver: TmuxDriver | SshDriver;
    if (mode === 'tmux') {
      const sessionName = targetHost.includes(':') ? targetHost.split(':')[1] : targetHost;
      driver = new TmuxDriver(sessionName, 80, 24, onData, onExit);
      this.drivers.set(id, driver);
    } else {
      driver = new SshDriver(targetHost, 80, 24, onData, onExit, onError);
      this.drivers.set(id, driver);
    }

    if (initialCmd) {
      setTimeout(() => {
        try {
          driver.write(initialCmd + '\n');
        } catch {
          // Driver may be closed
        }
      }, 500);
    }

    this.broadcast({ type: 'agent:init_list', agents: Array.from(this.agents.values()) });
    return agent;
  }

  private getOrCreateDriver(agentId: string): TmuxDriver | SshDriver | undefined {
    let driver = this.drivers.get(agentId);
    if (!driver) {
      const agent = this.agents.get(agentId);
      if (agent && agent.mode === 'tmux') {
        const sessionName = agent.targetHost.includes(':')
          ? agent.targetHost.split(':')[1]
          : agent.targetHost;
        const onData = (data: string) => {
          agent.lastActivity = Date.now();
          this.broadcast({ type: 'agent:output', agentId: agent.id, data });
        };
        const onExit = () => {
          agent.status = 'disconnected';
          this.broadcast({ type: 'agent:status_change', agentId: agent.id, status: 'disconnected' });
        };
        driver = new TmuxDriver(sessionName, 80, 24, onData, onExit);
        this.drivers.set(agent.id, driver);
      }
    }
    return driver;
  }

  sendInput(agentId: string, data: string): void {
    const driver = this.getOrCreateDriver(agentId);
    if (driver) {
      driver.write(data);
    }
  }

  resizeSession(agentId: string, cols: number, rows: number): void {
    const driver = this.getOrCreateDriver(agentId);
    if (driver) {
      driver.resize(cols, rows);
    }
  }

  killAgent(agentId: string): void {
    const driver = this.drivers.get(agentId);
    if (driver) {
      try {
        driver.close();
      } catch {
        // Driver close error ignore
      }
      this.drivers.delete(agentId);
    }
    this.agents.delete(agentId);
    this.broadcast({ type: 'agent:init_list', agents: Array.from(this.agents.values()) });
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getDriver(id: string): TmuxDriver | SshDriver | undefined {
    return this.drivers.get(id);
  }
}
