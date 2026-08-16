import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { FloatingPane } from '../FloatingPane';
import { Agent } from '../../../types/agent';
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

describe('FloatingPane Component', () => {
  const mockAgent: Agent = {
    id: 'test-agent-pane',
    name: 'Floating Test Agent',
    mode: 'tmux',
    targetHost: 'localhost:test',
    status: 'running',
    unreadOutput: false,
    layout: { isFloating: true, x: 100, y: 100, width: 600, height: 400, zIndex: 10 },
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  beforeEach(() => {
    useAgentStore.setState({
      agents: [mockAgent],
      activeAgentId: 'test-agent-pane',
    });
  });

  it('should render floating pane title and agent components', () => {
    const { getByText } = render(<FloatingPane agent={mockAgent} />);
    expect(getByText(/PANE \[Floating Test Agent\]/)).toBeInTheDocument();
  });

  it('should handle dragging header to update position', () => {
    const { getByText } = render(<FloatingPane agent={mockAgent} />);
    const dragHandle = getByText('Drag to move').parentElement!;

    // Start drag
    fireEvent.mouseDown(dragHandle, { clientX: 100, clientY: 100 });

    // Drag move
    fireEvent.mouseMove(window, { clientX: 150, clientY: 150 });

    // End drag
    fireEvent.mouseUp(window);

    const updated = useAgentStore.getState().agents.find((a) => a.id === mockAgent.id);
    expect(updated?.layout.x).toBe(150);
    expect(updated?.layout.y).toBe(150);
  });

  it('should handle resizing window via bottom-right handle', () => {
    const { getByTitle } = render(<FloatingPane agent={mockAgent} />);
    const resizeHandle = getByTitle('Resize window');

    // Start resize drag
    fireEvent.mouseDown(resizeHandle, { clientX: 700, clientY: 500 });

    // Drag move
    fireEvent.mouseMove(window, { clientX: 750, clientY: 550 });

    // End resize drag
    fireEvent.mouseUp(window);

    const updated = useAgentStore.getState().agents.find((a) => a.id === mockAgent.id);
    expect(updated?.layout.width).toBe(650);
    expect(updated?.layout.height).toBe(450);
  });

  it('should clean up window event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { getByText, unmount } = render(<FloatingPane agent={mockAgent} />);
    const dragHandle = getByText('Drag to move').parentElement!;

    fireEvent.mouseDown(dragHandle, { clientX: 100, clientY: 100 });
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });
});
