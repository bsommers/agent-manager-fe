import { useEffect } from 'react';
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
