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
  {
    id: 'help.toggle',
    group: 'Global',
    keys: 'Mod+/',
    description: 'Show or hide this list of keyboard shortcuts',
    match: { key: '/', shift: false },
    overlay: 'help',
  },
  {
    id: 'palette.navigate',
    group: 'Command palette',
    keys: 'Up/Down',
    description: 'Up and Down choose a command',
  },
  {
    id: 'palette.run',
    group: 'Command palette',
    keys: 'Enter',
    description: 'Enter runs the chosen command',
  },
  {
    id: 'dialog.close',
    group: 'Dialogs',
    keys: 'Esc',
    description: 'Esc closes the open dialog and returns focus to where it was',
  },
  {
    id: 'dialog.tab',
    group: 'Dialogs',
    keys: 'Tab',
    description: 'Tab and Shift+Tab move between a dialog’s controls without leaving it',
  },
  {
    id: 'terminal.passthrough',
    group: 'Terminal',
    keys: 'Tab',
    description: 'Tab, Esc and Ctrl+C go to the program in the terminal; the palette chord leaves it',
  },
  // The Panes rows document what plan 05-03 implements and pins by test. Keep the values in sync.
  {
    id: 'pane.move',
    group: 'Panes',
    keys: 'Arrow',
    description: 'With the title bar (Move pane <name>) focused, Arrow keys move the pane 10 px',
  },
  {
    id: 'pane.move.fast',
    group: 'Panes',
    keys: 'Shift+Arrow',
    description: 'With the title bar (Move pane <name>) focused, Shift+Arrow keys move the pane 50 px',
  },
  {
    id: 'pane.resize',
    group: 'Panes',
    keys: 'Arrow',
    description:
      'With the resize handle (Resize pane <name>) focused, Right and Down grow the pane and Left and Up shrink it by 10 px',
  },
  {
    id: 'pane.resize.fast',
    group: 'Panes',
    keys: 'Shift+Arrow',
    description:
      'With the resize handle (Resize pane <name>) focused, Shift+Arrow keys resize the pane by 50 px',
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
