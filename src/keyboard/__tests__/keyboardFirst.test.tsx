import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { SHORTCUTS } from '../shortcuts';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { Header } from '../../components/layout/Header';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore, resetUiStore } from '../../store/uiStore';
import type { Agent } from '../../types/agent';

const ctrl = (key: string, extra: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ctrlKey: true, ...extra });

describe('keyboard-first tracer (App)', () => {
  beforeEach(() => {
    resetUiStore();
    useAgentStore.setState({ layoutMode: 'grid', searchQuery: '' });
  });

  it('Ctrl+K from the toolbar filter opens a labelled palette, runs Layout: Cascade and restores focus', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Let the active terminal's deferred auto-focus (50 ms) fire before focusing the filter.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    const filter = screen.getByPlaceholderText(/Search agents by name or host/i);
    filter.focus();
    expect(filter).toHaveFocus();

    ctrl('k');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(dialog).toBeInTheDocument();
    const combo = screen.getByRole('combobox', { name: 'Type a command' });
    expect(combo).toHaveFocus();

    await user.type(combo, 'cascade');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Layout: Cascade');
    expect(combo).toHaveAttribute('aria-activedescendant', options[0].id);

    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(useAgentStore.getState().layoutMode).toBe('cascade');
    expect(filter).toHaveFocus();
  });

  it('Ctrl+K again closes the palette', async () => {
    render(<App />);
    ctrl('k');
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    ctrl('k');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('only one overlay is open at a time: search then palette', async () => {
    render(<App />);
    ctrl('F', { shiftKey: true });
    expect(await screen.findByRole('dialog', { name: /Global Output Search/i })).toBeInTheDocument();

    ctrl('k');
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Global Output Search/i })).not.toBeInTheDocument();
    expect(useUiStore.getState().overlay).toBe('palette');
  });

  it('ignores auto-repeat chords', () => {
    render(<App />);
    ctrl('k', { repeat: true });
    expect(useUiStore.getState().overlay).toBeNull();
    ctrl('k');
    expect(useUiStore.getState().overlay).toBe('palette');
    ctrl('k', { repeat: true });
    expect(useUiStore.getState().overlay).toBe('palette');
  });

  it('ignores chords with Alt held and calls preventDefault on a match', () => {
    render(<App />);
    ctrl('k', { altKey: true });
    expect(useUiStore.getState().overlay).toBeNull();

    const matched = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(matched);
    });
    expect(matched.defaultPrevented).toBe(true);
  });

  it('Header rendered alone still toggles search on Ctrl+Shift+F', async () => {
    render(<Header />);
    ctrl('F', { shiftKey: true });
    expect(await screen.findByRole('dialog', { name: /Global Output Search/i })).toBeInTheDocument();
    ctrl('F', { shiftKey: true });
    expect(screen.queryByRole('dialog', { name: /Global Output Search/i })).not.toBeInTheDocument();
  });

  it('removes the window listener when the host unmounts', () => {
    const { unmount } = render(<App />);
    unmount();
    ctrl('k');
    expect(useUiStore.getState().overlay).toBeNull();
  });
});

const mkAgent = (id: string, name: string): Agent => ({
  id,
  name,
  mode: 'tmux',
  targetHost: `host-${id}`,
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1,
  lastActivity: 1,
});

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

async function runCommand(user: ReturnType<typeof userEvent.setup>, query: string) {
  ctrl('k');
  const combo = await screen.findByRole('combobox', { name: 'Type a command' });
  await user.type(combo, query);
  await user.keyboard('{Enter}');
}

