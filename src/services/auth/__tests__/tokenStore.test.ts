import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getToken,
  setToken,
  clearToken,
  validateToken,
  useAuthStore,
  STORAGE_PREFIX,
  TOKEN_STORAGE_KEY,
} from '../tokenStore';

const TOKEN = 'canary-token-0123456789abcdef';

beforeEach(() => {
  clearToken();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tokenStore', () => {
  it('uses the agent-manager. prefix and a single key', () => {
    expect(STORAGE_PREFIX).toBe('agent-manager.');
    expect(TOKEN_STORAGE_KEY).toBe('agent-manager.token');
  });

  it('setToken stores in memory and getToken returns it', () => {
    expect(setToken(TOKEN)).toEqual({ ok: true });
    expect(getToken()).toBe(TOKEN);
  });

  it('zustand holds only the boolean hasToken', () => {
    expect(useAuthStore.getState().hasToken).toBe(false);
    setToken(TOKEN);
    expect(useAuthStore.getState().hasToken).toBe(true);
    expect(JSON.stringify(useAuthStore.getState())).not.toContain(TOKEN);
    expect(JSON.stringify(useAuthStore.getState())).toBe('{"hasToken":true}');
  });

  it('clearToken empties memory, removes the key and clears hasToken', () => {
    setToken(TOKEN);
    clearToken();
    expect(getToken()).toBeUndefined();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(useAuthStore.getState().hasToken).toBe(false);
  });

  it('writes exactly one sessionStorage entry and never the persistent storage', () => {
    const persistent = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 };
    vi.stubGlobal('localStorage', persistent);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setToken(TOKEN);
    clearToken();
    setToken(TOKEN);
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(Object.keys(sessionStorage)).toEqual([TOKEN_STORAGE_KEY]);
    for (const fn of [persistent.getItem, persistent.setItem, persistent.removeItem, persistent.clear]) {
      expect(fn).not.toHaveBeenCalled();
    }
    for (const call of setItem.mock.calls) expect(call[0]).toBe(TOKEN_STORAGE_KEY);
  });

  it('survives a reload (module re-import restores from sessionStorage)', async () => {
    setToken(TOKEN);
    vi.resetModules();
    const fresh = await import('../tokenStore');
    expect(fresh.getToken()).toBe(TOKEN);
    expect(fresh.useAuthStore.getState().hasToken).toBe(true);
  });

  it('works in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => setToken(TOKEN)).not.toThrow();
    expect(getToken()).toBe(TOKEN);
    expect(() => clearToken()).not.toThrow();
    expect(getToken()).toBeUndefined();
  });

  it('a throwing storage at module load leaves a working empty store', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.resetModules();
    const fresh = await import('../tokenStore');
    expect(fresh.getToken()).toBeUndefined();
    expect(fresh.useAuthStore.getState().hasToken).toBe(false);
  });
});

describe('validateToken', () => {
  it('trims surrounding whitespace', () => {
    expect(validateToken(`  ${TOKEN}\n`)).toEqual({ ok: true, token: TOKEN });
    setToken(`  ${TOKEN} `);
    expect(getToken()).toBe(TOKEN);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \t '],
    ['inner space', 'abc def'],
    ['tab', 'abc\tdef'],
    ['newline', 'abc\ndef'],
    ['control char', 'abc\u0007def'],
    ['non-ascii', 'abcédef'],
    ['513 chars', 'a'.repeat(513)],
  ])('rejects %s with a fixed reason that never echoes the input', (_n, raw) => {
    const r = validateToken(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.length).toBeGreaterThan(0);
      if (raw.trim()) expect(r.reason).not.toContain(raw.trim());
    }
  });

  it.each([
    ['1 char', 'a'],
    ['512 chars', 'a'.repeat(512)],
    ['punctuation', 'a!"#$%&\'()*+,-./~'],
  ])('accepts %s', (_n, raw) => {
    expect(validateToken(raw)).toEqual({ ok: true, token: raw });
  });

  it('a rejected setToken leaves the previous token and storage untouched', () => {
    setToken(TOKEN);
    const r = setToken('bad token with spaces');
    expect(r.ok).toBe(false);
    expect(getToken()).toBe(TOKEN);
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(useAuthStore.getState().hasToken).toBe(true);
  });
});
