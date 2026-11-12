import { getToken } from './auth/tokenStore';

/** Replacement text for every secret occurrence. */
export const REDACTED = '[REDACTED]';

/** The secrets this client currently holds. Phase 21's diagnostics export passes these through the redactor. */
export function knownSecrets(): string[] {
  const token = getToken();
  return token ? [token] : [];
}

function ordered(secrets: readonly string[]): string[] {
  return secrets.filter((s) => typeof s === 'string' && s.length > 0).sort((a, b) => b.length - a.length);
}

/**
 * Replaces every occurrence of every secret (longest first, literal match: no regular expression is
 * ever built from a secret).
 */
export function redactSecrets(text: string, secrets: readonly string[] = knownSecrets()): string {
  let out = text;
  for (const secret of ordered(secrets)) out = out.split(secret).join(REDACTED);
  return out;
}

/**
 * Deep copy of a JSON-like value with the secret replaced inside every string. Keys, numbers,
 * booleans and null are left alone; the input is never mutated; a cycle becomes the string
 * "[Circular]" instead of recursing.
 */
export function redactJson<T>(value: T, secrets: readonly string[] = knownSecrets()): T {
  const list = ordered(secrets);
  const active = new Set<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redactSecrets(v, list);
    if (v === null || typeof v !== 'object') return v;
    if (active.has(v)) return '[Circular]';
    if (v instanceof Date) return new Date(v.getTime());
    active.add(v);
    try {
      if (Array.isArray(v)) return v.map(walk);
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(v)) copy[key] = walk((v as Record<string, unknown>)[key]);
      return copy;
    } finally {
      active.delete(v);
    }
  };
  return walk(value) as T;
}
