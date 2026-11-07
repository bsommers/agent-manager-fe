import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { Header } from '../../components/layout/Header';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore, resetUiStore } from '../../store/uiStore';

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
