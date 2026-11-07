import type { Overlay } from '../store/uiStore';

export type ShortcutGroup = 'Global' | 'Command palette' | 'Dialogs' | 'Terminal' | 'Panes';

export interface Shortcut {
  id: string;
  group: ShortcutGroup;
  /** Display template; the token Mod is Ctrl (Cmd on macOS). */
  keys: string;
  description: string;
  /** Present for global chords: matched on event.key only (never event.code). */
  match?: { key: string; shift: boolean };
  /** The overlay this chord toggles. */
  overlay?: Overlay;
}

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'palette.toggle',
    group: 'Global',
    keys: 'Mod+K',
    description: 'Open or close the command palette',
    match: { key: 'k', shift: false },
    overlay: 'palette',
  },
  {
    id: 'search.toggle',
    group: 'Global',
    keys: 'Mod+Shift+F',
    description: 'Open or close global output search',
    match: { key: 'f', shift: true },
    overlay: 'search',
  },
];

export interface ChordEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Returns the id of the registered global chord matching the event, or null. */
export function matchGlobalShortcut(e: ChordEvent): string | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  if (e.altKey) return null; // AltGr is Ctrl+Alt on Windows
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  for (const s of SHORTCUTS) {
    if (!s.match) continue;
    if (e.shiftKey !== s.match.shift) continue;
    if (key === s.match.key) return s.id;
  }
  return null;
}

export function isMacPlatform(): boolean {
  try {
    return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
  } catch {
    return false;
  }
}

export function formatKeys(keys: string, isMac: boolean = isMacPlatform()): string {
  return keys
    .split('+')
    .map((part) => (part === 'Mod' ? (isMac ? 'Cmd' : 'Ctrl') : part))
    .join('+');
}
