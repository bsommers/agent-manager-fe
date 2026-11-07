import React from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import type { ConnState } from '../../services/adapters/types';

type Tone = 'healthy' | 'transitional' | 'failed' | 'demo';

const TONE_CLASSES: Record<Tone, { pill: string; dot: string }> = {
  healthy: {
    pill: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
    dot: 'bg-emerald-400',
  },
  transitional: {
    pill: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
    dot: 'bg-amber-400 animate-pulse',
  },
  failed: {
    pill: 'bg-red-950/60 text-red-300 border-red-800/60',
    dot: 'bg-red-400',
  },
  demo: {
    pill: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
    dot: 'bg-amber-400',
  },
};

function describe(state: ConnState, attempt: number): { label: string; tone: Tone } {
  switch (state) {
    case 'open':
      return { label: 'Connected', tone: 'healthy' };
    case 'connecting':
      return { label: 'Connecting', tone: 'transitional' };
    case 'reconnecting':
      return { label: `Reconnecting (attempt ${attempt})`, tone: 'transitional' };
    case 'closed':
      return { label: 'Disconnected', tone: 'failed' };
    case 'auth_failed':
      return { label: 'Auth failed', tone: 'failed' };
  }
}

export const ConnectionStatusChip: React.FC = () => {
  const mode = useConnectionStore((s) => s.mode);
  const state = useConnectionStore((s) => s.state);
  const attempt = useConnectionStore((s) => s.attempt);

  const isDemo = mode === 'demo';
  const { label, tone } = isDemo
    ? { label: 'DEMO', tone: 'demo' as Tone }
    : describe(state, attempt);
  const title = isDemo
    ? 'Demo mode: terminal output is simulated and no backend is connected'
    : `Backend connection: ${label}`;
  const classes = TONE_CLASSES[tone];

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="connection-chip"
      data-state={state}
      data-mode={mode}
      title={title}
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-mono text-[11px] ${classes.pill}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${classes.dot}`} />
      {label}
    </span>
  );
};
