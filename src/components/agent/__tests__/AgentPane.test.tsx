import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { AgentPane } from '../AgentPane';
import { useAgentStore } from '../../../store/agentStore';
import { useConnectionStore } from '../../../store/connectionStore';
import { agentSocket } from '../../../services/agentSocket';
import type { Agent } from '../../../types/agent';

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(),
}));

function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    mode: 'tmux',
    targetHost: `localhost:${name}`,
    status: 'running',
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

describe('AgentPane states', () => {
  let sendSpy: MockInstance | undefined;

  beforeEach(() => {
    useConnectionStore.setState({ mode: 'live' });
  });

  afterEach(() => {
    cleanup();
    sendSpy?.mockRestore();
    sendSpy = undefined;
    useConnectionStore.setState({ mode: 'demo' });
    act(() => {
      useAgentStore.setState({ agents: [], activeAgentId: null, pending: {}, killing: {} });
    });
  });

  it('a pending pane shows Starting, no terminal and no input controls', () => {
    const a = agent('pending-1', 'Build');
    useAgentStore.setState({
      agents: [a],
      activeAgentId: a.id,
      pending: { [a.id]: { name: 'Build', mode: 'tmux', targetHost: a.targetHost, startedAt: 1 } },
      killing: {},
    });
    render(<AgentPane agent={a} />);

    expect(screen.getByTestId('pane-state-starting')).toHaveTextContent(/starting/i);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Starting Build');
    expect(status).toHaveTextContent('Waiting for the backend to confirm');
    expect(screen.getByRole('button', { name: 'Cancel starting Build' })).toBeInTheDocument();
    expect(screen.queryByTitle('Send SIGINT (Ctrl+C)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Close Agent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pane-state-closing')).not.toBeInTheDocument();
  });

  it('Cancel starting removes the pane and sends no agent:kill', () => {
    const send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
    sendSpy = send;
    const a = agent('pending-1', 'Build');
    useAgentStore.setState({
      agents: [a],
      activeAgentId: a.id,
      pending: { [a.id]: { name: 'Build', mode: 'tmux', targetHost: a.targetHost, startedAt: 1 } },
      killing: {},
    });
    render(<AgentPane agent={a} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel starting Build' }));

    expect(send).not.toHaveBeenCalled();
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(useAgentStore.getState().pending).toEqual({});
  });

  it('a pane being killed shows Closing and keeps its terminal controls', () => {
    const a = agent('agent-5', 'Closer');
    useAgentStore.setState({
      agents: [a],
      activeAgentId: a.id,
      pending: {},
      killing: { [a.id]: 1 },
    });
    render(<AgentPane agent={a} />);

    expect(screen.getByTestId('pane-state-closing')).toHaveTextContent(/closing/i);
    expect(screen.queryByTestId('pane-state-starting')).not.toBeInTheDocument();
    expect(screen.getByTitle('Close Agent')).toBeInTheDocument();
    expect(screen.getByTitle('Send SIGINT (Ctrl+C)')).toBeInTheDocument();
  });

  it('a normal pane renders without any state chip', () => {
    const a = agent('agent-6', 'Plain');
    useAgentStore.setState({ agents: [a], activeAgentId: a.id, pending: {}, killing: {} });
    render(<AgentPane agent={a} />);

    expect(screen.queryByTestId('pane-state-starting')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pane-state-closing')).not.toBeInTheDocument();
    expect(screen.getByTitle('Close Agent')).toBeInTheDocument();
  });
});
