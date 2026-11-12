import { createHash, timingSafeEqual } from 'node:crypto';

/** The only operation callers get: is this candidate the configured token? */
export interface AuthGuard {
  verify(candidate: unknown): boolean;
}

const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

/**
 * Builds a guard for one token. Only the SHA-256 digest of the token is kept, in this closure:
 * it is not a property of the guard, not exported and not reachable from any shared object.
 * Both sides are hashed so the compared buffers are always 32 bytes and the candidate length is
 * not observable; the comparison itself is crypto.timingSafeEqual (D-06). Never throws, never logs.
 */
export function createAuthGuard(token: string): AuthGuard {
  const expected = digest(token);
  return {
    verify(candidate: unknown): boolean {
      if (typeof candidate !== 'string' || candidate === '') return false;
      return timingSafeEqual(digest(candidate), expected);
    },
  };
}

const BEARER = /^bearer ([^\s]+)$/i;

/** The single definition of the Authorization header parse (D-08): one scheme, one token, no extras. */
export function bearerOf(header: string | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const m = BEARER.exec(header);
  return m ? m[1] : undefined;
}

const REDACTED = '[redacted]';

/**
 * Replaces every occurrence of each secret, and of its SHA-256 hex, with [redacted]. Uses split and
 * join, never a regular expression built from a secret, so metacharacters are literal. Longest
 * first, so a secret that contains another is removed whole. Empty secrets are ignored.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret === '') continue;
    needles.add(secret);
    needles.add(createHash('sha256').update(secret, 'utf8').digest('hex'));
  }
  let out = text;
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    out = out.split(needle).join(REDACTED);
  }
  return out;
}

/**
 * An Error that is safe to log for a failure while handling a frame. A JSON SyntaxError quotes a
 * prefix of its input, so it becomes a fixed message; any other Error has the secrets redacted from
 * its message; anything else is a fixed message. Always an Error, so log call sites keep their shape.
 */
export function safeLogError(err: unknown, secrets: readonly string[]): Error {
  if (err instanceof SyntaxError) return new Error('frame is not valid JSON');
  if (err instanceof Error) return new Error(redactSecrets(err.message, secrets));
  return new Error('unexpected error while handling a frame');
}
