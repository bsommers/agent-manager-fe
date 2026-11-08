import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { AgentPane } from '../AgentPane';
import { useAgentStore } from '../../../store/agentStore';
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

function agent(id: string, name: string, status: Agent['status'] = 'running'): Agent {
  return {
    id,
    name,
    mode: 'tmux',
    targetHost: `localhost:${name}`,
    status,
    unreadOutput: false,
    layout: { isFloating: false },
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

function reset() {
  act(() => {
    useAgentStore.setState({ agents: [], activeAgentId: null, pending: {}, killing: {} });
  });
}

describe('AgentPane accessibility', () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it('is a group named after the agent', () => {
    const a = agent('p1', 'Alpha');
    render(<AgentPane agent={a} />);
    expect(screen.getByRole('group', { name: 'Agent Alpha' })).toBeInTheDocument();
  });

  it.each(['running', 'thinking', 'idle', 'error', 'disconnected'] as const)(
    'shows status text for %s and hides the dot',
    (status) => {
      const a = agent('p1', 'Alpha', status);
      const { container } = render(<AgentPane agent={a} />);
      const chip = screen.getByTestId('pane-status');
      expect(chip).toHaveAttribute('data-status', status);
      expect(chip).toHaveTextContent(`Status: ${status}`);
      expect(chip.textContent).toContain(status);
      const dot = container.querySelector('span.rounded-full');
      expect(dot).toHaveAttribute('aria-hidden', 'true');
    }
  );

  it('shows no pane-status for a pending pane, keeps one status role and hides its dot', () => {
    const a = agent('p1', 'Alpha');
    act(() => {
      useAgentStore.setState({ agents: [a], pending: { [a.id]: { startedAt: Date.now() } } as never });
    });
    const { container } = render(<AgentPane agent={a} />);
    expect(screen.queryByTestId('pane-status')).toBeNull();
    expect(screen.getByTestId('pane-state-starting')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelector('span.rounded-full')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows both pane-status and the Closing chip for a closing pane', () => {
    const a = agent('p1', 'Alpha');
    act(() => {
      useAgentStore.setState({ agents: [a], killing: { [a.id]: true } as never });
    });
    render(<AgentPane agent={a} />);
    expect(screen.getByTestId('pane-status')).toBeInTheDocument();
    expect(screen.getByTestId('pane-state-closing')).toBeInTheDocument();
  });

  it('passes the agent name to the controls', () => {
    const a = agent('p1', 'Alpha');
    render(<AgentPane agent={a} />);
    expect(screen.getByRole('button', { name: 'Close agent Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear Alpha terminal' })).toBeInTheDocument();
  });

  it('renders a markup-bearing name as literal text and creates no element', () => {
    const name = '<img src=x onerror=alert(1)>';
    const a = agent('p1', name);
    const { container } = render(<AgentPane agent={a} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('group', { name: `Agent ${name}` })).toBeInTheDocument();
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Close agent ${name}` })).toBeInTheDocument();
  });
});