describe('palette reaches every surface (App)', () => {
  beforeEach(() => {
    resetUiStore();
    useAgentStore.setState({
      agents: [mkAgent('a1', 'Alpha'), mkAgent('a2', 'Beta'), mkAgent('a3', 'Gamma')],
      pending: {},
      activeAgentId: 'a1',
      layoutMode: 'grid',
      searchQuery: '',
    });
  });

  it('Go to <name> raises the pane and moves keyboard focus into that terminal', async () => {
    const user = userEvent.setup();
    render(<App />);
    await settle();
    await runCommand(user, 'go to gamma');
    await settle();
    expect(useAgentStore.getState().activeAgentId).toBe('a3');
    expect(screen.getByLabelText('Terminal input: Gamma')).toHaveFocus();
  });

  it('Broadcast to agents opens the bar and focuses its command field', async () => {
    const user = userEvent.setup();
    render(<App />);
    await settle();
    expect(screen.queryByPlaceholderText(/Broadcast command/i)).not.toBeInTheDocument();
    await runCommand(user, 'broadcast to');
    expect(await screen.findByPlaceholderText(/Broadcast command/i)).toHaveFocus();
  });

  it('Search agent output opens Global Search', async () => {
    const user = userEvent.setup();
    render(<App />);
    await settle();
    await runCommand(user, 'search agent output');
    expect(await screen.findByRole('dialog', { name: /Global Output Search/i })).toBeInTheDocument();
  });

  it('Filter agents focuses the toolbar filter', async () => {
    const user = userEvent.setup();
    render(<App />);
    await settle();
    await runCommand(user, 'filter agents');
    expect(screen.getByRole('textbox', { name: 'Filter agents by name or host' })).toHaveFocus();
  });

  it('New agent opens the add-agent modal', async () => {
    const user = userEvent.setup();
    render(<App />);
    await settle();
    await runCommand(user, 'new agent');
    expect(useUiStore.getState().overlay).toBe('addAgent');
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
  });

  it('the New Agent toolbar button still opens the modal through the store', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /New Agent/i }));
    expect(useUiStore.getState().overlay).toBe('addAgent');
  });

  it('the Commands header button opens the palette', async () => {
    const user = userEvent.setup();
    render(<App />);
    const btn = screen.getByRole('button', { name: /Commands/ });
    expect(btn.textContent).toContain('Ctrl+K');
    expect(btn.getAttribute('title')).toContain('Ctrl+/');
    expect(btn.textContent?.toLowerCase()).not.toContain('global search');
    await user.click(btn);
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('exposes aria-pressed on layout buttons and the Broadcast toggle', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Cascade' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Cascade' }));
    expect(screen.getByRole('button', { name: 'Cascade' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'false');

    const broadcast = screen.getByRole('button', { name: /^Broadcast$/ });
    expect(broadcast).toHaveAttribute('aria-pressed', 'false');
    await user.click(broadcast);
    expect(broadcast).toHaveAttribute('aria-pressed', 'true');
    expect(useUiStore.getState().isBroadcastOpen).toBe(true);
  });

  it('Ctrl+K dispatched on the focused terminal opens the palette; Ctrl+C there does not', async () => {
    render(<App />);
    await settle();
    const textarea = screen.getByLabelText('Terminal input: Alpha');
    textarea.focus();
    expect(textarea).toHaveFocus();

    fireEvent.keyDown(textarea, { key: 'c', ctrlKey: true });
    expect(useUiStore.getState().overlay).toBeNull();

    fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(textarea).toHaveFocus();
  });

  it('Ctrl+/ opens the help overlay listing every registry row; Esc closes it and restores focus', async () => {
    render(<App />);
    await settle();
    const filter = screen.getByRole('textbox', { name: 'Filter agents by name or host' });
    filter.focus();

    ctrl('/');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const s of SHORTCUTS) {
      expect(within(dialog).getByText(s.description)).toBeInTheDocument();
    }

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    expect(filter).toHaveFocus();
  });

  it('the Show keyboard shortcuts command sits after Filter agents and opens the help overlay', async () => {
    const user = userEvent.setup();
    render(<App />);
    await settle();
    ctrl('k');
    await screen.findByRole('dialog', { name: 'Command palette' });
    const titles = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    const filterIdx = titles.findIndex((t) => t.startsWith('Filter agents'));
    expect(titles[filterIdx + 1]).toMatch(/^Show keyboard shortcuts/);

    await user.type(screen.getByRole('combobox'), 'keyboard shortcuts{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('unmounting the toolbar resets the broadcast flag', () => {
    const { unmount } = render(<App />);
    act(() => useUiStore.getState().setBroadcastOpen(true));
    unmount();
    expect(useUiStore.getState().isBroadcastOpen).toBe(false);
  });
});
