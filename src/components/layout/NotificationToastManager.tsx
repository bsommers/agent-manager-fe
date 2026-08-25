import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, WifiOff, X } from 'lucide-react';
import { agentSocket } from '../../services/agentSocket';
import { useAgentStore } from '../../store/agentStore';
import { AgentStatus } from '../../types/agent';

export interface StatusToast {
  id: string;
  agentId: string;
  agentName: string;
  status: 'error' | 'disconnected';
  timestamp: number;
  message: string;
}

const TOAST_DURATION_MS = 5000;

export const NotificationToastManager: React.FC = () => {
  const [toasts, setToasts] = useState<StatusToast[]>([]);
  const timerMapRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = (id: string) => {
    const timer = timerMapRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timerMapRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleToastClick = (agentId: string) => {
    useAgentStore.getState().bringToFront(agentId);
  };

  useEffect(() => {
    const unsubscribe = agentSocket.subscribe((msg) => {
      if (msg.type === 'agent:status_change') {
        const { agentId, status } = msg;

        // Sync status in agentStore
        useAgentStore.setState((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId ? { ...a, status, lastActivity: Date.now() } : a
          ),
        }));

        // Trigger alert toasts only for error or disconnected
        if (status === 'error' || status === 'disconnected') {
          const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
          const agentName = agent ? agent.name : agentId;
          const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

          const message =
            status === 'error'
              ? 'Agent encountered a critical execution error'
              : 'Agent session connection disconnected';

          const newToast: StatusToast = {
            id: toastId,
            agentId,
            agentName,
            status,
            timestamp: Date.now(),
            message,
          };

          setToasts((prev) => [...prev, newToast]);

          const timer = setTimeout(() => {
            dismissToast(toastId);
          }, TOAST_DURATION_MS);

          timerMapRef.current.set(toastId, timer);
        }
      }
    });

    return () => {
      unsubscribe();
      timerMapRef.current.forEach((timer) => clearTimeout(timer));
      timerMapRef.current.clear();
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="fixed top-14 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const isError = toast.status === 'error';
        return (
          <div
            key={toast.id}
            data-testid={`toast-${toast.status}-${toast.agentId}`}
            onClick={() => handleToastClick(toast.agentId)}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-lg border backdrop-blur-md shadow-2xl transition-all duration-300 cursor-pointer ${
              isError
                ? 'border-rose-500/40 bg-slate-900/95 text-slate-100 shadow-rose-950/50 hover:border-rose-500/70'
                : 'border-amber-500/40 bg-slate-900/95 text-slate-100 shadow-amber-950/50 hover:border-amber-500/70'
            }`}
          >
            <div
              className={`p-2 rounded-md shrink-0 ${
                isError
                  ? 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/30'
                  : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
              }`}
            >
              {isError ? <AlertCircle className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            </div>

            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-sm text-slate-100 truncate">
                  {toast.agentName}
                </span>
                <span
                  className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${
                    isError
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {isError ? 'Error' : 'Disconnected'}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-snug">{toast.message}</p>
            </div>

            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              className="text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 p-1 rounded transition-colors shrink-0 -mr-1 -mt-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
