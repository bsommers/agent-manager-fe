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

describe('SHORTCUTS registry', () => {
  it('has the two global chords', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids).toContain('palette.toggle');
    expect(ids).toContain('search.toggle');
  });
});
