import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// Real xterm, with one tweak: after open() sync the scroll area once, as FitAddon.fit() / the first
// render do in a browser. jsdom has no layout, so that sync would otherwise never happen, and it is
// what lets xterm 5.5's constructor timer reach `renderService.dimensions` after disposal.
vi.mock('@xterm/xterm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xterm/xterm')>();
  class SyncedTerminal extends actual.Terminal {
    override open(parent: HTMLElement): void {
      super.open(parent);
      (this as unknown as { _core: { viewport: { syncScrollArea(): void } } })._core.viewport.syncScrollArea();
    }
  }
  return { ...actual, Terminal: SyncedTerminal };
});

import { TerminalView } from '../TerminalView';

describe('TerminalView disposal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const view = (agentName = 'Alpha', isActive = false) => (
    <TerminalView agentId="a1" agentName={agentName} mode="tmux" targetHost="h" isActive={isActive} />
  );

  it('does not raise xterm\'s "reading \'dimensions\'" error when unmounted before its startup timer fires', () => {
    vi.useFakeTimers();
    const { unmount } = render(view());
    unmount();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });

  it('survives StrictMode mount -> cleanup -> mount (the dev-mode double effect)', () => {
    vi.useFakeTimers();
    const { unmount } = render(<React.StrictMode>{view()}</React.StrictMode>);
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    unmount();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });

  it('survives the terminal being recreated (agentName change) before timers fire', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(view('Alpha', true));
    rerender(view('Beta', true));
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    unmount();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });
});
