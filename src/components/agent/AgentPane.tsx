import React from 'react';
import { Agent } from '../../types/agent';
import { TerminalView } from './TerminalView';
import { AgentControls } from './AgentControls';
import { useAgentStore } from '../../store/agentStore';

interface AgentPaneProps {
  agent: Agent;
}

export const AgentPane: React.FC<AgentPaneProps> = ({ agent }) => {
  const { activeAgentId, setActiveAgentId, removeAgent } = useAgentStore();
  const isPending = useAgentStore((s) => Object.prototype.hasOwnProperty.call(s.pending, agent.id));
  const isClosing = useAgentStore((s) => Object.prototype.hasOwnProperty.call(s.killing, agent.id));
  const isActive = activeAgentId === agent.id;

  const statusColor = {
    running: 'bg-emerald-500 shadow-emerald-500/50',
    thinking: 'bg-amber-500 shadow-amber-500/50 animate-pulse',
    idle: 'bg-slate-500',
    error: 'bg-red-500 shadow-red-500/50',
    disconnected: 'bg-slate-600',
  }[agent.status];
  // A pending agent's status field is only a technical idle; show it as starting.
  const dotClass = isPending ? 'bg-cyan-500 shadow-cyan-500/50 animate-pulse' : statusColor;

  return (
    <div
      role="group"
      aria-label={`Agent ${agent.name}`}
      onClick={() => setActiveAgentId(agent.id)}
      className={`h-full w-full flex flex-col bg-[#0d1322] border rounded-lg overflow-hidden transition-all duration-150 ${
        isActive
          ? 'border-cyan-500/80 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Header bar */}
      <div className="flex items-center px-3 py-2 bg-[#131b2e] border-b border-slate-800/80 select-none">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full mr-2.5 shadow-sm ${dotClass}`} />
        <span className="font-semibold text-xs text-slate-200 truncate mr-2">
          {agent.name}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 uppercase">
          {agent.mode}
        </span>
        {!isPending && (
          <span
            data-testid="pane-status"
            data-status={agent.status}
            className="ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800 uppercase"
          >
            <span className="sr-only">Status: </span>
            {agent.status}
          </span>
        )}
        {isPending && (
          <span
            data-testid="pane-state-starting"
            className="ml-1.5 text-[10px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 uppercase"
          >
            Starting
          </span>
        )}
        {isClosing && (
          <span
            data-testid="pane-state-closing"
            className="ml-1.5 text-[10px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 uppercase"
          >
            Closing
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-slate-500 truncate max-w-[140px]">
          {agent.targetHost}
        </span>
      </div>

      {isPending ? (
        <>
          <div
            role="status"
            className="flex-1 min-h-[160px] flex flex-col items-center justify-center gap-1 text-slate-400"
          >
            <p className="text-sm font-mono text-slate-200">Starting {agent.name}</p>
            <p className="text-xs font-mono text-slate-500">Waiting for the backend to confirm</p>
          </div>
          <div className="flex items-center justify-end px-3 py-2 bg-[#131b2e] border-t border-slate-800/80">
            <button
              type="button"
              aria-label={`Cancel starting ${agent.name}`}
              onClick={() => removeAgent(agent.id)}
              className="text-xs font-mono px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
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
          <AgentControls
            agentId={agent.id}
            agentName={agent.name}
            isFloating={agent.layout.isFloating}
          />
        </>
      )}
    </div>
  );
};
