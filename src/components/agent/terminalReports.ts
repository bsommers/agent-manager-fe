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

/** Query families suppressed so far. */
export const REPORTING_WINDOW_OPS: ReadonlySet<number> = new Set<number>();

/** True when an OSC colour payload asks for the current value (a segment equal to "?"). */
export function isColorQuery(data: string): boolean {
  return data.split(';').includes('?');
}

interface Row {
  /** What the row stops xterm from answering. */
  readonly what: string;
  readonly register: Register;
}

const TABLE: readonly Row[] = [
  { what: 'DA1 primary device attributes (CSI c)', register: (p) => p.registerCsiHandler({ final: 'c' }, () => true) },
  {
    what: 'DA2 secondary device attributes (CSI > c)',
    register: (p) => p.registerCsiHandler({ prefix: '>', final: 'c' }, () => true),
  },
  { what: 'OSC 10 foreground colour query', register: (p) => p.registerOscHandler(10, isColorQuery) },
  { what: 'OSC 11 background colour query', register: (p) => p.registerOscHandler(11, isColorQuery) },
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
