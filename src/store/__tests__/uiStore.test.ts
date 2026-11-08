import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, resetUiStore } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => resetUiStore());

  it('starts with nothing open', () => {
    const s = useUiStore.getState();
    expect(s.overlay).toBeNull();
    expect(s.isBroadcastOpen).toBe(false);
    expect(s.focusRequest).toEqual({ target: '', nonce: 0 });
  });

  it('openOverlay replaces the open overlay (one at a time)', () => {
    useUiStore.getState().openOverlay('search');
    useUiStore.getState().openOverlay('palette');
    expect(useUiStore.getState().overlay).toBe('palette');
  });

  it("closeOverlay('x') is a no-op when another overlay is open", () => {
    useUiStore.getState().openOverlay('palette');
    useUiStore.getState().closeOverlay('search');
    expect(useUiStore.getState().overlay).toBe('palette');
    useUiStore.getState().closeOverlay('palette');
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it('closeOverlay without an argument closes whatever is open', () => {
    useUiStore.getState().openOverlay('help');
    useUiStore.getState().closeOverlay();
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it('toggleOverlay opens then closes, and switches when another is open', () => {
    const { toggleOverlay } = useUiStore.getState();
    toggleOverlay('palette');
    expect(useUiStore.getState().overlay).toBe('palette');
    toggleOverlay('palette');
    expect(useUiStore.getState().overlay).toBeNull();
    toggleOverlay('search');
    toggleOverlay('palette');
    expect(useUiStore.getState().overlay).toBe('palette');
  });

  it('requestFocus records the target and increments the nonce each time', () => {
    useUiStore.getState().requestFocus('broadcast');
    expect(useUiStore.getState().focusRequest).toEqual({ target: 'broadcast', nonce: 1 });
    useUiStore.getState().requestFocus('broadcast');
    expect(useUiStore.getState().focusRequest).toEqual({ target: 'broadcast', nonce: 2 });
  });

  it('setBroadcastOpen sets the flag', () => {
    useUiStore.getState().setBroadcastOpen(true);
    expect(useUiStore.getState().isBroadcastOpen).toBe(true);
  });

  it('resetUiStore restores the initial state', () => {
    useUiStore.getState().openOverlay('help');
    useUiStore.getState().setBroadcastOpen(true);
    useUiStore.getState().requestFocus('x');
    resetUiStore();
    const s = useUiStore.getState();
    expect(s.overlay).toBeNull();
    expect(s.isBroadcastOpen).toBe(false);
    expect(s.focusRequest).toEqual({ target: '', nonce: 0 });
  });
});
