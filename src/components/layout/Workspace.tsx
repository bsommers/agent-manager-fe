import React from 'react';
import { useAgentStore } from '../../store/agentStore';
import { AgentPane } from '../agent/AgentPane';
import { FloatingPane } from './FloatingPane';

export const Workspace: React.FC = () => {
  const { agents, layoutMode, searchQuery, activeAgentId } = useAgentStore();

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.targetHost.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const dockedAgents = filteredAgents.filter((a) => !a.layout.isFloating);
  const floatingAgents = filteredAgents.filter((a) => a.layout.isFloating);

  // Focus layout mode logic
  const activeFocusedAgent = dockedAgents.find((a) => a.id === activeAgentId) || dockedAgents[0];
  const sideStripAgents = dockedAgents.filter((a) => a.id !== activeFocusedAgent?.id);

  return (
    <div className="flex-1 relative overflow-hidden bg-[#090d16] p-3">
      {/* Docked Grid View Layer */}
      {layoutMode === 'grid' && (
        <div
          className={`h-full w-full grid gap-3 transition-all duration-200 ${
            dockedAgents.length <= 1
              ? 'grid-cols-1 grid-rows-1'
              : dockedAgents.length <= 2
              ? 'grid-cols-2 grid-rows-1'
              : dockedAgents.length <= 4
              ? 'grid-cols-2 grid-rows-2'
              : 'grid-cols-3 grid-rows-2'
          }`}
        >
          {dockedAgents.map((agent) => (
            <div key={agent.id} className="h-full w-full min-h-0 min-w-0">
              <AgentPane agent={agent} />
            </div>
          ))}
        </div>
      )}

      {/* Focus View Layer */}
      {layoutMode === 'focus' && (
        <div className="h-full w-full flex gap-3">
          <div className="flex-1 h-full min-w-0">
            {activeFocusedAgent ? (
              <AgentPane agent={activeFocusedAgent} />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                No agent selected for focus mode
              </div>
            )}
          </div>
          {sideStripAgents.length > 0 && (
            <div className="w-80 h-full flex flex-col gap-3 overflow-y-auto">
              {sideStripAgents.map((agent) => (
                <div key={agent.id} className="h-48 min-h-[190px]">
                  <AgentPane agent={agent} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cascade Layout Mode */}
      {layoutMode === 'cascade' && (
        <div className="h-full w-full relative">
          {dockedAgents.map((agent, idx) => (
            <div
              key={agent.id}
              style={{
                position: 'absolute',
                left: `${idx * 40 + 20}px`,
                top: `${idx * 40 + 20}px`,
                width: '640px',
                height: '380px',
                zIndex: idx + 10,
              }}
              className="shadow-2xl rounded-lg overflow-hidden border border-slate-700"
            >
              <AgentPane agent={agent} />
            </div>
          ))}
        </div>
      )}

      {/* Pop-Out Floating Windows Overlay Layer */}
      {floatingAgents.map((agent) => (
        <FloatingPane key={agent.id} agent={agent} />
      ))}
    </div>
  );
};
