import { describe, it, expect, beforeEach } from 'vitest';
import { useConnectionStore } from '../connectionStore';

describe('connectionStore', () => {
  beforeEach(() => useConnectionStore.getState().reset());

  it('starts live and connecting', () => {
    const s = useConnectionStore.getState();
    expect(s.mode).toBe('live');
    expect(s.state).toBe('connecting');
  });

  it('applySnapshot copies every field', () => {
    const snap = {
      state: 'reconnecting' as const,
      attempt: 3,
      nextRetryAt: 123,
      lastError: 'e',
      lastConnectedAt: 99,
      malformedFrames: 4,
    };
    useConnectionStore.getState().applySnapshot(snap);
    expect(useConnectionStore.getState()).toMatchObject(snap);
  });

  it('setMode and reset', () => {
    useConnectionStore.getState().setMode('demo');
    expect(useConnectionStore.getState().mode).toBe('demo');
    useConnectionStore.getState().applySnapshot({
      state: 'open', attempt: 1, nextRetryAt: null, lastError: null, lastConnectedAt: 1, malformedFrames: 0,
    });
    useConnectionStore.getState().reset();
    expect(useConnectionStore.getState()).toMatchObject({ mode: 'live', state: 'connecting', attempt: 0 });
  });
});
