import { describe, it, expect, vi, afterEach } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { disposeTerminal } from '../terminalDispose';

/**
 * Regression: xterm 5.5.0's Viewport constructor schedules `setTimeout(() => this.syncScrollArea())`
 * and never cancels it. If the terminal is disposed before that timer fires (React StrictMode's
 * mount -> cleanup -> mount, or a pane closed right after mount), the callback runs against a
 * disposed RenderService and throws
 * "Cannot read properties of undefined (reading 'dimensions')" as an uncaught page error.
 */
describe('disposeTerminal', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const openTerminal = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const term = new Terminal();
    term.open(host);
    // In a browser FitAddon.fit() / the first render makes xterm sync the scroll area once before
    // the constructor's timer fires, which is what lets that late call reach `renderService.dimensions`.
    // jsdom has no layout, so trigger the same internal sync directly.
    (term as unknown as { _core: { viewport: { syncScrollArea(): void } } })._core.viewport.syncScrollArea();
    return term;
  };

  it('reproduces the xterm bug: plain dispose() leaves a timer that throws', () => {
    vi.useFakeTimers();
    const term = openTerminal();
    term.dispose();
    expect(() => vi.runOnlyPendingTimers()).toThrow(/dimensions/);
  });

  it('does not throw when the viewport timer fires after disposeTerminal()', () => {
    vi.useFakeTimers();
    const term = openTerminal();
    disposeTerminal(term);
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });

  it('still disposes the terminal (element is detached)', () => {
    const term = openTerminal();
    const el = term.element!;
    expect(el.isConnected).toBe(true);
    disposeTerminal(term);
    expect(el.isConnected).toBe(false);
  });

  it('is safe on terminals without the xterm internals and on repeated calls', () => {
    const fake = { dispose: vi.fn() } as unknown as Terminal;
    expect(() => disposeTerminal(fake)).not.toThrow();
    expect(fake.dispose).toHaveBeenCalledTimes(1);

    const term = openTerminal();
    disposeTerminal(term);
    expect(() => disposeTerminal(term)).not.toThrow();
  });
});
