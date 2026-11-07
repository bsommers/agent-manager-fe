import React from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { Agent } from '../../types/agent';
import { useModalFocus } from '../../hooks/useModalFocus';

export interface DestructiveSafetyModalProps {
  isOpen: boolean;
  command: string;
  targetAgents: Agent[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const DestructiveSafetyModal: React.FC<DestructiveSafetyModalProps> = ({
  isOpen,
  command,
  targetAgents,
  onConfirm,
  onCancel,
}) => {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = useModalFocus<HTMLDivElement>({
    isOpen,
    onClose: onCancel,
    initialFocusRef: cancelRef,
  });
  const titleId = React.useId();
  const descId = React.useId();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="bg-[#0e1424] border border-red-500/40 rounded-xl shadow-2xl shadow-red-950/50 w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-red-950/50 via-[#131a2e] to-[#0e1424] border-b border-red-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-sm font-bold text-red-200 tracking-wide flex items-center gap-2">
                Destructive Command Warning
              </h2>
              <p className="text-xs text-red-400/80">
                Potentially destructive operations detected in broadcast payload
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {/* Warning Banner */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/30 border border-red-900/50 text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <span id={descId}>
              This command will be sent simultaneously to{' '}
              <strong className="text-red-200 font-bold">{targetAgents.length}</strong>{' '}
              targeted agent session{targetAgents.length === 1 ? '' : 's'}. Are you sure you want to execute?
            </span>
          </div>

          {/* Raw Command Code Box */}
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Command Payload
            </div>
            <pre className="p-3 bg-[#070b14] border border-red-900/40 rounded-lg text-red-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all select-all">
              {command}
            </pre>
          </div>

          {/* Target Agents List */}
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Targeted Sessions ({targetAgents.length})
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2 bg-[#070b14]/60 border border-slate-800 rounded-lg">
              {targetAgents.map((agent) => (
                <span
                  key={agent.id}
                  className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[11px] font-mono flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  {agent.name}
                  <span className="text-slate-500 text-[10px]">({agent.targetHost})</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 bg-[#090d18] border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-500 shadow-md shadow-red-950/60 transition active:scale-95"
          >
            Confirm Broadcast
          </button>
        </div>
      </div>
    </div>
  );
};
