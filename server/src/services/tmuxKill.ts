import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * A tmux session name the gateway is willing to kill: starts with a letter, digit or underscore
 * (never a hyphen, which tmux would read as an option), then letters, digits, underscore or hyphen,
 * 1 to 64 characters. No colon or dot (tmux rewrites them and uses them in target syntax), no
 * whitespace or metacharacters, no non-ASCII.
 */
export const TMUX_SESSION_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

export function isKillableTmuxSessionName(name: unknown): name is string {
  return typeof name === 'string' && TMUX_SESSION_NAME_RE.test(name);
}

/** The session an agent is attached to: the part after the first colon, else the whole string. */
export function tmuxSessionNameOf(targetHost: string): string {
  return targetHost.includes(':') ? targetHost.split(':')[1] : targetHost;
}

export type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean }
) => Promise<{ stdout: unknown; stderr: unknown }>;

const defaultExec = promisify(execFile) as unknown as ExecFileLike;

const ALREADY_GONE = [/can't find session/i, /no server running/i, /error connecting to/i];

/**
 * Ends one tmux session. Runs `tmux kill-session -t =<name>` with an argument array (the `=`
 * prefix demands an exact name match instead of tmux's prefix and pattern matching). Resolves
 * 'already_gone' when the session or the server does not exist; throws for any other failure
 * and, without running anything, for a name that is not killable.
 */
export async function killTmuxSession(
  name: string,
  run: ExecFileLike = defaultExec
): Promise<'killed' | 'already_gone'> {
  if (!isKillableTmuxSessionName(name)) {
    throw new Error('tmux session name is not killable');
  }
  try {
    await run('tmux', ['kill-session', '-t', `=${name}`], { timeout: 5000, windowsHide: true });
    return 'killed';
  } catch (err) {
    const stderr = String((err as { stderr?: unknown } | null)?.stderr ?? '');
    if (ALREADY_GONE.some((re) => re.test(stderr))) return 'already_gone';
    throw err;
  }
}
