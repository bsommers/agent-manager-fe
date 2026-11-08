import type { Terminal, IDisposable } from '@xterm/xterm';

/**
 * Suppress xterm.js's automatic answers to terminal queries.
 *
 * Programs in the shell (tmux at attach, shells, editors) send queries such as "who are you"
 * (device attributes) or "what colour is your background". xterm.js answers by emitting the reply
 * through `onData`, the same event real keystrokes use, so the reply would be typed into the shell.
 *
 * We register handlers on the escape-sequence parser that return true for QUERIES only. A handler
 * that returns true stops xterm's built-in handler, so no reply is ever produced. Sequences that
 * SET state (OSC 10 with a value, CSI 22/23 t title push and pop) are left alone.
 *
 * Trade-off: an application that asks and waits gets no answer and falls back after its own
 * timeout, the documented behaviour of a terminal that does not support a query. The table below
 * is data: delete a row to re-enable one query family.
 */

type ParserLike = Terminal['parser'];
type Register = (parser: ParserLike) => IDisposable;

/** CSI Ps t window operations that make xterm send a report (the rest, e.g. 22/23 title push/pop, must still run). */
export const REPORTING_WINDOW_OPS: ReadonlySet<number> = new Set<number>([11, 13, 14, 15, 16, 18, 19, 20, 21]);

/** True when an OSC colour payload asks for the current value (a segment equal to "?"). */
export function isColorQuery(data: string): boolean {
  return data.split(';').includes('?');
}

interface Row {
  /** What the row stops xterm from answering. */
  readonly what: string;
  readonly register: Register;
}

const csi =
  (
    id: { prefix?: string; intermediates?: string; final: string },
    handler: (p: (number | number[])[]) => boolean = () => true,
  ): Row['register'] =>
  (p) =>
    p.registerCsiHandler(id, handler);
const dcs =
  (id: { intermediates: string; final: string }): Row['register'] =>
  (p) =>
    p.registerDcsHandler(id, () => true);
const osc =
  (ident: number): Row['register'] =>
  (p) =>
    p.registerOscHandler(ident, isColorQuery);

const TABLE: readonly Row[] = [
  {
    what: 'DA1 primary device attributes (CSI c)',
    register: csi({ final: 'c' }),
  },
  {
    what: 'DA2 secondary device attributes (CSI > c)',
    register: csi({ prefix: '>', final: 'c' }),
  },
  {
    what: 'DA3 tertiary device attributes (CSI = c)',
    register: csi({ prefix: '=', final: 'c' }),
  },
  {
    what: 'DSR status and cursor position (CSI 5 n, CSI 6 n)',
    register: csi({ final: 'n' }),
  },
  {
    what: 'DEC private DSR (CSI ? 6 n, CSI ? 15 n ...)',
    register: csi({ prefix: '?', final: 'n' }),
  },
  {
    what: 'DECRQM ansi mode request (CSI Ps $ p)',
    register: csi({ intermediates: '$', final: 'p' }),
  },
  {
    what: 'DECRQM private mode request (CSI ? Ps $ p)',
    register: csi({ prefix: '?', intermediates: '$', final: 'p' }),
  },
  { what: 'XTVERSION (CSI > q)', register: csi({ prefix: '>', final: 'q' }) },
  {
    what: 'window-state reports (CSI Ps t with a reporting Ps); title push/pop fall through to xterm',
    register: csi({ final: 't' }, (params) => {
      const first = params[0];
      return typeof first === 'number' && REPORTING_WINDOW_OPS.has(first);
    }),
  },
  {
    what: 'DECRQSS status string request (DCS $ q)',
    register: dcs({ intermediates: '$', final: 'q' }),
  },
  {
    what: 'XTGETTCAP termcap request (DCS + q)',
    register: dcs({ intermediates: '+', final: 'q' }),
  },
  { what: 'OSC 4 palette colour query', register: osc(4) },
  { what: 'OSC 10 foreground colour query', register: osc(10) },
  { what: 'OSC 11 background colour query', register: osc(11) },
  { what: 'OSC 12 cursor colour query', register: osc(12) },
];

/**
 * Install the query handlers on `term.parser`. Call right after `new Terminal` and before any
 * write. Returns one disposable that removes them all. A terminal without a parser (the partial
 * doubles used by some component tests) is tolerated and gets a no-op disposable.
 */
export function suppressTerminalReports(term: Pick<Terminal, 'parser'> | Terminal): IDisposable {
  const parser = (term as { parser?: ParserLike }).parser;
  if (!parser) return { dispose() {} };
  const disposables = TABLE.map((row) => row.register(parser));
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
