import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShortcutHelp } from '../ShortcutHelp';
import { SHORTCUTS, formatKeys } from '../../../keyboard/shortcuts';
import type { Shortcut } from '../../../keyboard/shortcuts';
import { useUiStore, resetUiStore } from '../../../store/uiStore';

const openHelp = () => act(() => useUiStore.getState().openOverlay('help'));

describe('ShortcutHelp', () => {
  beforeEach(() => resetUiStore());
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing while closed and a labelled modal dialog while open', () => {
    render(<ShortcutHelp />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openHelp();
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('lists exactly one row per registry entry, grouped under group headings in registry order', () => {
    render(<ShortcutHelp />);
    openHelp();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('dt')).toHaveLength(SHORTCUTS.length);
    for (const s of SHORTCUTS) {
      expect(within(dialog).getByText(s.description)).toBeInTheDocument();
    }
    const headings = within(dialog)
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Global', 'Command palette', 'Dialogs', 'Terminal', 'Panes']);
  });

  it('renders keys through formatKeys: Ctrl by default, Cmd on macOS', () => {
    const { unmount } = render(<ShortcutHelp />);
    openHelp();
    expect(screen.getAllByText('Ctrl+K').length).toBeGreaterThan(0);
    expect(screen.queryByText('Cmd+K')).not.toBeInTheDocument();
    unmount();
    resetUiStore();

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<ShortcutHelp />);
    openHelp();
    expect(screen.getAllByText('Cmd+K').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cmd+Shift+F').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ctrl+K')).not.toBeInTheDocument();
  });

  it('shows a registry entry added at test time with no other change', () => {
    const extra: Shortcut = { id: 'test.extra', group: 'Global', keys: 'Mod+J', description: 'Test-only extra binding' };
    SHORTCUTS.push(extra);
    try {
      render(<ShortcutHelp />);
      openHelp();
      expect(screen.getByText('Test-only extra binding')).toBeInTheDocument();
      expect(screen.getByText('Ctrl+J')).toBeInTheDocument();
    } finally {
      SHORTCUTS.splice(SHORTCUTS.indexOf(extra), 1);
    }
  });

  it('closes with Esc, the Close button and backdrop click, and restores focus', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>opener</button>
        <ShortcutHelp />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();

    openHelp();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    openHelp();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openHelp();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('shortcut-help-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>outside</button>
        <ShortcutHelp />
      </>,
    );
    openHelp();
    await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('explains that Mod is Ctrl (Cmd on macOS) and that chords work inside a terminal', () => {
    render(<ShortcutHelp />);
    openHelp();
    expect(screen.getByText(/Mod is Ctrl \(Cmd on macOS\)/)).toBeInTheDocument();
    expect(screen.getByText(/also work while a terminal has focus/)).toBeInTheDocument();
  });

  // Cross-plan contract with 05-03 (pane chrome): these values are implemented and pinned there.
  it('pins the pane key values and accessible names in the help overlay', () => {
    render(<ShortcutHelp />);
    openHelp();
    const dialog = screen.getByRole('dialog');
    const text = (id: string) => within(dialog).getByText(SHORTCUTS.find((s) => s.id === id)!.description).textContent!;

    expect(text('pane.move')).toMatch(/Move pane <name>.*Arrow keys move the pane 10 px/);
    expect(text('pane.move.fast')).toMatch(/Move pane <name>.*Shift\+Arrow keys move the pane 50 px/);
    expect(text('pane.resize')).toMatch(/Resize pane <name>.*Right and Down grow.*Left and Up shrink.* by 10 px/);
    expect(text('pane.resize.fast')).toMatch(/Resize pane <name>.*Shift\+Arrow keys resize the pane by 50 px/);

    const keysFor = (id: string) =>
      within(dialog).getByText(SHORTCUTS.find((s) => s.id === id)!.description).closest('div')!.querySelector('kbd')!
        .textContent;
    expect(keysFor('pane.move')).toBe('Arrow');
    expect(keysFor('pane.move.fast')).toBe('Shift+Arrow');
    expect(keysFor('pane.resize')).toBe('Arrow');
    expect(keysFor('pane.resize.fast')).toBe('Shift+Arrow');
  });

  it('docs/KEYBOARD.md lists every registry row and the same pane values', () => {
    // Backticks are markdown code spans (they keep <name> from being read as HTML); ignore them when comparing.
    const doc = readFileSync(resolve(__dirname, '../../../../docs/KEYBOARD.md'), 'utf8').replace(/`/g, '');
    for (const s of SHORTCUTS) {
      expect(doc, `docs/KEYBOARD.md is missing: ${s.description}`).toContain(s.description);
      expect(doc).toContain(formatKeys(s.keys, false));
    }
    expect(doc).toContain('Ctrl+K');
    expect(doc).toContain('10 px');
    expect(doc).toContain('50 px');
    expect(doc).toContain('Move pane <name>');
    expect(doc).toContain('Resize pane <name>');
  });
});
