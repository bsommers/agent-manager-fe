import { LIMITS } from '../protocol/wsProtocol.js';
import type { Agent, BroadcastResult, WSMessageServer } from '../protocol/wsProtocol.js';
import { TmuxDriver } from './TmuxDriver.js';
import { SshDriver } from './SshDriver.js';
import { discoverTmuxSessions } from './TmuxDiscovery.js';
import { isKillableTmuxSessionName, killTmuxSession, tmuxSessionNameOf } from './tmuxKill.js';
import { fail, ok } from './serviceResult.js';
import type { ServiceResult } from './serviceResult.js';

type Driver = TmuxDriver | SshDriver;
type Publish = (msg: WSMessageServer) => void;

export interface CreateAgentInput {
  name: string;
  mode: 'tmux' | 'ssh';
  targetHost: string;
  initialCmd?: string;
}

export interface AgentPatchInput {
  name?: string;
  tags?: string[];
  group?: string;
}

interface InFlightKill {
  exited: boolean;
  promise: Promise<ServiceResult<Agent>>;
}

/**
 * Transport-agnostic agent operations: owns the registry, the drivers and the in-flight session
 * kills. Imports no WebSocket, Express or HTTP type; state changes leave through one `publish`
 * callback, and expected failures come back as typed ServiceResult values.
 */
export class AgentService {
  private agents: Map<string, Agent> = new Map();
  private drivers: Map<string, Driver> = new Map();
  /** Session kills in flight, keyed by agent id; `exited` records a driver exit held back meanwhile. */
  private killsInFlight: Map<string, InFlightKill> = new Map();

  private readonly maxAgents: number;

  constructor(
    private readonly publish: Publish,
    options: { maxAgents?: number } = {}
  ) {
    this.maxAgents = options.maxAgents ?? LIMITS.MAX_AGENTS;
  }

