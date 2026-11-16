import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { submitToken } from '../submitToken';
import { agentSocket } from '../../agentSocket';
import { getToken, clearToken, commitCandidate, useAuthStore, TOKEN_STORAGE_KEY } from '../../auth/tokenStore';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  clearToken();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('submitToken', () => {
  it('holds a valid token in memory only, connects exactly once and returns ok (WR-03)', () => {
    const connect = vi.spyOn(agentSocket.getAdapter(), 'connect');
    const re = vi.spyOn(agentSocket.getAdapter(), 'reconnectNow');
    const r = submitToken('a'.repeat(24));
    expect(r).toEqual({ ok: true });
    // Used by the next hello, but not persisted and not shown as logged in until the gateway accepts it.
    expect(getToken()).toBe('a'.repeat(24));
    expect(useAuthStore.getState().hasToken).toBe(false);
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(re).not.toHaveBeenCalled();
  });

  it('persists the token only when the gateway accepts it', () => {
    vi.spyOn(agentSocket.getAdapter(), 'connect').mockImplementation(() => {});
    submitToken('b'.repeat(24));
    commitCandidate();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe('b'.repeat(24));
    expect(useAuthStore.getState().hasToken).toBe(true);
  });

  it('refuses with feedback and stores nothing while the adapter is disabled by a config error', () => {
    const adapter = agentSocket.getAdapter();
    const connect = vi.spyOn(adapter, 'connect');
    Object.defineProperty(adapter, 'disabledReason', { value: 'Plaintext ws:// to "gw" is refused', configurable: true });
    try {
      const r = submitToken('c'.repeat(24));
      expect(r).toEqual({ ok: false, reason: 'Plaintext ws:// to "gw" is refused' });
      expect(getToken()).toBeUndefined();
      expect(sessionStorage.length).toBe(0);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      delete (adapter as { disabledReason?: unknown }).disabledReason;
    }
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['inner space', 'abc def'],
    ['control character', 'abc\u0007def'],
    ['513 characters', 'x'.repeat(513)],
  ])('rejects %s without storing or connecting', (_n, value) => {
    const connect = vi.spyOn(agentSocket.getAdapter(), 'connect');
    const re = vi.spyOn(agentSocket.getAdapter(), 'reconnectNow');
    const r = submitToken(value);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.length).toBeGreaterThan(0);
      if (value.trim().length > 0) expect(r.reason).not.toContain(value);
    }
    expect(useAuthStore.getState().hasToken).toBe(false);
    expect(getToken()).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
    expect(connect).not.toHaveBeenCalled();
    expect(re).not.toHaveBeenCalled();
  });

  it('writes nothing to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
    submitToken('c'.repeat(24));
    submitToken('bad token');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
