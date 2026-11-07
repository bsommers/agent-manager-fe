import React, { useState, useEffect } from 'react';
import { Cpu, Activity, Search } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { GlobalSearchModal } from './GlobalSearchModal';
import { ConnectionStatusChip } from './ConnectionStatusChip';

export const Header: React.FC = () => {
  const { agents } = useAgentStore();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const activeCount = agents.filter((a) => a.status === 'running').length;
  const thinkingCount = agents.filter((a) => a.status === 'thinking').length;
  const sshCount = agents.filter((a) => a.mode === 'ssh').length;
  const tmuxCount = agents.filter((a) => a.mode === 'tmux').length;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
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

        {/* Header Right Actions & Metrics */}
        <div className="flex items-center gap-4">
          <ConnectionStatusChip />

          {/* Global Search Button */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#090d16] hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 transition text-xs shadow-sm group"
            title="Search across all agent output logs (Ctrl+Shift+F)"
          >
            <Search className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="font-medium">Global Search</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-slate-800/80 text-slate-400 border border-slate-700/80 rounded group-hover:border-slate-600">
              Ctrl+Shift+F
            </kbd>
          </button>

          <div className="h-4 w-[1px] bg-slate-800" />

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
        </div>
      </header>

      <GlobalSearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </>
  );
};
