import { agentSocket } from '../agentSocket';
import { clearToken, STORAGE_PREFIX } from '../auth/tokenStore';
import { resetAgentStore } from '../../store/agentStore';
import { useLogBufferStore } from '../../store/logBufferStore';
import { resetUiStore, useUiStore } from '../../store/uiStore';
import { useConnectionStore } from '../../store/connectionStore';

/** Removes every key with the app prefix. Collects first so removal cannot shift the indexes. */
function sweep(storage: Storage | undefined): void {
  if (!storage) return;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null && k.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
}

/**
 * Ends the session (D-03). Order matters: drop request promises without rejecting them, disconnect,
 * clear the token, then empty the stores, so no late frame or rejection repopulates what was just
 * emptied. Each step is guarded on its own; `complete` is false when any step threw.
 * Never connects or reconnects, and writes nothing to any log.
 */
export function logout(): { complete: boolean } {
  let complete = true;
  const step = (fn: () => void) => {
    try {
      fn();
    } catch {
      complete = false;
    }
  };

  // Demo has no session to end: only the token goes, and the dialog is never opened.
  if (useConnectionStore.getState().mode === 'demo') {
    step(clearToken);
    return { complete };
  }

  step(() => agentSocket.requests.clear());
  step(() => agentSocket.getAdapter().disconnect());
  step(clearToken);
  step(resetAgentStore);
  step(() => useLogBufferStore.getState().clearBuffer());
  step(() => {
    resetUiStore();
    useUiStore.getState().openOverlay('token');
  });
  step(() => {
    useConnectionStore.getState().applySnapshot(agentSocket.getAdapter().getSnapshot());
    useConnectionStore.setState({ lastError: null });
  });
  step(() => sweep(typeof sessionStorage === 'undefined' ? undefined : sessionStorage));
  step(() => sweep(typeof localStorage === 'undefined' ? undefined : localStorage));
  return { complete };
}
