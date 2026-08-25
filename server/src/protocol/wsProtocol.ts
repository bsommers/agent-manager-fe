export type AgentMode = 'tmux' | 'ssh';
export type AgentStatus = 'idle' | 'running' | 'thinking' | 'error' | 'disconnected';

export interface AgentLayout {
  isFloating: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  isMinimized?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  mode: AgentMode;
  targetHost: string;
  status: AgentStatus;
  unreadOutput: boolean;
  layout: AgentLayout;
  createdAt: number;
  lastActivity: number;
}

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
