import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { Workspace } from '../Workspace';
import { useAgentStore } from '../../../store/agentStore';

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

describe('Workspace Component', () => {
  beforeEach(() => {
    act(() => {
      useAgentStore.setState({
        agents: [
          {
            id: 'ws-agent-1',
            name: 'Alpha Worker',
            mode: 'tmux',
            targetHost: 'localhost:alpha',
            status: 'running',
            unreadOutput: false,
            layout: { isFloating: true, x: 10, y: 10 },
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        activeAgentId: 'ws-agent-1',
        layoutMode: 'grid',
        searchQuery: '',
      });
    });
  });

  it('should render matching agent panes when searchQuery matches', () => {
    const { getByText } = render(<Workspace />);
    expect(getByText(/PANE \[Alpha Worker\]/)).toBeInTheDocument();
  });

  it('should render empty state message when search query matches no agents', () => {
    act(() => {
      useAgentStore.setState({ searchQuery: 'non-existent-agent-name' });
    });
    const { getByText } = render(<Workspace />);

    expect(getByText(/No agents found matching "non-existent-agent-name"/)).toBeInTheDocument();
  });

  it('should say the roster is empty when there are no agents at all', () => {
    act(() => {
      useAgentStore.setState({ agents: [], activeAgentId: null, searchQuery: 'anything' });
    });
    const { getByTestId, queryByText } = render(<Workspace />);

    expect(getByTestId('empty-roster')).toHaveTextContent('No agents yet. Use Add Agent to start one.');
    expect(queryByText(/No agents found matching/)).not.toBeInTheDocument();
  });

  it('should trigger layout mode arrangements when layoutMode changes', () => {
    const gridSpy = vi.spyOn(useAgentStore.getState(), 'arrangeGrid');
    const cascadeSpy = vi.spyOn(useAgentStore.getState(), 'arrangeCascade');
    const focusSpy = vi.spyOn(useAgentStore.getState(), 'arrangeFocus');

    const { rerender } = render(<Workspace />);

    act(() => {
      useAgentStore.setState({ layoutMode: 'cascade' });
    });
    rerender(<Workspace />);
    expect(cascadeSpy).toHaveBeenCalled();

    act(() => {
      useAgentStore.setState({ layoutMode: 'focus' });
    });
    rerender(<Workspace />);
    expect(focusSpy).toHaveBeenCalled();

    act(() => {
      useAgentStore.setState({ layoutMode: 'grid' });
    });
    rerender(<Workspace />);
    expect(gridSpy).toHaveBeenCalled();
  });
});
