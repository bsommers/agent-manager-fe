import React, { useRef, useState } from 'react';
import { X, Server, Terminal } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { AgentMode } from '../../types/agent';
import { useModalFocus } from '../../hooks/useModalFocus';

interface AddAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddAgentModal: React.FC<AddAgentModalProps> = ({ isOpen, onClose }) => {
  const { addAgent } = useAgentStore();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<AgentMode>('tmux');
  const [targetHost, setTargetHost] = useState('');

  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalFocus<HTMLDivElement>({ isOpen, onClose, initialFocusRef: nameInputRef });
  const titleId = React.useId();
  const nameId = React.useId();
  const targetId = React.useId();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetHost.trim()) return;

    addAgent(name.trim(), mode, targetHost.trim());
    setName('');
    setTargetHost('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[500] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md bg-[#0d1322] border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#131b2e]">
          <h3 id={titleId} className="font-bold text-sm text-slate-200">Register New AI Agent</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs">
          <div>
            <label htmlFor={nameId} className="block text-slate-400 mb-1 font-medium">Agent Name</label>
            <input
              id={nameId}
              ref={nameInputRef}
              type="text"
              required
              placeholder="e.g. Code Review Worker"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#090d16] border border-slate-800 rounded-md px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={mode === 'tmux'}
                onClick={() => setMode('tmux')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-md border text-xs font-semibold transition ${
                  mode === 'tmux'
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300'
                    : 'border-slate-800 bg-[#090d16] text-slate-400 hover:border-slate-700'
                }`}
              >
                <Terminal className="w-4 h-4" />
                Local Tmux
              </button>
              <button
                type="button"
                aria-pressed={mode === 'ssh'}
                onClick={() => setMode('ssh')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-md border text-xs font-semibold transition ${
                  mode === 'ssh'
                    ? 'border-purple-500 bg-purple-950/40 text-purple-300'
                    : 'border-slate-800 bg-[#090d16] text-slate-400 hover:border-slate-700'
                }`}
              >
                <Server className="w-4 h-4" />
                Remote SSH
              </button>
            </div>
          </div>

          <div>
            <label htmlFor={targetId} className="block text-slate-400 mb-1 font-medium">
              {mode === 'tmux' ? 'Tmux Session Name' : 'SSH Target (user@host:port)'}
            </label>
            <input
              id={targetId}
              type="text"
              required
              placeholder={mode === 'tmux' ? 'localhost:tmux_session_2' : 'root@10.0.0.45:22'}
              value={targetHost}
              onChange={(e) => setTargetHost(e.target.value)}
              className="w-full bg-[#090d16] border border-slate-800 rounded-md px-3 py-2 text-slate-100 placeholder-slate-600 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 font-semibold text-slate-950"
            >
              Start Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
