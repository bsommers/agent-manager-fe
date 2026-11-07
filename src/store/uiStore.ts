import { create } from 'zustand';

export type Overlay = 'palette' | 'help' | 'search' | 'addAgent';

export interface FocusRequest {
  target: string;
  nonce: number;
}

export interface UiState {
  /** At most one overlay is open at a time. */
  overlay: Overlay | null;
  isBroadcastOpen: boolean;
  focusRequest: FocusRequest;

  openOverlay: (overlay: Overlay) => void;
  /** Closes the open overlay; with `only`, closes it only when it is that overlay. */
  closeOverlay: (only?: Overlay) => void;
  toggleOverlay: (overlay: Overlay) => void;
  setBroadcastOpen: (open: boolean) => void;
  requestFocus: (target: string) => void;
}

export const initialUiState = {
  overlay: null as Overlay | null,
  isBroadcastOpen: false,
  focusRequest: { target: '', nonce: 0 } as FocusRequest,
};

export const useUiStore = create<UiState>((set) => ({
  ...initialUiState,

  openOverlay: (overlay) => set({ overlay }),
  closeOverlay: (only) =>
    set((state) => {
      if (only !== undefined && state.overlay !== only) return state;
      return state.overlay === null ? state : { overlay: null };
    }),
  toggleOverlay: (overlay) => set((state) => ({ overlay: state.overlay === overlay ? null : overlay })),
  setBroadcastOpen: (open) => set({ isBroadcastOpen: open }),
  requestFocus: (target) =>
    set((state) => ({ focusRequest: { target, nonce: state.focusRequest.nonce + 1 } })),
}));

export function resetUiStore(): void {
  useUiStore.setState({ ...initialUiState, focusRequest: { ...initialUiState.focusRequest } });
}
