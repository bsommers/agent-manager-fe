import { useEffect } from 'react';
import { useConnectionStore } from '../store/connectionStore';
import { useUiStore } from '../store/uiStore';

/**
 * Opens the token dialog when a live connection transitions into auth_failed (D-02). It reacts to
 * transitions only, so a dialog dismissed with Escape stays dismissed until the next real failure.
 */
export function useAuthPrompt(): void {
  useEffect(() => {
    const openIfFailed = () => {
      const { mode, state } = useConnectionStore.getState();
      if (mode === 'live' && state === 'auth_failed') useUiStore.getState().openOverlay('token');
    };
    // Already failed when the app mounted.
    openIfFailed();
    let prev = useConnectionStore.getState().state;
    return useConnectionStore.subscribe((s) => {
      if (s.state === prev) return;
      prev = s.state;
      if (s.state === 'auth_failed') openIfFailed();
    });
  }, []);
}
