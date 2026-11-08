import { describe, it, expect } from 'vitest';
import { SHORTCUTS, matchGlobalShortcut, formatKeys } from '../shortcuts';

type Ev = Partial<Record<'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', string | boolean>>;
const ev = (o: Ev) => ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o }) as Parameters<
  typeof matchGlobalShortcut
>[0];

describe('matchGlobalShortcut', () => {
  it.each([
    ['Ctrl+K', { key: 'k', ctrlKey: true }, 'palette.toggle'],
    ['Ctrl+K (capital key)', { key: 'K', ctrlKey: true }, 'palette.toggle'],
    ['Meta+K', { key: 'k', metaKey: true }, 'palette.toggle'],
    ['Ctrl+Shift+F', { key: 'F', ctrlKey: true, shiftKey: true }, 'search.toggle'],
    ['Ctrl+Shift+F lowercase key', { key: 'f', ctrlKey: true, shiftKey: true }, 'search.toggle'],
    ['Meta+Shift+F', { key: 'F', metaKey: true, shiftKey: true }, 'search.toggle'],
  ])('matches %s', (_name, e, id) => {
    expect(matchGlobalShortcut(ev(e))).toBe(id);
  });

  it.each([
    ['plain k', { key: 'k' }],
    ['Ctrl+Shift+K', { key: 'K', ctrlKey: true, shiftKey: true }],
    ['Ctrl+Alt+K', { key: 'k', ctrlKey: true, altKey: true }],
    ['Ctrl+F without Shift', { key: 'f', ctrlKey: true }],
    ['Ctrl+Shift+F with Alt', { key: 'F', ctrlKey: true, shiftKey: true, altKey: true }],
    ['Ctrl+C', { key: 'c', ctrlKey: true }],
    ['Ctrl+Shift+C', { key: 'C', ctrlKey: true, shiftKey: true }],
    ['Escape', { key: 'Escape' }],
    ['Ctrl alone', { key: 'Control', ctrlKey: true }],
  ])('does not match %s', (_name, e) => {
    expect(matchGlobalShortcut(ev(e))).toBeNull();
  });

  it('matches on event.key only, never event.code', () => {
    const e = { ...ev({ key: 'x', ctrlKey: true }), code: 'KeyK' };
    expect(matchGlobalShortcut(e)).toBeNull();
  });
});

describe('formatKeys', () => {
  it('uses Ctrl by default and Cmd on macOS', () => {
    expect(formatKeys('Mod+Shift+F', false)).toBe('Ctrl+Shift+F');
    expect(formatKeys('Mod+K', true)).toBe('Cmd+K');
  });

  it('leaves non-Mod keys untouched', () => {
    expect(formatKeys('Esc', false)).toBe('Esc');
    expect(formatKeys('Shift+Arrow', true)).toBe('Shift+Arrow');
  });
});

describe('help chord', () => {
  it('matches Ctrl+/ and Meta+/', () => {
    expect(matchGlobalShortcut(ev({ key: '/', ctrlKey: true }))).toBe('help.toggle');
    expect(matchGlobalShortcut(ev({ key: '/', metaKey: true }))).toBe('help.toggle');
  });

  it('does not match Ctrl+Shift+/, Ctrl+Alt+/ or a plain slash', () => {
    expect(matchGlobalShortcut(ev({ key: '/', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchGlobalShortcut(ev({ key: '/', ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchGlobalShortcut(ev({ key: '/' }))).toBeNull();
  });
});

describe('SHORTCUTS registry', () => {
  it('has the global chords', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids).toContain('palette.toggle');
    expect(ids).toContain('search.toggle');
    expect(ids).toContain('help.toggle');
  });

  it('has unique ids, non-empty descriptions and keys, and an overlay for every chord', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) {
      expect(s.description.trim()).not.toBe('');
      expect(s.keys.trim()).not.toBe('');
      if (s.match) expect(s.overlay).toBeDefined();
    }
  });

  it('keeps groups in the order Global, Command palette, Dialogs, Terminal, Panes', () => {
    const order: string[] = [];
    for (const s of SHORTCUTS) if (!order.includes(s.group)) order.push(s.group);
    expect(order).toEqual(['Global', 'Command palette', 'Dialogs', 'Terminal', 'Panes']);
    // groups are contiguous
    const groupsSeen = SHORTCUTS.map((s) => s.group).filter((g, i, a) => i === 0 || a[i - 1] !== g);
    expect(groupsSeen).toEqual(order);
  });
});

// Cross-plan contract with 05-03 (pane chrome). Plan 05-03 implements and pins these exact values;
// if they change there they must change here, in the help overlay and in docs/KEYBOARD.md.
describe('Panes rows pin the 05-03 contract', () => {
  const panes = SHORTCUTS.filter((s) => s.group === 'Panes');
  const row = (id: string) => panes.find((s) => s.id === id)!;

  it('documents Arrow = 10 px and Shift+Arrow = 50 px for move and resize', () => {
    expect(panes.map((s) => s.id)).toEqual(['pane.move', 'pane.move.fast', 'pane.resize', 'pane.resize.fast']);
    expect(row('pane.move').keys).toBe('Arrow');
    expect(row('pane.move').description).toContain('10 px');
    expect(row('pane.move').description).not.toContain('50 px');
    expect(row('pane.move.fast').keys).toBe('Shift+Arrow');
    expect(row('pane.move.fast').description).toContain('50 px');
    expect(row('pane.resize').keys).toBe('Arrow');
    expect(row('pane.resize').description).toContain('10 px');
    expect(row('pane.resize').description).not.toContain('50 px');
    expect(row('pane.resize.fast').keys).toBe('Shift+Arrow');
    expect(row('pane.resize.fast').description).toContain('50 px');
  });

  it('names the accessible labels Move pane <name> and Resize pane <name>', () => {
    expect(row('pane.move').description).toContain('Move pane <name>');
    expect(row('pane.move.fast').description).toContain('Move pane <name>');
    expect(row('pane.resize').description).toContain('Resize pane <name>');
    expect(row('pane.resize.fast').description).toContain('Resize pane <name>');
  });

  it('documents the resize directions: Right and Down grow, Left and Up shrink', () => {
    expect(row('pane.resize').description).toMatch(/Right and Down grow/);
    expect(row('pane.resize').description).toMatch(/Left and Up shrink/);
  });
});
