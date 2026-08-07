import React from 'react';
import { LayoutGrid, Maximize2, Layers, Plus, Search } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

interface ToolbarProps {
  onOpenAddModal: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenAddModal }) => {
  const { layoutMode, setLayoutMode, searchQuery, setSearchQuery } = useAgentStore();

  return (
    <div className="h-12 bg-[#090d16] border-b border-slate-800/80 flex items-center px-4 justify-between gap-4 select-none">
      {/* Search Input */}
      <div className="relative flex-1 max-w-xs">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search agents by name or host..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#0d1322] border border-slate-800 rounded-md pl-9 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
        />
      </div>

      {/* Layout Presets */}
      <div className="flex items-center gap-1 bg-[#0d1322] p-1 border border-slate-800 rounded-md">
        <button
          onClick={() => setLayoutMode('grid')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
            layoutMode === 'grid'
              ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Auto Grid Layout"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Grid
        </button>
        <button
          onClick={() => setLayoutMode('focus')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
            layoutMode === 'focus'
              ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Focus Mode"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Focus
        </button>
        <button
          onClick={() => setLayoutMode('cascade')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
            layoutMode === 'cascade'
              ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Floating Cascade"
        >
          <Layers className="w-3.5 h-3.5" />
          Cascade
        </button>
      </div>

      {/* Add Agent Button */}
      <button
        onClick={onOpenAddModal}
        className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-bold px-3 py-1.5 rounded-md text-xs shadow-md shadow-cyan-950/50 transition active:scale-95"
      >
        <Plus className="w-4 h-4 stroke-[3]" />
        New Agent
      </button>
    </div>
  );
};
