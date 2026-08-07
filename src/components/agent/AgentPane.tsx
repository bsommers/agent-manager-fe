import React from 'react';
import { Agent } from '../../types/agent';
import { TerminalView } from './TerminalView';
import { AgentControls } from './AgentControls';
import { useAgentStore } from '../../store/agentStore';

interface AgentPaneProps {
  agent: Agent;
}

export const AgentPane: React.FC<AgentPaneProps> = ({ agent }) => {
  const { activeAgentId, setActiveAgentId } = useAgentStore();
  const isActive = activeAgentId === agent.id;

  const statusColor = {
    running: 'bg-emerald-500 shadow-emerald-500/50',
    thinking: 'bg-amber-500 shadow-amber-500/50 animate-pulse',
    idle: 'bg-slate-500',
    error: 'bg-red-500 shadow-red-500/50',
    disconnected: 'bg-slate-600',
  }[agent.status];

  return (
    <div
      onClick={() => setActiveAgentId(agent.id)}
      className={`h-full w-full flex flex-col bg-[#0d1322] border rounded-lg overflow-hidden transition-all duration-150 ${
        isActive
          ? 'border-cyan-500/80 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Header bar */}
      <div className="flex items-center px-3 py-2 bg-[#131b2e] border-b border-slate-800/80 select-none">
        <span className={`w-2 h-2 rounded-full mr-2.5 shadow-sm ${statusColor}`} />
        <span className="font-semibold text-xs text-slate-200 truncate mr-2">
          {agent.name}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 uppercase">
          {agent.mode}
        </span>
        <span className="ml-auto text-[10px] font-mono text-slate-500 truncate max-w-[140px]">
          {agent.targetHost}
        </span>
      </div>

      {/* Terminal Container */}
      <div className="flex-1 min-h-[160px] relative">
        <TerminalView
          agentId={agent.id}
          agentName={agent.name}
          mode={agent.mode}
          targetHost={agent.targetHost}
          isActive={isActive}
        />
      </div>

      {/* Quick Action Footer */}
      <AgentControls agentId={agent.id} isFloating={agent.layout.isFloating} />
    </div>
  );
};
