import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ConnectionBanner } from '../ConnectionBanner';
import { useConnectionStore } from '../../../store/connectionStore';
import { agentSocket } from '../../../services/agentSocket';

let reconnectSpy: MockInstance<[], void>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  reconnectSpy = vi.spyOn(agentSocket, 'reconnect').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  useConnectionStore.getState().reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ConnectionBanner', () => {
  it('renders nothing when live and open', () => {
    useConnectionStore.setState({ mode: 'live', state: 'open' });
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when live and connecting', () => {
    useConnectionStore.setState({ mode: 'live', state: 'connecting' });
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the demo banner in demo mode', () => {
    useConnectionStore.setState({ mode: 'demo', state: 'open' });
    render(<ConnectionBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/Demo mode/i);
    expect(banner).toHaveTextContent(/simulated/i);
    expect(banner).toHaveTextContent(/no backend is connected/i);
  });

  it('shows reconnecting banner with a decreasing countdown and attempt number', () => {
    useConnectionStore.setState({
      mode: 'live',
      state: 'reconnecting',
      attempt: 2,
      nextRetryAt: Date.now() + 5000,
    });
    render(<ConnectionBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Connection lost');
    expect(banner).toHaveTextContent('5s');
    expect(banner).toHaveTextContent('attempt 2');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(banner).toHaveTextContent('3s');

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(banner).toHaveTextContent('0s');
    expect(banner.textContent).not.toMatch(/-\d+s/);
  });

  it('Retry now calls agentSocket.reconnect exactly once', () => {
    useConnectionStore.setState({
      mode: 'live',
      state: 'reconnecting',
      attempt: 1,
      nextRetryAt: Date.now() + 3000,
    });
    render(<ConnectionBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('shows closed alert with lastError and Reconnect button', () => {
    useConnectionStore.setState({ mode: 'live', state: 'closed', lastError: 'closed with code 1006' });
    render(<ConnectionBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Disconnected from backend');
    expect(alert).toHaveTextContent('closed with code 1006');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('shows auth_failed alert without a retry button', () => {
    useConnectionStore.setState({ mode: 'live', state: 'auth_failed' });
    render(<ConnectionBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Authentication failed');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clears the interval on unmount', () => {
    useConnectionStore.setState({
      mode: 'live',
      state: 'reconnecting',
      attempt: 1,
      nextRetryAt: Date.now() + 5000,
    });
    const { unmount } = render(<ConnectionBanner />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the interval when the state leaves reconnecting', () => {
    useConnectionStore.setState({
      mode: 'live',
      state: 'reconnecting',
      attempt: 1,
      nextRetryAt: Date.now() + 5000,
    });
    render(<ConnectionBanner />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => {
      useConnectionStore.setState({ state: 'open', nextRetryAt: null });
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
