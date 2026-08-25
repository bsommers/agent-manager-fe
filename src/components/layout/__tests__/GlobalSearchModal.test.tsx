import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlobalSearchModal } from '../GlobalSearchModal';
import { Header } from '../Header';
import { useAgentStore } from '../../../store/agentStore';
import { useLogBufferStore } from '../../../store/logBufferStore';
import { Agent } from '../../../types/agent';

describe('GlobalSearchModal Component', () => {
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

    useLogBufferStore.setState({
      buffers: {
        'agent-1': [
          { id: '1', agentId: 'agent-1', timestamp: 1000, text: 'Building package bundle...' },
          { id: '2', agentId: 'agent-1', timestamp: 2000, text: 'FATAL: Compilation error in src/main.ts:42' },
          { id: '3', agentId: 'agent-1', timestamp: 3000, text: 'Process exited with code 1' },
        ],
        'agent-2': [
          { id: '4', agentId: 'agent-2', timestamp: 1500, text: 'Starting monitor worker...' },
          { id: '5', agentId: 'agent-2', timestamp: 2500, text: 'WARNING: Connection timeout to database' },
          { id: '6', agentId: 'agent-2', timestamp: 3500, text: 'FATAL: Database host unreachable error' },
        ],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(<GlobalSearchModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText(/Global Output Search/i)).not.toBeInTheDocument();
  });

  it('renders modal with search input and header when isOpen is true', () => {
    render(<GlobalSearchModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/Global Output Search/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search terminal logs across all agents/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regex/i })).toBeInTheDocument();
  });

  it('calls onClose when close button, backdrop, or Escape key is pressed', () => {
    const onClose = vi.fn();
    const { rerender } = render(<GlobalSearchModal isOpen={true} onClose={onClose} />);

    // Click close button
    const closeBtn = screen.getByTestId('close-search-modal');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Click backdrop
    const backdrop = screen.getByTestId('search-modal-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('performs text search and renders matching lines grouped by agent', () => {
    render(<GlobalSearchModal isOpen={true} onClose={() => {}} />);

    const input = screen.getByPlaceholderText(/Search terminal logs across all agents/i);
    fireEvent.change(input, { target: { value: 'FATAL' } });

    // Header match count badge
    expect(screen.getByText(/2 matches across 2 agents/i)).toBeInTheDocument();

    // Agent groups
    const agent1Group = screen.getByTestId('agent-group-agent-1');
    const agent2Group = screen.getByTestId('agent-group-agent-2');
    expect(agent1Group).toBeInTheDocument();
    expect(agent2Group).toBeInTheDocument();

    // Matching log lines
    expect(screen.getByText(/FATAL: Compilation error in src\/main.ts:42/i)).toBeInTheDocument();
    expect(screen.getByText(/FATAL: Database host unreachable error/i)).toBeInTheDocument();
  });

  it('supports regex search when regex mode is toggled', () => {
    render(<GlobalSearchModal isOpen={true} onClose={() => {}} />);

    const regexToggle = screen.getByRole('button', { name: /regex/i });
    fireEvent.click(regexToggle);

    const input = screen.getByPlaceholderText(/Search terminal logs across all agents/i);
    // Regex matching "error.*42" only in agent-1
    fireEvent.change(input, { target: { value: 'error.*42' } });

    expect(screen.getByText(/1 match across 1 agent/i)).toBeInTheDocument();
    expect(screen.getByTestId('agent-group-agent-1')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-group-agent-2')).not.toBeInTheDocument();
    expect(screen.getByText(/FATAL: Compilation error in src\/main.ts:42/i)).toBeInTheDocument();
  });

  it('handles invalid regex gracefully without throwing', () => {
    render(<GlobalSearchModal isOpen={true} onClose={() => {}} />);

    const regexToggle = screen.getByRole('button', { name: /regex/i });
    fireEvent.click(regexToggle);

    const input = screen.getByPlaceholderText(/Search terminal logs across all agents/i);
    fireEvent.change(input, { target: { value: '[invalid(' } });

    expect(screen.getByText(/Invalid regular expression/i)).toBeInTheDocument();
  });

  it('clicking a search result calls bringToFront(agentId) and closes modal', () => {
    const onClose = vi.fn();
    const bringToFrontSpy = vi.spyOn(useAgentStore.getState(), 'bringToFront');

    render(<GlobalSearchModal isOpen={true} onClose={onClose} />);

    const input = screen.getByPlaceholderText(/Search terminal logs across all agents/i);
    fireEvent.change(input, { target: { value: 'timeout' } });

    const resultItem = screen.getByText(/WARNING: Connection timeout to database/i);
    fireEvent.click(resultItem);

    expect(bringToFrontSpy).toHaveBeenCalledWith('agent-2');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking agent header jump button calls bringToFront(agentId) and closes modal', () => {
    const onClose = vi.fn();
    const bringToFrontSpy = vi.spyOn(useAgentStore.getState(), 'bringToFront');

    render(<GlobalSearchModal isOpen={true} onClose={onClose} />);

    const input = screen.getByPlaceholderText(/Search terminal logs across all agents/i);
    fireEvent.change(input, { target: { value: 'error' } });

    const jumpButtons = screen.getAllByRole('button', { name: /jump to pane/i });
    expect(jumpButtons.length).toBeGreaterThan(0);
    fireEvent.click(jumpButtons[0]);

    expect(bringToFrontSpy).toHaveBeenCalledWith('agent-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders empty state when no matches are found', () => {
    render(<GlobalSearchModal isOpen={true} onClose={() => {}} />);

    const input = screen.getByPlaceholderText(/Search terminal logs across all agents/i);
    fireEvent.change(input, { target: { value: 'nonexistent-pattern-xyz' } });

    expect(screen.getByText(/No log matches found/i)).toBeInTheDocument();
  });

  it('integrates with Header component and opens via Global Search button and Ctrl+Shift+F shortcut', () => {
    render(<Header />);

    // Header button
    const searchBtn = screen.getByRole('button', { name: /global search/i });
    expect(searchBtn).toBeInTheDocument();

    // Click to open
    fireEvent.click(searchBtn);
    expect(screen.getByText(/Global Output Search/i)).toBeInTheDocument();

    // Close via close button
    fireEvent.click(screen.getByTestId('close-search-modal'));
    expect(screen.queryByText(/Global Output Search/i)).not.toBeInTheDocument();

    // Open via keyboard shortcut Ctrl+Shift+F
    fireEvent.keyDown(window, { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true });
    expect(screen.getByText(/Global Output Search/i)).toBeInTheDocument();
  });
});
