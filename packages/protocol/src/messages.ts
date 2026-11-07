import type { Agent, AgentMode, AgentStatus } from './agent.js';

export type WSMessageClient =
  | { type: 'agent:input'; agentId: string; data: string }
  | { type: 'agent:resize'; agentId: string; cols: number; rows: number }
  | { type: 'agent:create'; name: string; mode: AgentMode; targetHost: string; initialCmd?: string }
  | { type: 'agent:kill'; agentId: string }
  | { type: 'agent:broadcast'; targetAgentIds: string[]; data: string };

export type WSMessageServer =
  | { type: 'agent:output'; agentId: string; data: string }
  | { type: 'agent:status_change'; agentId: string; status: AgentStatus }
  | { type: 'agent:init_list'; agents: Agent[] };
