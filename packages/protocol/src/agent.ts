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
