import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../CommandPalette';
import { useAgentStore } from '../../../store/agentStore';
import { useUiStore, resetUiStore } from '../../../store/uiStore';
import type { Agent } from '../../../types/agent';

const mk = (id: string, name: string): Agent => ({
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

const openPalette = () => act(() => useUiStore.getState().openOverlay('palette'));

describe('CommandPalette', () => {
  beforeEach(() => {
    resetUiStore();
    useAgentStore.setState({
      agents: [mk('a1', 'Alpha'), mk('a2', 'Beta'), mk('a3', 'Gamma')],
      pending: {},
      activeAgentId: null,
      layoutMode: 'grid',
    });
  });

  it('renders nothing while closed and a labelled dialog while open', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openPalette();
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('combobox', { name: 'Type a command' })).toHaveFocus();
    expect(within(dialog).getByRole('listbox', { name: 'Commands' })).toBeInTheDocument();
  });

  it('names Ctrl+/ for shortcuts in the empty input hint', () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', expect.stringContaining('Ctrl+/'));
  });

  it('ArrowDown/ArrowUp wrap and aria-activedescendant follows the active option', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    const combo = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(10);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(combo).toHaveAttribute('aria-activedescendant', options[0].id);

    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[9]).toHaveAttribute('aria-selected', 'true');
    expect(combo).toHaveAttribute('aria-activedescendant', options[9].id);

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(combo).toHaveAttribute('aria-activedescendant', options[1].id);
  });

  it('Enter runs the active command and closes the palette', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    await user.type(screen.getByRole('combobox'), 'new agent{Enter}');
    expect(useUiStore.getState().overlay).toBe('addAgent');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Go to <name> activates that agent and requests terminal focus', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    await user.type(screen.getByRole('combobox'), 'go to beta');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(useAgentStore.getState().activeAgentId).toBe('a2');
    expect(useUiStore.getState().focusRequest.target).toBe('terminal:a2');
  });

  it('Escape closes and restores focus to the opener', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>opener</button>
        <CommandPalette />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    openPalette();
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Tab keeps focus inside the dialog', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('backdrop click closes; panel click does not', () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('palette-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('option click runs the command', () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByRole('option', { name: /Layout: Cascade/ }));
    expect(useAgentStore.getState().layoutMode).toBe('cascade');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mouse hover makes an option active', () => {
    render(<CommandPalette />);
    openPalette();
    const options = screen.getAllByRole('option');
    fireEvent.mouseEnter(options[3]);
    expect(screen.getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true');
  });

  it('shows No matching commands and drops aria-activedescendant for an unmatched query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    const combo = screen.getByRole('combobox');
    await user.type(combo, 'zzzzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getAllByText('No matching commands').length).toBeGreaterThan(0);
    expect(combo).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders an agent name containing markup as literal text and creates no element', () => {
    useAgentStore.setState({
      agents: [mk('x1', '<img src=x onerror="window.__pwned=1">')],
    });
    const { container } = render(<CommandPalette />);
    openPalette();
    expect(screen.getByText('Go to <img src=x onerror="window.__pwned=1">')).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('img')).toBeNull();
  });

  it('caps the list at 50 options with a visible note, and typing narrows it', async () => {
    const user = userEvent.setup();
    useAgentStore.setState({
      agents: Array.from({ length: 120 }, (_, i) => mk(`n${i}`, `Node ${i}`)),
    });
    render(<CommandPalette />);
    openPalette();
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByText(/More commands exist/)).toBeInTheDocument();

    await user.type(screen.getByRole('combobox'), 'node 119');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.queryByText(/More commands exist/)).not.toBeInTheDocument();
  });

  it('resets the query on every open', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    await user.type(screen.getByRole('combobox'), 'cascade');
    act(() => useUiStore.getState().closeOverlay());
    openPalette();
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
});
