import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function makeAgent(id: string, name: string, layout: Agent['layout']): Agent {
  return {
    id,
    name,
    mode: 'tmux',
    targetHost: `localhost:${name}`,
    status: 'running',
    unreadOutput: false,
    layout,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

const paneAgent = makeAgent('kb-pane', 'Keyboard Agent', {
  isFloating: true,
  x: 100,
  y: 100,
  width: 600,
  height: 400,
  zIndex: 10,
});
const otherAgent = makeAgent('kb-other', 'Other Agent', {
  isFloating: true,
  x: 300,
  y: 300,
  width: 600,
  height: 400,
  zIndex: 20,
});

const stored = () => useAgentStore.getState().agents.find((a) => a.id === paneAgent.id)!;

describe('FloatingPane keyboard move and resize', () => {
  beforeEach(() => {
    act(() => {
      useAgentStore.setState({
        agents: [paneAgent, otherAgent],
        activeAgentId: otherAgent.id,
        pending: {},
        killing: {},
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  const moveHandle = () => screen.getByRole('button', { name: 'Move pane Keyboard Agent' });
  const resizeHandle = () => screen.getByRole('button', { name: 'Resize pane Keyboard Agent' });

  describe('move handle', () => {
    it('is a focusable button with a name and a description', () => {
      render(<FloatingPane agent={paneAgent} />);
      const handle = moveHandle();
      expect(handle).toHaveAttribute('tabindex', '0');
      expect(handle).toHaveAccessibleDescription(
        'Use the arrow keys to move this pane. Hold Shift for larger steps.'
      );
    });

    it('keeps the visible Drag to move text inside the same element', () => {
      render(<FloatingPane agent={paneAgent} />);
      expect(screen.getByText('Drag to move').parentElement).toBe(moveHandle());
    });

    it('is the first tab stop', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      await user.tab();
      expect(moveHandle()).toHaveFocus();
    });

    it('moves 10 px per ArrowRight press and accumulates', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      await user.tab();
      await user.keyboard('{ArrowRight}{ArrowRight}');
      expect(stored().layout.x).toBe(120);
      expect(stored().layout.y).toBe(100);
    });

    it('moves 50 px with Shift and accumulates', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      await user.tab();
      await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
      expect(stored().layout.y).toBe(200);
      expect(stored().layout.x).toBe(100);
    });

    it('clamps at x 10 and y 50', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      await user.tab();
      await user.keyboard('{Shift>}{ArrowLeft}{ArrowLeft}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}');
      expect(stored().layout.x).toBe(10);
      expect(stored().layout.y).toBe(50);
    });

    it('prevents default on arrows only when no Ctrl/Meta/Alt is held', () => {
      render(<FloatingPane agent={paneAgent} />);
      const handle = moveHandle();
      expect(fireEvent.keyDown(handle, { key: 'ArrowRight' })).toBe(false);
      expect(fireEvent.keyDown(handle, { key: 'ArrowRight', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(handle, { key: 'ArrowRight', metaKey: true })).toBe(true);
      expect(fireEvent.keyDown(handle, { key: 'ArrowRight', altKey: true })).toBe(true);
      expect(stored().layout.x).toBe(110);
    });

    it.each(['a', 'Enter', ' '])('ignores %j', (key) => {
      render(<FloatingPane agent={paneAgent} />);
      expect(fireEvent.keyDown(moveHandle(), { key })).toBe(true);
      expect(stored().layout.x).toBe(100);
      expect(stored().layout.y).toBe(100);
    });

    it('does not change the active agent, zIndex or focus', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      await user.tab();
      await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}');
      expect(useAgentStore.getState().activeAgentId).toBe(otherAgent.id);
      expect(stored().layout.zIndex).toBe(10);
      expect(moveHandle()).toHaveFocus();
    });
  });

  describe('resize handle', () => {
    it('is a focusable button with name, description and unchanged title', () => {
      render(<FloatingPane agent={paneAgent} />);
      const handle = resizeHandle();
      expect(handle).toHaveAttribute('tabindex', '0');
      expect(handle).toHaveAttribute('title', 'Resize window');
      expect(handle).toHaveAccessibleDescription(
        'Use the arrow keys to resize this pane. Hold Shift for larger steps.'
      );
      expect(handle.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('tab order is title bar, the four control buttons, then the resize handle', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      await user.tab();
      expect(moveHandle()).toHaveFocus();
      for (let i = 0; i < 4; i += 1) await user.tab();
      await user.tab();
      expect(resizeHandle()).toHaveFocus();
    });

    it('ArrowRight grows width 10 and leaves x, y, height alone', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      resizeHandle().focus();
      await user.keyboard('{ArrowRight}');
      const l = stored().layout;
      expect([l.x, l.y, l.width, l.height]).toEqual([100, 100, 610, 400]);
    });

    it('Shift+ArrowUp shrinks height 50; presses accumulate', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      resizeHandle().focus();
      await user.keyboard('{Shift>}{ArrowUp}{ArrowUp}{/Shift}');
      expect(stored().layout.height).toBe(300);
      expect(stored().layout.width).toBe(600);
    });

    it('Down grows height and Left shrinks width', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      resizeHandle().focus();
      await user.keyboard('{ArrowDown}{ArrowLeft}');
      expect(stored().layout.height).toBe(410);
      expect(stored().layout.width).toBe(590);
    });

    it('clamps at 300 x 200', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      resizeHandle().focus();
      await user.keyboard(
        '{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}'
      );
      expect(stored().layout.width).toBe(300);
      expect(stored().layout.height).toBe(200);
    });

    it('ignores modifiers and non-arrow keys', () => {
      render(<FloatingPane agent={paneAgent} />);
      const handle = resizeHandle();
      expect(fireEvent.keyDown(handle, { key: 'ArrowRight', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(handle, { key: 'Enter' })).toBe(true);
      expect(stored().layout.width).toBe(600);
      expect(fireEvent.keyDown(handle, { key: 'ArrowRight' })).toBe(false);
      expect(stored().layout.width).toBe(610);
    });

    it('does not change the active agent, zIndex or focus', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);
      resizeHandle().focus();
      await user.keyboard('{ArrowRight}{ArrowDown}');
      expect(useAgentStore.getState().activeAgentId).toBe(otherAgent.id);
      expect(stored().layout.zIndex).toBe(10);
      expect(resizeHandle()).toHaveFocus();
    });
  });

  describe('pinned documented values (cross-plan contract with 05-02)', () => {
    it('Arrow moves 10 px, Shift+Arrow 50 px; resize 10 / 50 with Right/Down growing and Left/Up shrinking; documented names', async () => {
      const user = userEvent.setup();
      render(<FloatingPane agent={paneAgent} />);

      expect(screen.getByRole('button', { name: 'Move pane Keyboard Agent' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Resize pane Keyboard Agent' })).toBeInTheDocument();

      moveHandle().focus();
      await user.keyboard('{ArrowRight}');
      expect(stored().layout.x).toBe(110);
      await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
      expect(stored().layout.x).toBe(160);

      resizeHandle().focus();
      const w0 = stored().layout.width!;
      const h0 = stored().layout.height!;
      await user.keyboard('{ArrowRight}');
      expect(stored().layout.width).toBe(w0 + 10);
      await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
      expect(stored().layout.width).toBe(w0 + 60);
      await user.keyboard('{ArrowDown}');
      expect(stored().layout.height).toBe(h0 + 10);
      await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
      expect(stored().layout.height).toBe(h0 + 60);
      await user.keyboard('{ArrowLeft}');
      expect(stored().layout.width).toBe(w0 + 50);
      await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
      expect(stored().layout.width).toBe(w0);
      await user.keyboard('{ArrowUp}');
      expect(stored().layout.height).toBe(h0 + 50);
      await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
      expect(stored().layout.height).toBe(h0);
    });
  });
});
