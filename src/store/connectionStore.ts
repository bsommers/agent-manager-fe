import { create } from 'zustand';
import { INITIAL_SNAPSHOT, type BackendMode, type ConnSnapshot } from '../services/adapters/types';

export interface ConnectionState extends ConnSnapshot {
  mode: BackendMode;
  applySnapshot: (snapshot: ConnSnapshot) => void;
  setMode: (mode: BackendMode) => void;
  reset: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  mode: 'live',
  ...INITIAL_SNAPSHOT,
  applySnapshot: (s) =>
    set({
      state: s.state,
      attempt: s.attempt,
      nextRetryAt: s.nextRetryAt,
      lastError: s.lastError,
      lastConnectedAt: s.lastConnectedAt,
      malformedFrames: s.malformedFrames,
    }),
  setMode: (mode) => set({ mode }),
  reset: () => set({ mode: 'live', ...INITIAL_SNAPSHOT }),
}));
