import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/xterm';
import type { ITerminalOptions } from '@xterm/xterm';
import { suppressTerminalReports, isColorQuery, REPORTING_WINDOW_OPS } from '../terminalReports';

const THEME = {
  background: '#0d1322',
  foreground: '#f1f5f9',
  cursor: '#00f2fe',
  selectionBackground: '#1e293b',
};

/** Every report-producing windowOptions flag on, to prove the guard holds even then. */
const ALL_WINDOW_OPTIONS: ITerminalOptions['windowOptions'] = {
  getWinSizePixels: true,
  getCellSizePixels: true,
  getWinSizeChars: true,
  getScreenSizeChars: true,
  getIconTitle: true,
  getWinTitle: true,
  getWinState: true,
  getWinPosition: true,
  pushTitle: true,
  popTitle: true,
  setWinLines: true,
};

function makeTerm(options: ITerminalOptions = {}) {
  const term = new Terminal({ theme: THEME, convertEol: true, ...options });
  const host = document.createElement('div');
  document.body.appendChild(host);
  term.open(host);
  const out: string[] = [];
  term.onData((d) => out.push(d));
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  return { term, out, write };
}

const line0 = (term: Terminal) => term.buffer.active.getLine(0)?.translateToString(true);

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
    expect(line0(term)).toBe('hello');
  });

  it('accepts a terminal double without a parser', () => {
    const d = suppressTerminalReports({} as unknown as Terminal);
    expect(() => d.dispose()).not.toThrow();
  });
});

/** name, bytes, whether stock xterm 5.5.0 (windowOptions all on) answers this query today. */
const QUERIES: ReadonlyArray<readonly [string, string, boolean]> = [
  ['DA1', '\x1b[c', true],
  ['DA1 with 0', '\x1b[0c', true],
  ['DA2', '\x1b[>c', true],
  ['DA2 with 0', '\x1b[>0c', true],
  ['DA3', '\x1b[=c', false],
  ['DSR status', '\x1b[5n', true],
  ['DSR cursor position', '\x1b[6n', true],
  ['DEC DSR cursor position', '\x1b[?6n', true],
  ['DEC DSR printer status', '\x1b[?15n', false],
  ['DECRQM ansi', '\x1b[4$p', true],
  ['DECRQM private', '\x1b[?2004$p', true],
  ['XTVERSION', '\x1b[>q', false],
  ['XTVERSION with 0', '\x1b[>0q', false],
  ['window 11t', '\x1b[11t', false],
  ['window 14t', '\x1b[14t', true],
  ['window 16t', '\x1b[16t', true],
  ['window 18t', '\x1b[18t', true],
  ['window 21t', '\x1b[21t', false],
  ['DECRQSS sgr', '\x1bP$qm\x1b\\', true],
  ['DECRQSS decstbm', '\x1bP$qr\x1b\\', true],
  ['DECRQSS decscusr', '\x1bP$q q\x1b\\', true],
  ['XTGETTCAP', '\x1bP+q544e\x1b\\', false],
  ['OSC 4 ST', '\x1b]4;1;?\x1b\\', true],
  ['OSC 4 BEL', '\x1b]4;1;?\x07', true],
  ['OSC 10 ST', '\x1b]10;?\x1b\\', true],
  ['OSC 10 BEL', '\x1b]10;?\x07', true],
  ['OSC 11 ST', '\x1b]11;?\x1b\\', true],
  ['OSC 11 BEL', '\x1b]11;?\x07', true],
  ['OSC 12 ST', '\x1b]12;?\x1b\\', true],
  ['OSC 12 BEL', '\x1b]12;?\x07', true],
  ['OSC 10 double query', '\x1b]10;?;?\x07', true],
];

/** Guard-only (unguarded behaviour was not verified for these). */
const GUARD_ONLY: ReadonlyArray<readonly [string, string]> = [
  ['window 13t', '\x1b[13t'],
  ['window 15t', '\x1b[15t'],
  ['window 19t', '\x1b[19t'],
  ['window 20t', '\x1b[20t'],
];

