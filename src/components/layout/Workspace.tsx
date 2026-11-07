import React, { useRef, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { FloatingPane } from './FloatingPane';

export const Workspace: React.FC = () => {
  const { agents, layoutMode, searchQuery, arrangeGrid, arrangeCascade, arrangeFocus } = useAgentStore();
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.targetHost.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Auto-arrange window layout whenever layout mode or agent count changes
  useEffect(() => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const w = clientWidth || window.innerWidth || 1200;
    const h = clientHeight || window.innerHeight - 100 || 750;

    if (layoutMode === 'grid') {
      arrangeGrid(w, h);
    } else if (layoutMode === 'cascade') {
      arrangeCascade(w, h);
    } else if (layoutMode === 'focus') {
      arrangeFocus(undefined, w, h);
    }
  }, [layoutMode, agents.length]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#090d16] p-3">
      {agents.length === 0 ? (
        <div
          data-testid="empty-roster"
          className="h-full flex flex-col items-center justify-center text-slate-500 gap-2"
        >
          <p className="text-sm font-mono">No agents yet. Use Add Agent to start one.</p>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
          <p className="text-sm font-mono">No agents found matching "{searchQuery}"</p>
        </div>
      ) : (
        filteredAgents.map((agent) => (
          <FloatingPane key={agent.id} agent={agent} />
        ))
      )}
    </div>
  );
};
