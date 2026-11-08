import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TMUX_SESSION_NAME_RE,
  isKillableTmuxSessionName,
  tmuxSessionNameOf,
  killTmuxSession,
} from '../tmuxKill.js';

describe('isKillableTmuxSessionName', () => {
  it.each(['qa-e2e-a', 'qa_a', 'A1', '0abc', '_x', 'a', 'a'.repeat(64)])('accepts %s', (name) => {
    expect(isKillableTmuxSessionName(name)).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['space', 'a b'],
    ['leading space', ' ab'],
    ['tab', 'a\tb'],
    ['newline', 'a\nb'],
    ['trailing newline', 'ab\n'],
    ['semicolon', 'a;b'],
    ['command substitution', '$(id)'],
    ['dollar', 'a$b'],
    ['backticks', '`id`'],
    ['pipe', 'a|b'],
    ['ampersand', 'a&b'],
    ['single quote', "a'b"],
    ['double quote', 'a"b'],
    ['leading hyphen option', '-t'],
    ['leading double hyphen', '--help'],
    ['colon', 'a:b'],
    ['dot', 'a.b'],
    ['leading equals', '=a'],
    ['slash', 'a/b'],
    ['path traversal', '../etc'],
    ['non-ASCII letter', 'café'],
    ['65 characters', 'a'.repeat(65)],
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['object', {}],
    ['array', ['a']],
  ])('rejects %s', (_label, name) => {
    expect(isKillableTmuxSessionName(name)).toBe(false);
  });

  it('exports the documented pattern', () => {
    expect(TMUX_SESSION_NAME_RE.source).toBe('^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$');
  });
});

describe('tmuxSessionNameOf', () => {
  it.each([
    ['localhost:qa_a', 'qa_a'],
    ['qa_a', 'qa_a'],
    ['a:b:c', 'b'],
    ['', ''],
  ])('%j gives %j', (input, expected) => {
    expect(tmuxSessionNameOf(input)).toBe(expected);
  });
});

describe('killTmuxSession', () => {
  const ok = () => vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

  it('runs tmux with an argument array, an exact-match target and no shell option', async () => {
    const run = ok();
    await expect(killTmuxSession('qa-e2e-a', run)).resolves.toBe('killed');
    expect(run).toHaveBeenCalledTimes(1);
    const [file, args, options] = run.mock.calls[0];
    expect(file).toBe('tmux');
    expect(args).toEqual(['kill-session', '-t', '=qa-e2e-a']);
    expect(Object.keys(options)).not.toContain('shell');
    expect(options.timeout).toBeGreaterThan(0);
  });

  it.each([
    ["can't find session: =x"],
    ['no server running on /tmp/tmux-1000/default'],
    ['error connecting to /tmp/tmux-1000/default (No such file or directory)'],
  ])('treats stderr %j as already gone', async (stderr) => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error('failed'), { stderr }));
    await expect(killTmuxSession('qa_a', run)).resolves.toBe('already_gone');
  });

  it.each([
    ['permission denied', Object.assign(new Error('failed'), { stderr: 'permission denied' })],
    ['an error without stderr', new Error('boom')],
    ['a timeout error', Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' })],
  ])('rethrows %s', async (_label, err) => {
    const run = vi.fn().mockRejectedValue(err);
    await expect(killTmuxSession('qa_a', run)).rejects.toBe(err);
  });

  it.each(['a b', '-t', '$(id)', 'a:b', '', 'a'.repeat(65)])(
    'throws before running anything for the unkillable name %j',
    async (name) => {
      const run = ok();
      await expect(killTmuxSession(name, run)).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    }
  );

  it('has no shell-capable call in its source (static hygiene)', () => {
    const src = readFileSync(fileURLToPath(new URL('../tmuxKill.ts', import.meta.url)), 'utf8');
    for (const banned of ['exec(', 'execSync', 'spawn', 'shell:', 'shell ']) {
      expect(src.includes(banned), `tmuxKill.ts must not contain "${banned}"`).toBe(false);
    }
    expect(src).toContain('execFile');
  });
});
