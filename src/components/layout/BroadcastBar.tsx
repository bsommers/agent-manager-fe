import React, { useState, useMemo, useEffect } from 'react';
import { Radio, Send, Terminal, AlertTriangle, CheckSquare, Square } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { agentSocket } from '../../services/agentSocket';
import { Agent } from '../../types/agent';
import { DestructiveSafetyModal } from './DestructiveSafetyModal';

export type TargetMode = 'All' | 'Filtered' | 'Selected';

export const DESTRUCTIVE_REGEX = /rm\s|-rf|sudo|kill|drop|shutdown|reboot/i;

export const isDestructiveCommand = (command: string): boolean => {
  return DESTRUCTIVE_REGEX.test(command);
};

export const BroadcastBar: React.FC = () => {
  const { agents, searchQuery, activeAgentId } = useAgentStore();
  const [targetMode, setTargetMode] = useState<TargetMode>('All');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [isSafetyModalOpen, setIsSafetyModalOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  // Sync selectedAgentIds if empty and activeAgentId is present
  useEffect(() => {
    if (selectedAgentIds.length === 0 && agents.length > 0) {
      setSelectedAgentIds(activeAgentId ? [activeAgentId] : [agents[0].id]);
    }
  }, [agents, activeAgentId, selectedAgentIds.length]);

  const targetAgents: Agent[] = useMemo(() => {
    if (targetMode === 'All') {
      return agents;
    }
    if (targetMode === 'Filtered') {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return agents;
      return agents.filter(
        (a) => a.name.toLowerCase().includes(q) || a.targetHost.toLowerCase().includes(q)
      );
    }
    if (targetMode === 'Selected') {
      if (selectedAgentIds.length > 0) {
        return agents.filter((a) => selectedAgentIds.includes(a.id));
      }
      if (activeAgentId) {
        return agents.filter((a) => a.id === activeAgentId);
      }
      return [];
    }
    return agents;
  }, [agents, targetMode, searchQuery, selectedAgentIds, activeAgentId]);

  const toggleAgentSelection = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const executeSend = (cmd: string, targets: Agent[]) => {
    if (!cmd.trim() || targets.length === 0) return;
    const targetAgentIds = targets.map((a) => a.id);
    agentSocket.send({
      type: 'agent:broadcast',
      targetAgentIds,
      data: cmd + '\r',
    });
    setCommand('');
    setPendingCommand(null);
  };

  const handleBroadcast = () => {
    const trimmed = command.trim();
    if (!trimmed || targetAgents.length === 0) return;

    if (isDestructiveCommand(trimmed)) {
      setPendingCommand(trimmed);
      setIsSafetyModalOpen(true);
    } else {
      executeSend(trimmed, targetAgents);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleBroadcast();
    }
  };

  const handleModalConfirm = () => {
    if (pendingCommand) {
      executeSend(pendingCommand, targetAgents);
    }
    setIsSafetyModalOpen(false);
  };

  const handleModalCancel = () => {
    setIsSafetyModalOpen(false);
    setPendingCommand(null);
  };

  return (
    <div className="w-full bg-[#080d19] border-b border-cyan-900/40 p-2.5 flex flex-col gap-2 transition-all">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Mode Selection + Target Count */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#0d1424] p-0.5 border border-slate-800 rounded-lg text-xs">
            {(['All', 'Filtered', 'Selected'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTargetMode(mode)}
                className={`px-2.5 py-1 rounded-md font-medium transition text-xs flex items-center gap-1 ${
                  targetMode === mode
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {mode === 'All' && <Radio className="w-3 h-3 text-cyan-400" />}
                {mode}
              </button>
            ))}
          </div>

          {/* Target Count Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-950/40 border border-cyan-800/40 text-[11px] font-mono text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>
              {targetAgents.length} {targetAgents.length === 1 ? 'agent' : 'agents'} targeted
            </span>
          </div>
        </div>

        {/* Selected Mode Quick Toggles */}
        {targetMode === 'Selected' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {agents.map((agent) => {
              const isSelected = selectedAgentIds.includes(agent.id);
              return (
                <label
                  key={agent.id}
                  className={`cursor-pointer flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition ${
                    isSelected
                      ? 'bg-cyan-950/70 border-cyan-600/70 text-cyan-300'
                      : 'bg-slate-900/50 border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={agent.name}
                    checked={isSelected}
                    onChange={() => toggleAgentSelection(agent.id)}
                    className="sr-only"
                  />
                  {isSelected ? (
                    <CheckSquare className="w-3 h-3 text-cyan-400 shrink-0" />
                  ) : (
                    <Square className="w-3 h-3 text-slate-600 shrink-0" />
                  )}
                  <span>{agent.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Terminal className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cyan-500/70" />
          <input
            type="text"
            placeholder="Broadcast command to targeted sessions (e.g. ls, git status, uptime)..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-[#0d1424] border border-cyan-900/50 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 transition"
          />
        </div>

        <button
          type="button"
          onClick={handleBroadcast}
          disabled={!command.trim() || targetAgents.length === 0}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm ${
            !command.trim() || targetAgents.length === 0
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
              : isDestructiveCommand(command)
              ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-950/60 active:scale-95'
              : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-cyan-950/60 active:scale-95'
          }`}
        >
          {isDestructiveCommand(command) ? (
            <AlertTriangle className="w-3.5 h-3.5 text-white" />
          ) : (
            <Send className="w-3.5 h-3.5 stroke-[2.5]" />
          )}
          Broadcast
        </button>
      </div>

      {/* Safety Confirmation Modal */}
      <DestructiveSafetyModal
        isOpen={isSafetyModalOpen}
        command={pendingCommand || command}
        targetAgents={targetAgents}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />
    </div>
  );
};
