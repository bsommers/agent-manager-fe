import React from 'react';
import { Trash2, ArrowUpRight, PowerOff } from 'lucide-react';
import { agentSocket } from '../../services/agentSocket';
import { useAgentStore } from '../../store/agentStore';
import { useConnectionStore } from '../../store/connectionStore';
import { DestructiveSafetyModal } from '../layout/DestructiveSafetyModal';

interface AgentControlsProps {
  agentId: string;
  isFloating: boolean;
  agentName?: string;
}

// Mirrors the gateway's rule (tmuxSessionNameOf): the part after the first colon,
// else the whole target. The gateway re-derives it from its own registry; this is display only.
const tmuxSessionNameOf = (targetHost: string): string => {
  const i = targetHost.indexOf(':');
  return i >= 0 ? targetHost.slice(i + 1) : targetHost;
};

export const AgentControls: React.FC<AgentControlsProps> = ({ agentId, isFloating, agentName }) => {
  const { toggleUndock, removeAgent } = useAgentStore();
  const agent = useAgentStore((s) => s.agents.find((a) => a.id === agentId));
  const isPending = useAgentStore((s) => Object.prototype.hasOwnProperty.call(s.pending, agentId));
  const isKilling = useAgentStore((s) => Object.prototype.hasOwnProperty.call(s.killing, agentId));
  const isLiveMode = useConnectionStore((s) => s.mode === 'live');
  const [confirmingKill, setConfirmingKill] = React.useState(false);
  const canKillSession = isLiveMode && !!agent && agent.mode === 'tmux' && !isPending && !isKilling;
  const sessionName = agent ? tmuxSessionNameOf(agent.targetHost) : '';

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
      data: 'clear\r',
    });
  };

  const suffix = agentName ? ` ${agentName}` : '';

  return (
    <div className="flex items-center gap-1 bg-[#131b2e] border-t border-slate-800 px-3 py-1.5 text-xs text-slate-400">
      <button
        type="button"
        aria-label={agentName ? `Send Ctrl+C to ${agentName}` : 'Send Ctrl+C'}
        onClick={handleCtrlC}
        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 hover:text-white transition flex items-center gap-1 font-mono text-[11px]"
        title="Send SIGINT (Ctrl+C)"
      >
        Ctrl+C
      </button>
      <button
        type="button"
        aria-label={agentName ? `Clear ${agentName} terminal` : 'Clear terminal'}
        onClick={handleClear}
        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 hover:text-white transition text-[11px]"
      >
        Clear
      </button>
      
      <div className="flex-1" />

      <button
        type="button"
        aria-label={isFloating ? `Dock${suffix}` : `Pop out${suffix} as floating window`}
        onClick={() => toggleUndock(agentId)}
        className="p-1 hover:text-cyan-400 transition rounded hover:bg-slate-800"
        title={isFloating ? 'Dock Window' : 'Pop out Floating Window'}
      >
        <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {canKillSession && (
        <button
          type="button"
          aria-label={agentName ? `Kill tmux session of ${agentName}` : 'Kill tmux session'}
          onClick={() => setConfirmingKill(true)}
          className="p-1 hover:text-red-400 transition rounded hover:bg-slate-800"
          title="Kill tmux session..."
        >
          <PowerOff className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        aria-label={`Close agent${suffix}`}
        onClick={() => removeAgent(agentId)}
        className="p-1 hover:text-red-400 transition rounded hover:bg-slate-800"
        title="Close Agent"
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {agent && (
        <DestructiveSafetyModal
          isOpen={confirmingKill && canKillSession}
          title="Kill tmux session"
          subtitle="This ends the session on the backend, not just the pane"
          body={
            <>
              This will end the tmux session{' '}
              <strong className="text-red-200 font-bold">{sessionName}</strong> used by agent{' '}
              <strong className="text-red-200 font-bold">{agent.name}</strong>. The session and everything running in it
              will be ended and this cannot be undone.
            </>
          }
          command={`tmux kill-session -t ${sessionName}`}
          commandLabel="Command the gateway will run"
          targetsLabel="Agent that will be removed"
          confirmLabel="Kill session"
          targetAgents={[agent]}
          onConfirm={() => {
            setConfirmingKill(false);
            removeAgent(agentId, { killSession: true, confirm: true });
          }}
          onCancel={() => setConfirmingKill(false)}
        />
      )}
    </div>
  );
};
