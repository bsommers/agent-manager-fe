import React, { useEffect, useRef } from 'react';
import { LayoutGrid, Maximize2, Layers, Plus, Search, Radio } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { BroadcastBar } from './BroadcastBar';
import { useUiStore } from '../../store/uiStore';
import { useFocusRequest } from '../../keyboard/hooks';

interface ToolbarProps {
  onOpenAddModal: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenAddModal }) => {
  const { layoutMode, arrangeGrid, arrangeFocus, arrangeCascade, searchQuery, setSearchQuery } = useAgentStore();
  const showBroadcast = useUiStore((s) => s.isBroadcastOpen);
  const setBroadcastOpen = useUiStore((s) => s.setBroadcastOpen);
  const filterRef = useRef<HTMLInputElement>(null);
  const broadcastRef = useRef<HTMLDivElement>(null);

  useFocusRequest('agent-filter', () => filterRef.current?.focus());
  useFocusRequest('broadcast', () => broadcastRef.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus());

  // Do not leak the broadcast flag across mounts.
  useEffect(() => () => useUiStore.getState().setBroadcastOpen(false), []);

  return (
    <div className="flex flex-col select-none">
      <div className="h-12 bg-[#090d16] border-b border-slate-800/80 flex items-center px-4 justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            ref={filterRef}
            type="text"
            aria-label="Filter agents by name or host"
            placeholder="Search agents by name or host..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0d1322] border border-slate-800 rounded-md pl-9 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
          />
        </div>

        {/* Layout Presets */}
        <div className="flex items-center gap-1 bg-[#0d1322] p-1 border border-slate-800 rounded-md">
          <button
            type="button"
            aria-pressed={layoutMode === 'grid'}
            onClick={() => arrangeGrid()}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
              layoutMode === 'grid'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Snap to Grid"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Grid
          </button>
          <button
            type="button"
            aria-pressed={layoutMode === 'focus'}
            onClick={() => arrangeFocus()}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
              layoutMode === 'focus'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Focus Layout"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Focus
          </button>
          <button
            type="button"
            aria-pressed={layoutMode === 'cascade'}
            onClick={() => arrangeCascade()}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
              layoutMode === 'cascade'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Cascade Layout"
          >
            <Layers className="w-3.5 h-3.5" />
            Cascade
          </button>
        </div>

        {/* Right action buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={showBroadcast}
            onClick={() => setBroadcastOpen(!showBroadcast)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition ${
              showBroadcast
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                : 'bg-[#0d1322] text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-800'
            }`}
            title="Toggle Command Fan-Out Broadcast Bar"
          >
            <Radio className={`w-3.5 h-3.5 ${showBroadcast ? 'text-cyan-400 animate-pulse' : 'text-slate-500'}`} />
            Broadcast
          </button>

          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-bold px-3 py-1.5 rounded-md text-xs shadow-md shadow-cyan-950/50 transition active:scale-95"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            New Agent
          </button>
        </div>
      </div>

      {/* Broadcast Bar Collapsible Section */}
      {showBroadcast && (
        <div ref={broadcastRef}>
          <BroadcastBar />
        </div>
      )}
    </div>
  );
};
