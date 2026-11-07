import React, { useEffect, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { agentSocket } from '../../services/agentSocket';

function secondsUntil(nextRetryAt: number | null): number {
  if (nextRetryAt === null) return 0;
  return Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000));
}

const BASE = 'flex items-center gap-3 px-4 py-1.5 text-xs border-b';
const AMBER = `${BASE} bg-amber-950/40 text-amber-200 border-amber-800/60`;
const RED = `${BASE} bg-red-950/40 text-red-200 border-red-800/60`;
const BTN =
  'px-2 py-0.5 rounded border border-current font-medium hover:bg-white/10 transition';

export const ConnectionBanner: React.FC = () => {
  const mode = useConnectionStore((s) => s.mode);
  const state = useConnectionStore((s) => s.state);
  const attempt = useConnectionStore((s) => s.attempt);
  const nextRetryAt = useConnectionStore((s) => s.nextRetryAt);
  const lastError = useConnectionStore((s) => s.lastError);

  const reconnecting = mode === 'live' && state === 'reconnecting';
  const [seconds, setSeconds] = useState(() => secondsUntil(nextRetryAt));

  useEffect(() => {
    if (!reconnecting) return;
    setSeconds(secondsUntil(nextRetryAt));
    const id = setInterval(() => setSeconds(secondsUntil(nextRetryAt)), 1000);
    return () => clearInterval(id);
  }, [reconnecting, nextRetryAt]);

  if (mode === 'demo') {
    return (
      <div role="status" className={AMBER}>
        <strong>Demo mode</strong>
        <span>terminals show simulated output and no backend is connected</span>
      </div>
    );
  }

  if (state === 'reconnecting') {
    return (
      <div role="status" className={AMBER}>
        <strong>Connection lost</strong>
        <span>
          retrying in {seconds}s (attempt {attempt})
        </span>
        <button type="button" className={BTN} onClick={() => agentSocket.reconnect()}>
          Retry now
        </button>
      </div>
    );
  }

  if (state === 'closed') {
    return (
      <div role="alert" className={RED}>
        <strong>Disconnected from backend</strong>
        {lastError && <span>{lastError}</span>}
        <button type="button" className={BTN} onClick={() => agentSocket.reconnect()}>
          Reconnect
        </button>
      </div>
    );
  }

  if (state === 'auth_failed') {
    return (
      <div role="alert" className={RED}>
        <strong>Authentication failed</strong>
        {lastError && <span>{lastError}</span>}
      </div>
    );
  }

  return null;
};
