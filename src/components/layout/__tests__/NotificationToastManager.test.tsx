import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NotificationToastManager } from '../NotificationToastManager';
import { useAgentStore } from '../../../store/agentStore';
import { agentSocket } from '../../../services/agentSocket';
import { Agent } from '../../../types/agent';

describe('NotificationToastManager Component', () => {
  const mockAgents: Agent[] = [
    {
      id: 'agent-1',
      name: 'Code Refactor Agent',
      mode: 'tmux',
      targetHost: 'localhost:tmux_dev_1',
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
    {
      id: 'agent-2',
      name: 'Remote Prod Monitor',
      mode: 'ssh',
      targetHost: 'admin@192.168.1.100:22',
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
  ];

  beforeEach(() => {
    useAgentStore.setState({
      agents: mockAgents,
      activeAgentId: 'agent-1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing initially when there are no notifications', () => {
    render(<NotificationToastManager />);
    expect(screen.queryByTestId('toast-notification')).not.toBeInTheDocument();
  });

  it('renders an error toast when agent:status_change error event is received', () => {
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'error',
      });
    });

    expect(screen.getByText('Code Refactor Agent')).toBeInTheDocument();
    expect(screen.getByText(/^Error$/i)).toBeInTheDocument();
    expect(screen.getByTestId('toast-error-agent-1')).toBeInTheDocument();
  });

  it('renders a disconnected toast when agent:status_change disconnected event is received', () => {
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-2',
        status: 'disconnected',
      });
    });

    expect(screen.getByText('Remote Prod Monitor')).toBeInTheDocument();
    expect(screen.getByText(/^Disconnected$/i)).toBeInTheDocument();
    expect(screen.getByTestId('toast-disconnected-agent-2')).toBeInTheDocument();
  });

  it('falls back to agentId when agent is not present in store', () => {
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'unknown-agent-99',
        status: 'error',
      });
    });

    expect(screen.getByText('unknown-agent-99')).toBeInTheDocument();
  });

  it('ignores non-alert status changes such as running, idle, and thinking', () => {
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'running',
      });
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'idle',
      });
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'thinking',
      });
    });

    expect(screen.queryByTestId('toast-notification')).not.toBeInTheDocument();
  });

  it('auto-dismisses toast notification after 5000ms', () => {
    vi.useFakeTimers();
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'error',
      });
    });

    expect(screen.getByText('Code Refactor Agent')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Code Refactor Agent')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Code Refactor Agent')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('manually dismisses toast when close button is clicked', () => {
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'error',
      });
    });

    expect(screen.getByText('Code Refactor Agent')).toBeInTheDocument();

    const dismissBtn = screen.getByRole('button', { name: /dismiss notification/i });
    fireEvent.click(dismissBtn);

    expect(screen.queryByText('Code Refactor Agent')).not.toBeInTheDocument();
  });

  it('renders multiple toasts and dismisses them independently', () => {
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'error',
      });
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-2',
        status: 'disconnected',
      });
    });

    expect(screen.getByText('Code Refactor Agent')).toBeInTheDocument();
    expect(screen.getByText('Remote Prod Monitor')).toBeInTheDocument();

    const dismissBtns = screen.getAllByRole('button', { name: /dismiss notification/i });
    expect(dismissBtns.length).toBe(2);

    // Dismiss first toast
    fireEvent.click(dismissBtns[0]);
    expect(screen.queryByText('Code Refactor Agent')).not.toBeInTheDocument();
    expect(screen.getByText('Remote Prod Monitor')).toBeInTheDocument();

    // Dismiss second toast
    const remainingDismissBtn = screen.getByRole('button', { name: /dismiss notification/i });
    fireEvent.click(remainingDismissBtn);
    expect(screen.queryByText('Remote Prod Monitor')).not.toBeInTheDocument();
  });

  it('brings agent to front when clicking a toast notification', () => {
    const bringToFrontSpy = vi.spyOn(useAgentStore.getState(), 'bringToFront');
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'error',
      });
    });

    const toastElement = screen.getByTestId('toast-error-agent-1');
    fireEvent.click(toastElement);

    expect(bringToFrontSpy).toHaveBeenCalledWith('agent-1');
  });

  it('syncs agent status in agentStore on agent:status_change event', () => {
    render(<NotificationToastManager />);

    act(() => {
      (agentSocket as any).notify({
        type: 'agent:status_change',
        agentId: 'agent-1',
        status: 'error',
      });
    });

    const updatedAgent = useAgentStore.getState().agents.find((a) => a.id === 'agent-1');
    expect(updatedAgent?.status).toBe('error');
  });

  describe('roster notices', () => {
    const notice = (id: string, kind: 'create_failed' | 'kill_failed') => ({
      id,
      kind,
      title: kind === 'create_failed' ? 'Could not create "Build"' : 'Could not close "Other"',
      message: 'The backend did not confirm within 10 s.',
      createdAt: Date.now(),
    });

    afterEach(() => {
      vi.useRealTimers();
      useAgentStore.setState({ rosterNotices: [] });
    });

    it('renders each notice as an alert with title, message and a Dismiss button', () => {
      useAgentStore.setState({
        rosterNotices: [notice('n1', 'create_failed'), notice('n2', 'kill_failed')],
      });
      render(<NotificationToastManager />);

      const create = screen.getByTestId('roster-notice-create_failed');
      expect(create).toHaveAttribute('role', 'alert');
      expect(create).toHaveTextContent('Could not create "Build"');
      expect(create).toHaveTextContent('10 s');
      expect(screen.getByTestId('roster-notice-kill_failed')).toHaveTextContent('Could not close "Other"');

      const dismiss = screen.getAllByRole('button', { name: /dismiss notification/i });
      expect(dismiss).toHaveLength(2);
      fireEvent.click(dismiss[0]);
      expect(screen.queryByTestId('roster-notice-create_failed')).not.toBeInTheDocument();
      expect(useAgentStore.getState().rosterNotices.map((n) => n.id)).toEqual(['n2']);
    });

    it('dismisses a notice by itself after 8000 ms', () => {
      vi.useFakeTimers();
      useAgentStore.setState({ rosterNotices: [notice('n1', 'create_failed')] });
      render(<NotificationToastManager />);
      expect(screen.getByTestId('roster-notice-create_failed')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(7999);
      });
      expect(screen.getByTestId('roster-notice-create_failed')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByTestId('roster-notice-create_failed')).not.toBeInTheDocument();
      expect(useAgentStore.getState().rosterNotices).toEqual([]);
    });

    it('clears its timers on unmount', () => {
      vi.useFakeTimers();
      useAgentStore.setState({ rosterNotices: [notice('n1', 'kill_failed')] });
      const { unmount } = render(<NotificationToastManager />);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