  async initialize(): Promise<void> {
    const discovered = await discoverTmuxSessions();
    for (const agent of discovered) {
      this.agents.set(agent.id, agent);
      this.getOrCreateDriver(agent.id);
    }
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  count(): number {
    return this.agents.size;
  }

  driverOf(id: string): Driver | undefined {
    return this.drivers.get(id);
  }

  create(input: CreateAgentInput): ServiceResult<Agent> {
    const { name, mode, targetHost, initialCmd } = input;
    // The roster must never exceed LIMITS.MAX_AGENTS or every client snapshot becomes invalid.
    if (this.agents.size >= this.maxAgents) return fail('CONFLICT', 'agent limit reached');
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

    // A late callback from a driver of a removed agent must not touch or announce it.
    const live = () => this.agents.get(id) === agent;

    const onData = (data: string) => {
      if (!live()) return;
      agent.lastActivity = Date.now();
      this.publish({ type: 'agent:output', agentId: id, data });
    };

    const onExit = () => this.handleDriverExit(agent);

    const onError = (err: Error) => {
      if (!live()) return;
      agent.status = 'error';
      this.publish({ type: 'agent:status_change', agentId: id, status: 'error' });
      this.publish({
        type: 'agent:output',
        agentId: id,
        data: `\r\n\x1b[31m[SSH Error] ${err.message}\x1b[0m\r\n`,
      });
    };

    // The driver is built before anything is registered: a failed start leaves no ghost agent.
    let driver: Driver;
    try {
      driver =
        mode === 'tmux'
          ? new TmuxDriver(tmuxSessionNameOf(targetHost), 80, 24, onData, onExit)
          : new SshDriver(targetHost, 80, 24, onData, onExit, onError);
    } catch (err) {
      console.error(`agent:create driver start failed: ${String((err as Error)?.message).slice(0, 200)}`);
      return fail('BACKEND_DOWN', 'the backend could not start the session');
    }
    this.agents.set(id, agent);
    this.drivers.set(id, driver);

    if (initialCmd) {
      setTimeout(() => {
        try {
          driver.write(initialCmd + '\n');
        } catch {
          // Driver may be closed
        }
      }, 500);
    }

    this.publish({ type: 'agent:added', agent: structuredClone(agent) });
    return ok(agent);
  }

  /** Closes the driver and removes the agent. Never touches the tmux session. */
  close(agentId: string): ServiceResult<Agent> {
    const agent = this.agents.get(agentId);
    if (!agent) return fail('NOT_FOUND', 'agent not found', { agentId: idOf(agentId) });
    this.remove(agent);
    return ok(agent);
  }

  /**
   * Ends the agent's tmux session, then removes the agent. The confirm gate runs first, before any
   * lookup or process. The session name is derived from the registry entry, never from the caller.
   */
  async destroy(agentId: string, opts: { confirm?: unknown }): Promise<ServiceResult<Agent>> {
    if (opts?.confirm !== true) {
      return this.refuse(agentId, 'USAGE', 'killSession requires confirm: true');
    }
    const agent = this.agents.get(agentId);
    if (!agent) return fail('NOT_FOUND', 'agent not found', { agentId: idOf(agentId) });
    if (agent.mode !== 'tmux') {
      return this.refuse(agentId, 'UNSUPPORTED', 'killSession is only supported for tmux agents');
    }
    const name = tmuxSessionNameOf(agent.targetHost);
    if (!isKillableTmuxSessionName(name)) {
      return this.refuse(agentId, 'USAGE', 'the session name cannot be killed by the gateway');
    }
    const existing = this.killsInFlight.get(agentId);
    if (existing) return existing.promise;

    const inFlight: InFlightKill = { exited: false, promise: undefined as never };
    // Registered before the first await so an overlapping call and a driver exit both see it.
    this.killsInFlight.set(agentId, inFlight);
    inFlight.promise = this.runDestroy(agent, name, inFlight);
    return inFlight.promise;
  }

  private async runDestroy(
    agent: Agent,
    name: string,
    inFlight: InFlightKill
  ): Promise<ServiceResult<Agent>> {
    try {
      await killTmuxSession(name);
    } catch (err) {
      console.error(
        `agent:kill tmux failure for agent ${agent.id.slice(0, 64)}: ${(err as Error)?.message}`
      );
      this.killsInFlight.delete(agent.id);
      if (inFlight.exited && this.agents.get(agent.id) === agent) this.applyExit(agent);
      return this.refuse(agent.id, 'INTERNAL', 'tmux could not end the session');
    }
    console.log(`agent:kill ended tmux session ${name} for agent ${agent.id.slice(0, 64)}`);
    // remove runs synchronously below, so a late driver exit finds the agent gone and is dropped.
    try {
      if (this.agents.get(agent.id) === agent) this.remove(agent);
    } finally {
      this.killsInFlight.delete(agent.id);
    }
    return ok(agent);
  }

  input(agentId: string, data: string): ServiceResult<void> {
    return this.withDriver(agentId, (driver) => driver.write(data));
  }

  resize(agentId: string, cols: number, rows: number): ServiceResult<void> {
    return this.withDriver(agentId, (driver) => driver.resize(cols, rows));
  }

  /** One result per listed id, in request order; a failing target never stops the later ones. */
  broadcast(targetIds: string[], data: string): BroadcastResult[] {
    return targetIds.map((agentId): BroadcastResult => {
      const r = this.input(agentId, data);
      if (r.ok) return { agentId, status: 'sent' };
      if (r.error.code === 'BACKEND_DOWN') return { agentId, status: 'offline' };
      return { agentId, status: 'failed', code: r.error.code, message: r.error.message };
    });
  }

  /** Changes name, tags (replaced as a whole) and/or group, and announces agent:updated. */
  update(agentId: string, patch: AgentPatchInput): ServiceResult<Agent> {
    const agent = this.agents.get(agentId);
    if (!agent) return fail('NOT_FOUND', 'agent not found', { agentId: idOf(agentId) });
    const applied: AgentPatchInput = {};
    if (patch?.name !== undefined) applied.name = patch.name;
    if (patch?.tags !== undefined) applied.tags = [...patch.tags];
    if (patch?.group !== undefined) applied.group = patch.group;
    if (Object.keys(applied).length === 0) {
      return fail('USAGE', 'nothing to update', { agentId: idOf(agentId) });
    }
    Object.assign(agent, applied);
    this.publish({
      type: 'agent:updated',
      agentId: agent.id,
      patch: { ...applied, ...(applied.tags ? { tags: [...applied.tags] } : {}) },
    });
    return ok(structuredClone(agent));
  }

  private withDriver(agentId: string, run: (driver: Driver) => void): ServiceResult<void> {
    if (!this.agents.has(agentId)) return fail('NOT_FOUND', 'agent not found', { agentId: idOf(agentId) });
    let driver: Driver | undefined;
    try {
      driver = this.getOrCreateDriver(agentId);
    } catch {
      driver = undefined;
    }
    if (!driver) return fail('BACKEND_DOWN', 'agent has no live session', { agentId: idOf(agentId) });
    try {
      run(driver);
    } catch {
      return fail('INTERNAL', 'could not write to the session', { agentId: idOf(agentId) });
    }
    return ok(undefined);
  }

  private remove(agent: Agent): void {
    const driver = this.drivers.get(agent.id);
    if (driver) {
      try {
        driver.close();
      } catch {
        // Driver close error ignore
      }
      this.drivers.delete(agent.id);
    }
    this.agents.delete(agent.id);
    this.publish({ type: 'agent:removed', agentId: agent.id, reason: 'killed' });
  }

  private getOrCreateDriver(agentId: string): Driver | undefined {
    let driver = this.drivers.get(agentId);
    if (!driver) {
      const agent = this.agents.get(agentId);
      if (agent && agent.mode === 'tmux') {
        const sessionName = tmuxSessionNameOf(agent.targetHost);
        const onData = (data: string) => {
          if (this.agents.get(agent.id) !== agent) return;
          agent.lastActivity = Date.now();
          this.publish({ type: 'agent:output', agentId: agent.id, data });
        };
        const onExit = () => this.handleDriverExit(agent);
        driver = new TmuxDriver(sessionName, 80, 24, onData, onExit);
        this.drivers.set(agent.id, driver);
      }
    }
    return driver;
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
    this.publish({ type: 'agent:status_change', agentId: agent.id, status: 'disconnected' });
  }

  private refuse(
    agentId: unknown,
    code: 'USAGE' | 'UNSUPPORTED' | 'INTERNAL',
    message: string
  ): ServiceResult<never> {
    const shown = typeof agentId === 'string' ? agentId.slice(0, 64) : '?';
    console.warn(`agent:kill killSession refused (${code}) for agent ${shown}`);
    return fail(code, message, { agentId: idOf(agentId) });
  }
}

function idOf(agentId: unknown): string | undefined {
  return typeof agentId === 'string' ? agentId : undefined;
}
