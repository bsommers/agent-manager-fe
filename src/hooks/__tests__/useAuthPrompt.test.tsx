import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useAuthPrompt } from '../useAuthPrompt';
import { useConnectionStore } from '../../store/connectionStore';
import { useUiStore, resetUiStore } from '../../store/uiStore';

const Probe: React.FC = () => {
  useAuthPrompt();
  return null;
};

afterEach(() => {
  cleanup();
  resetUiStore();
  useConnectionStore.setState({ mode: 'demo', state: 'open' });
});

const setConn = (patch: Partial<{ mode: 'live' | 'demo'; state: 'open' | 'closed' | 'auth_failed' | 'connecting' }>) =>
  act(() => {
    useConnectionStore.setState(patch);
  });

describe('useAuthPrompt', () => {
  it('opens the token overlay on a live transition into auth_failed', () => {
    useConnectionStore.setState({ mode: 'live', state: 'connecting' });
    render(<Probe />);
    expect(useUiStore.getState().overlay).toBeNull();
    setConn({ state: 'auth_failed' });
    expect(useUiStore.getState().overlay).toBe('token');
  });

  it('does not open for other state transitions', () => {
    useConnectionStore.setState({ mode: 'live', state: 'connecting' });
    render(<Probe />);
    setConn({ state: 'open' });
    setConn({ state: 'closed' });
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it('stays dismissed while the state stays auth_failed, reopens on the next transition into it', () => {
    useConnectionStore.setState({ mode: 'live', state: 'connecting' });
    render(<Probe />);
    setConn({ state: 'auth_failed' });
    act(() => useUiStore.getState().closeOverlay('token'));
    expect(useUiStore.getState().overlay).toBeNull();
    // unrelated store change, state unchanged
    act(() => {
      useConnectionStore.setState({ lastError: 'x' });
    });
    expect(useUiStore.getState().overlay).toBeNull();
    setConn({ state: 'connecting' });
    setConn({ state: 'auth_failed' });
    expect(useUiStore.getState().overlay).toBe('token');
  });

  it('opens at mount when a live connection is already auth_failed', () => {
    useConnectionStore.setState({ mode: 'live', state: 'auth_failed' });
    render(<Probe />);
    expect(useUiStore.getState().overlay).toBe('token');
  });

  it('never opens in demo mode', () => {
    useConnectionStore.setState({ mode: 'demo', state: 'connecting' });
    render(<Probe />);
    setConn({ state: 'auth_failed' });
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it('stops listening after unmount', () => {
    useConnectionStore.setState({ mode: 'live', state: 'connecting' });
    const { unmount } = render(<Probe />);
    unmount();
    setConn({ state: 'auth_failed' });
    expect(useUiStore.getState().overlay).toBeNull();
  });
});
