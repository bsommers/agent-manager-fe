import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { submitToken } from '../submitToken';
import { agentSocket } from '../../agentSocket';
import { getToken, clearToken, useAuthStore } from '../../auth/tokenStore';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  clearToken();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('submitToken', () => {
  it('stores a valid token, connects exactly once and returns ok', () => {
    const connect = vi.spyOn(agentSocket.getAdapter(), 'connect');
    const re = vi.spyOn(agentSocket.getAdapter(), 'reconnectNow');
    const r = submitToken('a'.repeat(24));
    expect(r).toEqual({ ok: true });
    expect(useAuthStore.getState().hasToken).toBe(true);
    expect(getToken()).toBe('a'.repeat(24));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(re).not.toHaveBeenCalled();
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
