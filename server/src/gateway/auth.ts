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
