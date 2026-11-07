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
  | { type: 'ping'; t: number }
  | { type: 'agent:input'; agentId: string; data: string }
  | { type: 'agent:resize'; agentId: string; cols: number; rows: number }
  | {
      type: 'agent:create';
      name: string;
      mode: AgentMode;
      targetHost: string;
      initialCmd?: string;
      backend?: string;
      params?: Record<string, string | number | boolean>;
      reqId?: string;
    }
  | { type: 'agent:kill'; agentId: string; reqId?: string }
  | { type: 'agent:update'; agentId: string; name?: string; tags?: string[]; group?: string; reqId?: string }
  | { type: 'agent:broadcast'; targetAgentIds: string[]; data: string; reqId?: string }
  | {
      type: 'agent:history';
      agentId: string;
      beforeSeq?: number;
      afterSeq?: number;
      limit?: number;
      reqId?: string;
    }
  | { type: 'agent:approve'; agentId: string; gateId: string; decision: 'approve' | 'deny'; reqId?: string };

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
