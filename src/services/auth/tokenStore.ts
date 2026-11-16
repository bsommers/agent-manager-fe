import { create } from 'zustand';

/** Every browser-storage key this app writes starts with this prefix. */
export const STORAGE_PREFIX = 'agent-manager.';
/** The single sessionStorage entry holding the token (D-01): tab-scoped, gone on tab close. */
export const TOKEN_STORAGE_KEY = `${STORAGE_PREFIX}token`;

const MAX_TOKEN_LENGTH = 512;
/** 1 to 512 printable ASCII characters, no spaces: the gateway's rule minus its minimum length. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

const REJECT_REASON = 'Token must be 1 to 512 printable characters with no spaces';

export type TokenValidation = { ok: true; token: string } | { ok: false; reason: string };

export function validateToken(raw: string): TokenValidation {
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (token.length < 1 || token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
    return { ok: false, reason: REJECT_REASON };
  }
  return { ok: true, token };
}

function readStored(): string | undefined {
  try {
    const v = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (v === null) return undefined;
    const r = validateToken(v);
    return r.ok ? r.token : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(token: string | undefined): void {
  try {
    if (token === undefined) sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    else sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* storage unavailable: memory only */
  }
}

// The only place the secret lives besides the one sessionStorage entry.
/** A token the gateway has accepted (or one restored from this tab's sessionStorage). */
let current: string | undefined = readStored();
/** A typed token not yet confirmed by a hello_ack: memory only, never written to storage (WR-03). */
let candidate: string | undefined;

/** Zustand sees only whether a token exists; the secret itself never enters reactive state. */
export const useAuthStore = create<{ hasToken: boolean }>(() => ({ hasToken: current !== undefined }));

/** The token the next hello carries: an unconfirmed candidate wins over the stored one. */
export function getToken(): string | undefined {
  return candidate ?? current;
}

/** Stores a token immediately (memory and sessionStorage). The login flow uses setCandidate instead. */
export function setToken(raw: string): { ok: true } | { ok: false; reason: string } {
  const r = validateToken(raw);
  if (!r.ok) return { ok: false, reason: r.reason };
  current = r.token;
  candidate = undefined;
  writeStored(r.token);
  useAuthStore.setState({ hasToken: true });
  return { ok: true };
}

/**
 * Holds a typed token in memory for the next connection attempt without persisting it. It becomes
 * the stored token only through commitCandidate() once the gateway acknowledges it (WR-03).
 */
export function setCandidate(raw: string): { ok: true } | { ok: false; reason: string } {
  const r = validateToken(raw);
  if (!r.ok) return { ok: false, reason: r.reason };
  candidate = r.token;
  return { ok: true };
}

/** The gateway accepted the token in use: persist a pending candidate. No-op without one. */
export function commitCandidate(): void {
  if (candidate === undefined) return;
  current = candidate;
  candidate = undefined;
  writeStored(current);
  useAuthStore.setState({ hasToken: true });
}

export function clearToken(): void {
  current = undefined;
  candidate = undefined;
  writeStored(undefined);
  useAuthStore.setState({ hasToken: false });
}
