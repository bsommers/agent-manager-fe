/**
 * The single z-index scale for the whole UI.
 *
 *   panes     [paneBase .. paneMax]  floating panes (bounded, see stackPanes / clampPaneZ)
 *   overlay   modals and palettes (add-agent, search, command palette, help)
 *   confirm   destructive confirmations; always above ordinary overlays
 *   toast     notification stack; always on top
 *
 * Rule: every modal, overlay or toast is rendered through OverlayPortal with
 * one of the layers below. Never give an overlay a class based z-index; the
 * stylesheet cannot read these constants and a second source of truth drifts.
 */
export const Z_LAYERS = {
  paneBase: 100,
  paneMax: 8999,
  overlay: 9000,
  confirm: 9100,
  toast: 9200,
} as const;

export type OverlayLayer = 'overlay' | 'confirm' | 'toast';

/** Bound an arbitrary stored pane z-index into [paneBase .. paneMax]. */
export function clampPaneZ(z: number | undefined | null): number {
  if (typeof z !== 'number' || !Number.isFinite(z) || z <= 0) return Z_LAYERS.paneBase;
  const t = Math.trunc(z);
  if (t <= 0) return Z_LAYERS.paneBase;
  return Math.min(t, Z_LAYERS.paneMax);
}

export interface PaneZEntry {
  id: string;
  z?: number | null;
}

/**
 * Re-rank panes into the contiguous range starting at paneBase with `frontId`
 * highest. Relative order of the other panes is preserved (ties keep input
 * order). Returns a map id -> new z-index; empty when frontId is unknown.
 */
export function stackPanes(entries: readonly PaneZEntry[], frontId: string): Record<string, number> {
  if (!entries.some((e) => e.id === frontId)) return {};
  const ordered = entries
    .map((e, i) => ({ id: e.id, z: clampPaneZ(e.z), i }))
    .filter((e) => e.id !== frontId)
    .sort((a, b) => a.z - b.z || a.i - b.i);
  const ids = [...ordered.map((e) => e.id), frontId];
  const out: Record<string, number> = {};
  ids.forEach((id, rank) => {
    out[id] = Math.min(Z_LAYERS.paneBase + rank, Z_LAYERS.paneMax);
  });
  return out;
}
