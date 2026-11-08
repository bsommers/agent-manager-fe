import type { Agent, AgentKind, AgentMode, AgentStatus } from './agent.js';
import type { GatewayCapability } from './capabilities.js';
import type { ErrorCode } from './errors.js';

export interface BackendInfo {
  id: string;
  label: string;
  up: boolean;
  capabilities: GatewayCapability[];
  agentSpecs?: AgentSpecInfo[];
}

export interface AgentSpecField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  options?: string[];
}

/** Describes how to create an agent of a given mode on a backend (contract spec section 9). */
export interface AgentSpecInfo {
  mode: string;
  kind: AgentKind;
  title: string;
  fields: AgentSpecField[];
}

export type RemovedReason = 'killed' | 'exited' | 'gone' | 'backend_down';
export type AckOp = 'create' | 'kill' | 'update' | 'broadcast';

export interface BroadcastResult {
  agentId: string;
  status: 'sent' | 'failed' | 'offline' | 'unsupported';
  code?: ErrorCode;
  message?: string;
}

export interface HistoryChunk {
  seq: number;
  ts: number;
  data: string;
}

export type AgentMetaPayload =
  | { scope: 'cost'; data: { spent: number; cap?: number; currency?: string; tokens?: { in: number; out: number } } }
  | { scope: 'quota'; data: { used: number; limit: number; window?: string; resetAt?: number } }
  | {
      scope: 'task';
      data: { id: string; title?: string; state: 'queued' | 'running' | 'done' | 'failed'; exitCode?: number };
    }
  | {
      scope: 'pipeline';
      data: { stage: string; wave?: string; state?: 'running' | 'passed' | 'failed' | 'waiting_gate' };
    }
  | {
      scope: 'sandbox';
      data: {
        state: 'creating' | 'running' | 'stopped' | 'snapshotting' | 'deleting' | 'error';
        detail?: string;
      };
    };

export type MetaScope = AgentMetaPayload['scope'];

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
  | {
      type: 'agent:kill';
      agentId: string;
      /** true also ends the backend's persistent session (tmux); absent or false keeps it running. */
      killSession?: boolean;
      /** Must be exactly true for killSession to be honoured; checked by the gateway. */
      confirm?: boolean;
      reqId?: string;
    }
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
  | { type: 'pong'; t: number }
  | { type: 'agent:added'; agent: Agent }
  | { type: 'agent:removed'; agentId: string; reason?: RemovedReason }
  | { type: 'agent:updated'; agentId: string; patch: AgentPatch }
  | { type: 'agent:output'; agentId: string; data: string; seq?: number; replay?: boolean }
  | { type: 'agent:gap'; agentId: string; fromSeq: number; toSeq: number }
  | { type: 'agent:history_chunk'; agentId: string; chunks: HistoryChunk[]; hasMore: boolean; reqId?: string }
  | { type: 'agent:status_change'; agentId: string; status: AgentStatus; reason?: string; exitCode?: number }
  | { type: 'agent:init_list'; agents: Agent[] }
  | { type: 'agent:ack'; reqId: string; op: AckOp; ok: true; agent?: Agent; results?: BroadcastResult[] }
  | {
      type: 'agent:error';
      reqId?: string;
      agentId?: string;
      code: ErrorCode;
      message: string;
      retryable: boolean;
      detail?: unknown;
    }
  | ({ type: 'agent:meta'; agentId: string } & AgentMetaPayload)
  | { type: 'agent:gate'; agentId: string; gateId: string; prompt: string; expiresAt?: number };

export type AgentPatch = Partial<Pick<Agent, 'name' | 'tags' | 'group' | 'meta' | 'capabilities'>>;
