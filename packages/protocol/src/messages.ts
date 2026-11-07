import type { Agent, AgentMode, AgentStatus } from './agent.js';
import type { GatewayCapability } from './capabilities.js';

export interface BackendInfo {
  id: string;
  label: string;
  up: boolean;
  capabilities: GatewayCapability[];
}

export type WSMessageClient =
  | {
      type: 'hello';
      contract: number;
      token?: string;
      epoch?: string;
      resumeFrom?: Record<string, number>;
      client?: { name: string; version: string };
    }
  | { type: 'agent:input'; agentId: string; data: string }
  | { type: 'agent:resize'; agentId: string; cols: number; rows: number }
  | { type: 'agent:create'; name: string; mode: AgentMode; targetHost: string; initialCmd?: string }
  | { type: 'agent:kill'; agentId: string }
  | { type: 'agent:broadcast'; targetAgentIds: string[]; data: string };

export type WSMessageServer =
  | {
      type: 'hello_ack';
      contract: number;
      epoch: string;
      server: { name: string; version: string };
      auth: { required: boolean };
      limits: { maxFrameBytes: number; maxInputBytes: number; maxBroadcastTargets: number };
      backends: BackendInfo[];
    }
  | { type: 'agent:output'; agentId: string; data: string }
  | { type: 'agent:status_change'; agentId: string; status: AgentStatus }
  | { type: 'agent:init_list'; agents: Agent[] };
