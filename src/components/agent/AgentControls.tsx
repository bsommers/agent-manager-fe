import React from 'react';
import { Terminal, RefreshCw, Trash2, ArrowUpRight, Maximize2 } from 'lucide-react';
import { agentSocket } from '../../services/agentSocket';
import { useAgentStore } from '../../store/agentStore';

interface AgentControlsProps {
  agentId: string;
  isFloating: boolean;
}

export const AgentControls: React.FC<AgentControlsProps> = ({ agentId, isFloating }) => {
  const { toggleUndock, removeAgent } = useAgentStore();

  const handleCtrlC = () => {
    agentSocket.send({
      type: 'agent:input',
      agentId,
      data: '\x03', // SIGINT
    });
  };

  const handleClear = () => {
    agentSocket.send({
      type: 'agent:input',
      agentId,
      data: 'clear',
    });
  };

  return (
    <div className="flex items-center gap-1 bg-[#131b2e] border-t border-slate-800 px-3 py-1.5 text-xs text-slate-400">
      <button
        onClick={handleCtrlC}
        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 hover:text-white transition flex items-center gap-1 font-mono text-[11px]"
        title="Send SIGINT (Ctrl+C)"
      >
        Ctrl+C
      </button>
      <button
        onClick={handleClear}
        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 hover:text-white transition text-[11px]"
      >
        Clear
      </button>
      
      <div className="flex-1" />

      <button
        onClick={() => toggleUndock(agentId)}
        className="p-1 hover:text-cyan-400 transition rounded hover:bg-slate-800"
        title={isFloating ? 'Dock Window' : 'Pop out Floating Window'}
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => removeAgent(agentId)}
        className="p-1 hover:text-red-400 transition rounded hover:bg-slate-800"
        title="Close Agent"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
