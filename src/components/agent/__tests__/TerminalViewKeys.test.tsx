import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

type KeyHandler = (e: KeyboardEvent) => boolean;
const created: Array<{ handler: KeyHandler | null; textarea: HTMLTextAreaElement; focus: ReturnType<typeof vi.fn> }> =
  [];

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => {
    const rec = {
      handler: null as KeyHandler | null,
      textarea: document.createElement('textarea'),
      focus: vi.fn(),
    };
    created.push(rec);
    return {
      loadAddon: vi.fn(),
      open: vi.fn((el: HTMLElement) => el.appendChild(rec.textarea)),
      write: vi.fn(),
      onData: vi.fn(),
      dispose: vi.fn(),
      focus: rec.focus,
      textarea: rec.textarea,
      attachCustomKeyEventHandler: vi.fn((fn: KeyHandler) => {
        rec.handler = fn;
      }),
    };
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(),
}));

import { TerminalView } from '../TerminalView';
import { useUiStore, resetUiStore } from '../../../store/uiStore';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('TerminalView keyboard integration', () => {
  beforeEach(() => {
    created.length = 0;
    resetUiStore();
  });

  const renderTerminal = (agentId = 'a1', agentName = 'Alpha') =>
    render(<TerminalView agentId={agentId} agentName={agentName} mode="tmux" targetHost="h" isActive={false} />);

  it('names the terminal textarea after the agent', () => {
    renderTerminal();
    expect(screen.getByLabelText('Terminal input: Alpha')).toBe(created[0].textarea);
  });

  it('lets registered chords bubble (handler returns false) and passes everything else to the program', () => {
    renderTerminal();
    const h = created[0].handler!;
    expect(h(key({ key: 'k', ctrlKey: true }))).toBe(false);
    expect(h(key({ key: 'F', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(h(key({ key: 'k', metaKey: true }))).toBe(false);

    expect(h(key({ key: 'c', ctrlKey: true }))).toBe(true);
    expect(h(key({ key: 'Escape' }))).toBe(true);
    expect(h(key({ key: 'Tab' }))).toBe(true);
    expect(h(key({ key: 'k' }))).toBe(true);
    expect(h(key({ key: 'a' }))).toBe(true);
  });

  it('applies the handler to keypress and keyup events too', () => {
    renderTerminal();
    const h = created[0].handler!;
    expect(h(new KeyboardEvent('keypress', { key: 'k', ctrlKey: true }))).toBe(false);
    expect(h(new KeyboardEvent('keyup', { key: 'k', ctrlKey: true }))).toBe(false);
  });

  it('focuses only the terminal targeted by a focus request, again on repeat', () => {
    renderTerminal('a1', 'Alpha');
    renderTerminal('a2', 'Beta');
    act(() => useUiStore.getState().requestFocus('terminal:a2'));
    expect(created[0].focus).not.toHaveBeenCalled();
    expect(created[1].focus).toHaveBeenCalledTimes(1);

    act(() => useUiStore.getState().requestFocus('terminal:a2'));
    expect(created[1].focus).toHaveBeenCalledTimes(2);
  });

  it('ignores focus requests made before the terminal mounted', () => {
    act(() => useUiStore.getState().requestFocus('terminal:a1'));
    renderTerminal('a1', 'Alpha');
    expect(created[0].focus).not.toHaveBeenCalled();
  });
});
