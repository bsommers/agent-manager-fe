import type { Terminal } from '@xterm/xterm';

/** The slice of xterm's private internals this module touches. Feature-detected, never assumed. */
interface ViewportLike {
  syncScrollArea?: (...args: unknown[]) => void;
}

/**
 * Dispose an xterm Terminal without leaving a timer behind that throws.
 *
 * xterm 5.5.0's Viewport constructor runs `setTimeout(() => this.syncScrollArea())` and has no way
 * to cancel it. When the terminal is disposed before that timer fires (React StrictMode's
 * mount -> cleanup -> mount in dev, or a pane closed right after it mounts), the callback reads
 * `renderService.dimensions` on a disposed RenderService (`_renderer.value` is cleared) and throws
 * "Cannot read properties of undefined (reading 'dimensions')" as an uncaught page error.
 *
 * `syncScrollArea` is looked up on the instance when the timer fires, so replacing it with a no-op
 * on this one (about to be disposed) viewport makes the late callback harmless. Terminals without
 * that internal (other xterm versions, test doubles) just get a plain `dispose()`.
 */
export function disposeTerminal(term: Terminal): void {
  const viewport = (term as unknown as { _core?: { viewport?: ViewportLike } })._core?.viewport;
  if (viewport && typeof viewport.syncScrollArea === 'function') {
    viewport.syncScrollArea = () => {};
  }
  term.dispose();
}
