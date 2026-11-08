import React from 'react';
import { createPortal } from 'react-dom';
import { Z_LAYERS, OverlayLayer } from '../../styles/zLayers';

export interface OverlayPortalProps {
  layer?: OverlayLayer;
  children: React.ReactNode;
}

/**
 * Renders children into document.body inside a zero-size fixed wrapper whose
 * inline z-index comes from the Z_LAYERS scale. Because the wrapper is a child
 * of body, no ancestor stacking context can trap an overlay below the panes.
 */
export const OverlayPortal: React.FC<OverlayPortalProps> = ({ layer = 'overlay', children }) => {
  return createPortal(
    <div
      data-overlay-layer={layer}
      style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, zIndex: Z_LAYERS[layer] }}
    >
      {children}
    </div>,
    document.body,
  );
};
