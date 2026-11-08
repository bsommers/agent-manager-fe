import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { suppressTerminalReports } from '../terminalReports';

const THEME = {
  background: '#0d1322',
  foreground: '#f1f5f9',
  cursor: '#00f2fe',
  selectionBackground: '#1e293b',
};

function makeTerm() {
  const term = new Terminal({ theme: THEME, convertEol: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  term.open(host);
  const out: string[] = [];
  term.onData((d) => out.push(d));
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  return { term, out, write };
}

describe('terminalReports: the QA bug (control)', () => {
  it('without the guard, xterm types the exact QA reply bytes', async () => {
    const { out, write } = makeTerm();
    await write('\x1b[c');
    await write('\x1b[>c');
    await write('\x1b]10;?\x1b\\');
    await write('\x1b]11;?\x07');
    expect(out).toEqual([
      '\x1b[?1;2c',
      '\x1b[>0;276;0c',
      '\x1b]10;rgb:f1f1/f5f5/f9f9\x1b\\',
      '\x1b]11;rgb:0d0d/1313/2222\x1b\\',
    ]);
  });

  it('with the guard, the same queries produce no onData and later text renders', async () => {
    const { term, out, write } = makeTerm();
    suppressTerminalReports(term);
    await write('\x1b[c');
    await write('\x1b[>c');
    await write('\x1b]10;?\x1b\\');
    await write('\x1b]11;?\x07');
    await write('hello');
    expect(out).toEqual([]);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('hello');
  });

  it('accepts a terminal double without a parser', () => {
    const d = suppressTerminalReports({} as unknown as Terminal);
    expect(() => d.dispose()).not.toThrow();
  });
});
