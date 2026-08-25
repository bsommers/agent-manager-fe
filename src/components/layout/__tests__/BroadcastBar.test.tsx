import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BroadcastBar } from '../BroadcastBar';
import { useAgentStore } from '../../../store/agentStore';
import { agentSocket } from '../../../services/agentSocket';
import { Agent } from '../../../types/agent';

describe('BroadcastBar Component', () => {
  const mockAgents: Agent[] = [
    {
      id: 'agent-1',
      name: 'Alpha Worker',
      mode: 'tmux',
      targetHost: 'localhost:tmux_1',
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
    {
      id: 'agent-2',
      name: 'Beta Monitor',
      mode: 'ssh',
      targetHost: 'remote-beta:22',
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
    {
      id: 'agent-3',
      name: 'Gamma Sync',
      mode: 'tmux',
      targetHost: 'localhost:tmux_3',
      status: 'idle',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
  ];

  let sendSpy: any;

  beforeEach(() => {
    useAgentStore.setState({
      agents: mockAgents,
      activeAgentId: 'agent-1',
      searchQuery: '',
    });
    sendSpy = vi.spyOn(agentSocket, 'send').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders target modes and default target count', () => {
    render(<BroadcastBar />);

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Filtered')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(screen.getByText(/3 agents targeted/i)).toBeInTheDocument();
  });

  it('updates target agents when switching to Filtered mode with search query', () => {
    useAgentStore.setState({ searchQuery: 'Beta' });
    render(<BroadcastBar />);

    const filteredBtn = screen.getByRole('button', { name: /Filtered/i });
    fireEvent.click(filteredBtn);

    expect(screen.getByText(/1 agent targeted/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Broadcast command/i);
    fireEvent.change(input, { target: { value: 'hostname' } });

    const sendBtn = screen.getByRole('button', { name: /Broadcast/i });
    fireEvent.click(sendBtn);

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'agent:broadcast',
      targetAgentIds: ['agent-2'],
      data: 'hostname\r',
    });
  });

  it('updates target agents when switching to Selected mode and toggling checkboxes', () => {
    render(<BroadcastBar />);

    const selectedBtn = screen.getByRole('button', { name: /Selected/i });
    fireEvent.click(selectedBtn);

    // In Selected mode, agent selection checkboxes or chips are rendered
    const agent2Checkbox = screen.getByLabelText(/Beta Monitor/i) || screen.getByText('Beta Monitor');
    fireEvent.click(agent2Checkbox);

    const input = screen.getByPlaceholderText(/Broadcast command/i);
    fireEvent.change(input, { target: { value: 'date' } });

    const sendBtn = screen.getByRole('button', { name: /Broadcast/i });
    fireEvent.click(sendBtn);

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'agent:broadcast',
      targetAgentIds: expect.arrayContaining(['agent-2']),
      data: 'date\r',
    });
  });

  it('sends normal command to all agents when pressing Enter in All mode', () => {
    render(<BroadcastBar />);

    const input = screen.getByPlaceholderText(/Broadcast command/i);
    fireEvent.change(input, { target: { value: 'git status' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'agent:broadcast',
      targetAgentIds: ['agent-1', 'agent-2', 'agent-3'],
      data: 'git status\r',
    });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('intercepts destructive command and opens DestructiveSafetyModal', () => {
    render(<BroadcastBar />);

    const input = screen.getByPlaceholderText(/Broadcast command/i);
    fireEvent.change(input, { target: { value: 'rm -rf /var/log/*' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Should NOT send immediately
    expect(sendSpy).not.toHaveBeenCalled();

    // Safety modal is shown
    expect(screen.getByText(/Destructive Command Warning/i)).toBeInTheDocument();
    expect(screen.getByText('rm -rf /var/log/*')).toBeInTheDocument();
    expect(screen.getByText(/Targeted Sessions \(3\)/i)).toBeInTheDocument();

    // Clicking Cancel dismisses modal without sending
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Destructive Command Warning/i)).not.toBeInTheDocument();
  });

  it('executes destructive command after user confirmation in safety modal', () => {
    render(<BroadcastBar />);

    const input = screen.getByPlaceholderText(/Broadcast command/i);
    fireEvent.change(input, { target: { value: 'sudo systemctl restart nginx' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Destructive Command Warning/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Confirm Broadcast/i });
    fireEvent.click(confirmBtn);

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'agent:broadcast',
      targetAgentIds: ['agent-1', 'agent-2', 'agent-3'],
      data: 'sudo systemctl restart nginx\r',
    });
    expect(screen.queryByText(/Destructive Command Warning/i)).not.toBeInTheDocument();
  });

  it('detects various destructive commands based on regex', () => {
    const destructivePatterns = [
      'rm test.txt',
      'kill -9 9999',
      'drop table users;',
      'shutdown -h now',
      'reboot',
    ];

    for (const cmd of destructivePatterns) {
      const { unmount } = render(<BroadcastBar />);
      const input = screen.getByPlaceholderText(/Broadcast command/i);
      fireEvent.change(input, { target: { value: cmd } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(screen.getByText(/Destructive Command Warning/i)).toBeInTheDocument();
      unmount();
    }
  });

  it('does not send when command is empty or whitespace', () => {
    render(<BroadcastBar />);

    const input = screen.getByPlaceholderText(/Broadcast command/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
