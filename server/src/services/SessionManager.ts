import { WebSocket } from 'ws';
import { Agent, WSMessageClient, WSMessageServer } from '../protocol/wsProtocol.js';
import { TmuxDriver } from './TmuxDriver.js';
import { SshDriver } from './SshDriver.js';
import { discoverTmuxSessions } from './TmuxDiscovery.js';
import { isKillableTmuxSessionName, killTmuxSession, tmuxSessionNameOf } from './tmuxKill.js';

type ClientMessage = WSMessageClient;
type KillMessage = Extract<ClientMessage, { type: 'agent:kill' }>;
type Reply = (msg: WSMessageServer) => void;

export class SessionManager {
  private agents: Map<string, Agent> = new Map();
  private drivers: Map<string, TmuxDriver | SshDriver> = new Map();
  private clients: Set<WebSocket> = new Set();
  /** Session kills in flight, keyed by agent id; `exited` records a driver exit held back meanwhile. */
  private killsInFlight: Map<string, { exited: boolean }> = new Map();

  async initialize(): Promise<void> {
    const discovered = await discoverTmuxSessions();
    for (const agent of discovered) {
      this.agents.set(agent.id, agent);
      this.getOrCreateDriver(agent.id);
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
          // Never rejects; the promise is deliberately not awaited.
          void this.killAgentAndSession(msg, reply);
        } else {
          this.killAgent(msg.agentId);
        }
        break;

      case 'agent:broadcast':
        msg.targetAgentIds.forEach((id) => this.sendInput(id, msg.data));
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

    const onExit = () => this.handleDriverExit(agent);

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
      const sessionName = tmuxSessionNameOf(targetHost);
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
        const sessionName = tmuxSessionNameOf(agent.targetHost);
        const onData = (data: string) => {
          agent.lastActivity = Date.now();
          this.broadcast({ type: 'agent:output', agentId: agent.id, data });
        };
        const onExit = () => this.handleDriverExit(agent);
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

  /**
   * A driver exit. While a session kill is in flight for the agent the exit is only recorded (a
   * kill that works makes the exit expected; one that fails replays it). An exit for an agent that
   * is no longer in the registry is dropped.
   */
  private handleDriverExit(agent: Agent): void {
    const inFlight = this.killsInFlight.get(agent.id);
    if (inFlight) {
      inFlight.exited = true;
      return;
    }
    if (this.agents.get(agent.id) !== agent) return;
    this.applyExit(agent);
  }

  private applyExit(agent: Agent): void {
    agent.status = 'disconnected';
    this.broadcast({ type: 'agent:status_change', agentId: agent.id, status: 'disconnected' });
  }

  private refuse(
    reply: Reply | undefined,
    agentId: unknown,
    code: 'USAGE' | 'UNSUPPORTED' | 'INTERNAL',
    message: string
  ): void {
    const shown = typeof agentId === 'string' ? agentId.slice(0, 64) : '?';
    console.warn(`agent:kill killSession refused (${code}) for agent ${shown}`);
    if (!reply) return;
    const frame: WSMessageServer = {
      type: 'agent:error',
      code,
      message,
      retryable: false,
      ...(typeof agentId === 'string' && agentId.length >= 1 && agentId.length <= 128
        ? { agentId }
        : {}),
    };
    try {
      reply(frame);
    } catch {
      // The requesting socket may be gone.
    }
  }

  /**
   * agent:kill with killSession true: ends the agent's tmux session, then removes the agent through
   * the normal killAgent path. The confirm gate runs first, before any lookup or process.
   * The session name is derived from the registry entry, never from the client frame.
   */
  private async killAgentAndSession(msg: KillMessage, reply?: Reply): Promise<void> {
    if (msg.confirm !== true) {
      this.refuse(reply, msg.agentId, 'USAGE', 'killSession requires confirm: true');
      return;
    }
    const agent = this.agents.get(msg.agentId);
    if (!agent) {
      this.killAgent(msg.agentId);
      return;
    }
    if (agent.mode !== 'tmux') {
      this.refuse(reply, msg.agentId, 'UNSUPPORTED', 'killSession is only supported for tmux agents');
      return;
    }
    const name = tmuxSessionNameOf(agent.targetHost);
    if (!isKillableTmuxSessionName(name)) {
      this.refuse(reply, msg.agentId, 'USAGE', 'the session name cannot be killed by the gateway');
      return;
    }
    if (this.killsInFlight.has(msg.agentId)) return;

    const inFlight = { exited: false };
    this.killsInFlight.set(msg.agentId, inFlight);
    try {
      await killTmuxSession(name);
    } catch (err) {
      console.error(
        `agent:kill tmux failure for agent ${msg.agentId.slice(0, 64)}: ${(err as Error)?.message}`
      );
      this.killsInFlight.delete(msg.agentId);
      if (inFlight.exited && this.agents.get(msg.agentId) === agent) this.applyExit(agent);
      this.refuse(reply, msg.agentId, 'INTERNAL', 'tmux could not end the session');
      return;
    }
    console.log(`agent:kill ended tmux session ${name} for agent ${msg.agentId.slice(0, 64)}`);
    // killAgent runs synchronously below, so a late driver exit finds the agent gone and is dropped.
    try {
      if (this.agents.get(msg.agentId) === agent) this.killAgent(msg.agentId);
    } finally {
      this.killsInFlight.delete(msg.agentId);
    }
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
