import React from 'react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Z_LAYERS, clampPaneZ, stackPanes } from '../../../styles/zLayers';
import { OverlayPortal } from '../OverlayPortal';
import { DestructiveSafetyModal } from '../DestructiveSafetyModal';
import { useAgentStore } from '../../../store/agentStore';
import { AddAgentModal } from '../../agent/AddAgentModal';
import { GlobalSearchModal } from '../GlobalSearchModal';
import { CommandPalette } from '../CommandPalette';
import { ShortcutHelp } from '../ShortcutHelp';
import { useUiStore, resetUiStore } from '../../../store/uiStore';
import { Agent } from '../../../types/agent';

const makeAgent = (id: string, zIndex?: number): Agent => ({
  id,
  name: `Agent ${id}`,
  mode: 'tmux',
  targetHost: `localhost:${id}`,
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: true, x: 10, y: 10, width: 400, height: 300, zIndex },
  createdAt: 1,
  lastActivity: 1,
});

const IDS = ['p1', 'p2', 'p3', 'p4'];
const seed = () => IDS.map((id, i) => makeAgent(id, [undefined, 5, 100, 250][i]));

const raiseMany = (n: number) => {
  // deterministic pseudo-random sequence over the four agents
  let s = 12345;
  let last = IDS[0];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    last = IDS[s % IDS.length];
    useAgentStore.getState().bringToFront(last);
  }
  return last;
};

const maxPaneZ = () =>
  Math.max(...useAgentStore.getState().agents.map((a) => clampPaneZ(a.layout.zIndex)));

const layerWrapper = (layer: string) =>
  document.body.querySelector<HTMLElement>(`[data-overlay-layer="${layer}"]`);

let savedState: ReturnType<typeof useAgentStore.getState>;
beforeEach(() => {
  savedState = useAgentStore.getState();
});
afterEach(() => {
  cleanup();
  useAgentStore.setState({
    agents: savedState.agents,
    activeAgentId: savedState.activeAgentId,
    rosterNotices: savedState.rosterNotices,
  });
});

describe('Z_LAYERS scale', () => {
  it('is integer valued', () => {
    for (const v of Object.values(Z_LAYERS)) expect(Number.isInteger(v)).toBe(true);
  });
  it('has the documented values', () => {
    expect(Z_LAYERS.paneBase).toBe(100);
    expect(Z_LAYERS.paneMax).toBe(8999);
    expect(Z_LAYERS.overlay).toBe(9000);
    expect(Z_LAYERS.confirm).toBe(9100);
    expect(Z_LAYERS.toast).toBe(9200);
  });
  it('orders panes < overlay < confirm < toast', () => {
    expect(Z_LAYERS.paneBase).toBeLessThan(Z_LAYERS.paneMax);
    expect(Z_LAYERS.paneMax).toBeLessThan(Z_LAYERS.overlay);
    expect(Z_LAYERS.overlay).toBeLessThan(Z_LAYERS.confirm);
    expect(Z_LAYERS.confirm).toBeLessThan(Z_LAYERS.toast);
  });
});

describe('clampPaneZ', () => {
  it('falls back to paneBase for undefined, 0, negative and non-finite', () => {
    for (const v of [undefined, 0, -5, NaN, Infinity, -Infinity]) {
      expect(clampPaneZ(v as number | undefined)).toBe(100);
    }
  });
  it('caps values above paneMax', () => {
    expect(clampPaneZ(999999)).toBe(8999);
    expect(clampPaneZ(9000)).toBe(8999);
  });
  it('truncates fractions', () => {
    expect(clampPaneZ(150.9)).toBe(150);
  });
  it('passes through values from 1 to paneMax', () => {
    expect(clampPaneZ(10)).toBe(10);
    expect(clampPaneZ(11)).toBe(11);
    expect(clampPaneZ(8999)).toBe(8999);
  });
});

describe('stackPanes', () => {
  it('moves the front id to the unique highest rank', () => {
    const out = stackPanes([{ id: 'a', z: 100 }, { id: 'b', z: 101 }, { id: 'c', z: 102 }], 'a');
    expect(out).toEqual({ b: 100, c: 101, a: 102 });
  });
  it('preserves relative order of the others and breaks ties by input order', () => {
    const out = stackPanes([{ id: 'a', z: 5 }, { id: 'b', z: 5 }, { id: 'c', z: 1 }], 'c');
    expect(out).toEqual({ a: 100, b: 101, c: 102 });
  });
  it('treats missing z as paneBase', () => {
    const out = stackPanes([{ id: 'a' }, { id: 'b', z: 200 }], 'a');
    expect(out.b).toBe(100);
    expect(out.a).toBe(101);
  });
  it('changes nothing for an unknown id', () => {
    expect(stackPanes([{ id: 'a', z: 100 }], 'zzz')).toEqual({});
  });
  it('caps ranks at paneMax', () => {
    const entries = Array.from({ length: 9500 }, (_, i) => ({ id: `n${i}`, z: i + 1 }));
    const out = stackPanes(entries, 'n0');
    expect(Math.max(...Object.values(out))).toBe(8999);
  });
});

