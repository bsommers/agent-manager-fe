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
let current: string | undefined = readStored();

/** Zustand sees only whether a token exists; the secret itself never enters reactive state. */
export const useAuthStore = create<{ hasToken: boolean }>(() => ({ hasToken: current !== undefined }));

export function getToken(): string | undefined {
  return current;
}

export function setToken(raw: string): { ok: true } | { ok: false; reason: string } {
  const r = validateToken(raw);
  if (!r.ok) return { ok: false, reason: r.reason };
  current = r.token;
  writeStored(r.token);
  useAuthStore.setState({ hasToken: true });
  return { ok: true };
}

export function clearToken(): void {
  current = undefined;
  writeStored(undefined);
  useAuthStore.setState({ hasToken: false });
}
