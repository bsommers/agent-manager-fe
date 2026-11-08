import type { AgentCapability } from './capabilities.js';

export type AgentMode = 'tmux' | 'ssh';
export type AgentKind = 'terminal' | 'sandbox' | 'pipeline';
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
  /** Additive, all optional. */
  kind?: AgentKind;
  backend?: string;
  capabilities?: AgentCapability[];
  tags?: string[];
  group?: string;
  meta?: Record<string, unknown>;
}