const splits = (data: string): string[][] => {
  const all: string[][] = [[data]];
  for (let i = 1; i < data.length; i++) all.push([data.slice(0, i), data.slice(i)]);
  all.push(data.split(''));
  return all;
};

describe('terminalReports: every query family is silent', () => {
  it.each([...QUERIES.map(([n, d]) => [n, d] as const), ...GUARD_ONLY])(
    'silent whole, split at every offset, and byte by byte: %s',
    async (_name, data) => {
      const { term, out, write } = makeTerm({
        windowOptions: ALL_WINDOW_OPTIONS,
      });
      suppressTerminalReports(term);
      for (const chunks of splits(data)) {
        for (const c of chunks) await write(c);
      }
      await write('ok');
      expect(out).toEqual([]);
      expect(line0(term)).toBe('ok');
    },
  );

  it.each(QUERIES.filter(([, , answered]) => answered).map(([n, d]) => [n, d] as const))(
    'control: stock xterm answers (so the suppression is real): %s',
    async (_name, data) => {
      const { out, write } = makeTerm({ windowOptions: ALL_WINDOW_OPTIONS });
      await write(data);
      expect(out.length).toBeGreaterThan(0);
    },
  );

  it.each(QUERIES.filter(([, , answered]) => !answered).map(([n, d]) => [n, d] as const))(
    'control: stock xterm is silent today (update the table if this starts failing): %s',
    async (_name, data) => {
      const { out, write } = makeTerm({ windowOptions: ALL_WINDOW_OPTIONS });
      await write(data);
      expect(out).toEqual([]);
    },
  );

  it('a query between text renders the text and is silent', async () => {
    const { term, out, write } = makeTerm();
    suppressTerminalReports(term);
    await write('a\x1b[cb\x1b]11;?\x07c');
    expect(out).toEqual([]);
    expect(line0(term)).toBe('abc');
  });

  it('is answered again once the guard is disposed', async () => {
    const { term, out, write } = makeTerm();
    const guard = suppressTerminalReports(term);
    await write('\x1b[c');
    expect(out).toEqual([]);
    guard.dispose();
    await write('\x1b[c');
    expect(out).toEqual(['\x1b[?1;2c']);
  });
});

describe('terminalReports: setters are not consumed', () => {
  const probe = (term: Terminal, kind: 'osc' | 'csi', ident: number | { prefix?: string; final: string }) => {
    const calls: string[] = [];
    if (kind === 'osc') {
      term.parser.registerOscHandler(ident as number, (d) => {
        calls.push(d);
        return false;
      });
    } else {
      term.parser.registerCsiHandler(ident as { prefix?: string; final: string }, (p) => {
        calls.push(p.join(';'));
        return false;
      });
    }
    return calls;
  };

  it('OSC 10 set and OSC 4 set reach later handlers, OSC 10 query does not', async () => {
    const { term, write } = makeTerm();
    const osc10 = probe(term, 'osc', 10);
    const osc4 = probe(term, 'osc', 4);
    suppressTerminalReports(term);
    await write('\x1b]10;#123456\x07');
    await write('\x1b]4;1;rgb:ff/00/00\x07');
    expect(osc10).toEqual(['#123456']);
    expect(osc4).toEqual(['1;rgb:ff/00/00']);
    await write('\x1b]10;?\x07');
    expect(osc10).toEqual(['#123456']);
  });

  it('CSI 22/23 t (title push/pop) reach later handlers, CSI 18 t does not', async () => {
    // xterm only invokes custom CSI t handlers for operations enabled in windowOptions.
    const { term, write } = makeTerm({ windowOptions: ALL_WINDOW_OPTIONS });
    const t = probe(term, 'csi', { final: 't' });
    suppressTerminalReports(term);
    await write('\x1b[22;0t');
    await write('\x1b[23;0t');
    expect(t).toEqual(['22;0', '23;0']);
    await write('\x1b[18t');
    expect(t).toEqual(['22;0', '23;0']);
  });

  it('CSI > n (key modifier reset) is not consumed', async () => {
    const { term, write } = makeTerm();
    const n = probe(term, 'csi', { prefix: '>', final: 'n' });
    suppressTerminalReports(term);
    await write('\x1b[>4n');
    expect(n).toEqual(['4']);
  });

  it('a mixed set-and-query payload is consumed entirely and silent', async () => {
    const { term, out, write } = makeTerm();
    const osc10 = probe(term, 'osc', 10);
    suppressTerminalReports(term);
    await write('\x1b]10;#ffffff;?\x07');
    expect(out).toEqual([]);
    expect(osc10).toEqual([]);
  });

  it('helpers behave', () => {
    expect(isColorQuery('?')).toBe(true);
    expect(isColorQuery('1;?')).toBe(true);
    expect(isColorQuery('#123456')).toBe(false);
    expect(isColorQuery('1;rgb:ff/00/00')).toBe(false);
    expect(REPORTING_WINDOW_OPS.has(18)).toBe(true);
    expect(REPORTING_WINDOW_OPS.has(22)).toBe(false);
    expect(REPORTING_WINDOW_OPS.has(23)).toBe(false);
  });
});