describe('bringToFront bounded', () => {
  it('keeps every z-index in [100, 103] after 10 000 raises across four agents', () => {
    useAgentStore.setState({ agents: seed() });
    const last = raiseMany(10000);
    const zs = useAgentStore.getState().agents.map((a) => a.layout.zIndex as number);
    for (const z of zs) {
      expect(z).toBeGreaterThanOrEqual(100);
      expect(z).toBeLessThanOrEqual(103);
    }
    expect(new Set(zs).size).toBe(4);
    const lastAgent = useAgentStore.getState().agents.find((a) => a.id === last)!;
    expect(lastAgent.layout.zIndex).toBe(103);
    expect(useAgentStore.getState().activeAgentId).toBe(last);
  });
  it('preserves relative order of the other panes', () => {
    useAgentStore.setState({ agents: [makeAgent('a', 100), makeAgent('b', 101), makeAgent('c', 102)] });
    useAgentStore.getState().bringToFront('a');
    const z = Object.fromEntries(useAgentStore.getState().agents.map((a) => [a.id, a.layout.zIndex]));
    expect(z).toEqual({ b: 100, c: 101, a: 102 });
  });
  it('sets activeAgentId for an unknown id without touching any z-index', () => {
    useAgentStore.setState({ agents: seed() });
    const before = useAgentStore.getState().agents.map((a) => a.layout.zIndex);
    useAgentStore.getState().bringToFront('nope');
    expect(useAgentStore.getState().agents.map((a) => a.layout.zIndex)).toEqual(before);
    expect(useAgentStore.getState().activeAgentId).toBe('nope');
  });
});

describe('OverlayPortal', () => {
  it('renders into document.body in a zero-size fixed wrapper with the layer z-index', () => {
    const { container } = render(
      <OverlayPortal layer="confirm">
        <span data-testid="inner">x</span>
      </OverlayPortal>,
    );
    expect(container).toBeEmptyDOMElement();
    const w = layerWrapper('confirm')!;
    expect(w.parentElement).toBe(document.body);
    expect(w.style.position).toBe('fixed');
    expect(w.style.width).toBe('0px');
    expect(w.style.height).toBe('0px');
    expect(w.style.zIndex).toBe('9100');
    expect(w.querySelector('[data-testid="inner"]')).not.toBeNull();
  });
  it('defaults to the overlay layer', () => {
    render(
      <OverlayPortal>
        <span />
      </OverlayPortal>,
    );
    expect(layerWrapper('overlay')!.style.zIndex).toBe('9000');
  });
});

describe('ordinary dialogs render in the overlay layer', () => {
  beforeEach(() => {
    resetUiStore();
    useAgentStore.setState({ agents: seed() });
    raiseMany(10000);
  });
  afterEach(() => {
    resetUiStore();
  });

  const expectInOverlayLayer = (dialogSelector: string) => {
    const wrappers = document.body.querySelectorAll('[data-overlay-layer="overlay"]');
    expect(wrappers).toHaveLength(1);
    const w = wrappers[0] as HTMLElement;
    expect(w.parentElement).toBe(document.body);
    expect(w.querySelector(dialogSelector)).not.toBeNull();
    expect(Number(w.style.zIndex)).toBe(Z_LAYERS.overlay);
    expect(Number(w.style.zIndex)).toBeGreaterThan(maxPaneZ());
    expect(Z_LAYERS.confirm).toBeGreaterThan(Number(w.style.zIndex));
  };

  it('AddAgentModal', () => {
    render(<AddAgentModal isOpen onClose={() => {}} />);
    expectInOverlayLayer('[role="dialog"]');
  });
  it('AddAgentModal renders nothing when closed', () => {
    const { container } = render(<AddAgentModal isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector('[data-overlay-layer]')).toBeNull();
  });
  it('GlobalSearchModal', () => {
    render(<GlobalSearchModal isOpen onClose={() => {}} />);
    expectInOverlayLayer('[data-testid="search-modal-backdrop"]');
  });
  it('GlobalSearchModal renders nothing when closed', () => {
    const { container } = render(<GlobalSearchModal isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector('[data-overlay-layer]')).toBeNull();
  });
  it('CommandPalette', () => {
    useUiStore.getState().openOverlay('palette');
    render(<CommandPalette />);
    expectInOverlayLayer('[data-testid="palette-backdrop"]');
  });
  it('ShortcutHelp', () => {
    useUiStore.getState().openOverlay('help');
    render(<ShortcutHelp />);
    expectInOverlayLayer('[data-testid="shortcut-help-backdrop"]');
  });
  it('CommandPalette and ShortcutHelp render nothing when not open', () => {
    const { container } = render(
      <>
        <CommandPalette />
        <ShortcutHelp />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector('[data-overlay-layer]')).toBeNull();
  });
});

describe('DestructiveSafetyModal layer', () => {
  it('renders the alertdialog in the confirm layer above every pane after 10 000 raises', () => {
    useAgentStore.setState({ agents: seed() });
    raiseMany(10000);
    render(
      <DestructiveSafetyModal
        isOpen
        command="rm -rf /"
        targetAgents={useAgentStore.getState().agents.slice(0, 2)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const w = layerWrapper('confirm')!;
    expect(w).not.toBeNull();
    expect(w.parentElement).toBe(document.body);
    expect(w.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(Number(w.style.zIndex)).toBeGreaterThan(maxPaneZ());
  });
  it('renders nothing when closed', () => {
    const { container } = render(
      <DestructiveSafetyModal isOpen={false} command="x" targetAgents={[]} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(layerWrapper('confirm')).toBeNull();
  });
});
