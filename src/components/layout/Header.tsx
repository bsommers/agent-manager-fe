import React from 'react';
import { Cpu, Activity } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

export const Header: React.FC = () => {
  const { agents } = useAgentStore();

  const activeCount = agents.filter((a) => a.status === 'running').length;
  const thinkingCount = agents.filter((a) => a.status === 'thinking').length;
  const sshCount = agents.filter((a) => a.mode === 'ssh').length;
  const tmuxCount = agents.filter((a) => a.mode === 'tmux').length;

  return (
    <header className="h-14 bg-[#0d1322] border-b border-slate-800 flex items-center px-4 justify-between select-none">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
          <Cpu className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-sm text-slate-100 tracking-wide flex items-center gap-2">
            AI AGENT COMMAND CENTER
            <span className="text-[10px] px-1.5 py-0.2 font-mono bg-cyan-950 text-cyan-400 border border-cyan-800 rounded">
              v1.0
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">Multi-agent terminal operation dashboard</p>
        </div>
      </div>

      {/* Global Status Counters */}
      <div className="flex items-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="text-slate-400">Active:</span>
          <span className="font-mono font-semibold text-slate-200">{activeCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-slate-400">Thinking:</span>
          <span className="font-mono font-semibold text-slate-200">{thinkingCount}</span>
        </div>
        <div className="h-4 w-[1px] bg-slate-800" />
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/60">
            SSH: {sshCount}
          </span>
          <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
            TMUX: {tmuxCount}
          </span>
        </div>
      </div>
    </header>
  );
};
