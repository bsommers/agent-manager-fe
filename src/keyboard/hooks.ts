import { useEffect, useRef } from 'react';
import { SHORTCUTS, matchGlobalShortcut } from './shortcuts';
import { useUiStore } from '../store/uiStore';

/** Registers the window-level chords from the shortcut registry while mounted. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const id = matchGlobalShortcut(e);
      if (!id) return;
      const entry = SHORTCUTS.find((s) => s.id === id);
      if (!entry?.overlay) return;
      e.preventDefault();
      useUiStore.getState().toggleOverlay(entry.overlay);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

/**
 * Runs `focus` when a focus request for `target` is made after this component mounted.
 * Render-driven (an effect) so it fires after the commit in which an overlay closed
 * and focus was restored.
 */
export function useFocusRequest(target: string, focus: () => void): void {
  const request = useUiStore((s) => s.focusRequest);
  const seenNonce = useRef(request.nonce);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    if (request.nonce === seenNonce.current) return;
    seenNonce.current = request.nonce;
    if (request.target === target) focusRef.current();
  }, [request, target]);
}