describe('terminalReports: real input still reaches onData', () => {
  const key = (term: Terminal, init: KeyboardEventInit) => {
    term.textarea!.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  };

  const setup = () => {
    const t = makeTerm();
    suppressTerminalReports(t.term);
    return t;
  };

  it.each([
    ['ArrowUp', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, '\x1b[A'],
    ['Escape', { key: 'Escape', code: 'Escape', keyCode: 27 }, '\x1b'],
    ['Alt+x', { key: 'x', code: 'KeyX', keyCode: 88, altKey: true }, '\x1bx'],
    ['Ctrl+C', { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true }, '\x03'],
    ['Enter', { key: 'Enter', code: 'Enter', keyCode: 13 }, '\r'],
    ['Tab', { key: 'Tab', code: 'Tab', keyCode: 9 }, '\t'],
    // Shift+F3 is the byte string of a cursor-position report for row 1 column 2.
    ['Shift+F3 (equals a CPR byte string)', { key: 'F3', code: 'F3', keyCode: 114, shiftKey: true }, '\x1b[1;2R'],
  ] as const)('%s', (_name, init, expected) => {
    const { term, out } = setup();
    key(term, init);
    expect(out).toEqual([expected]);
  });

  it('term.input of a report-looking string passes through', () => {
    const { term, out } = setup();
    term.input('\x1b[1;2R');
    expect(out).toEqual(['\x1b[1;2R']);
  });

  it('non-bracketed paste passes through', () => {
    const { term, out } = setup();
    term.paste('hi');
    expect(out).toEqual(['hi']);
  });

  it('bracketed paste passes through, including report-looking text', async () => {
    const { term, out, write } = setup();
    await write('\x1b[?2004h');
    term.paste('hi');
    term.paste('\x1b[?1;2c');
    expect(out).toEqual(['\x1b[200~hi\x1b[201~', '\x1b[200~\x1b[?1;2c\x1b[201~']);
  });

  it('focus reports are sent only after the application enabled mode 1004', async () => {
    const { term, out, write } = setup();
    term.textarea!.dispatchEvent(new FocusEvent('focus'));
    term.textarea!.dispatchEvent(new FocusEvent('blur'));
    expect(out).toEqual([]);
    await write('\x1b[?1004h');
    // xterm reports the current focus state when the mode is enabled; only later transitions matter here.
    out.length = 0;
    term.textarea!.dispatchEvent(new FocusEvent('focus'));
    term.textarea!.dispatchEvent(new FocusEvent('blur'));
    expect(out).toEqual(['\x1b[I', '\x1b[O']);
  });
});
