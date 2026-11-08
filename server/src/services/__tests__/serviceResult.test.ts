import { describe, it, expect } from 'vitest';
import { parseServerMessage } from '@agent-manager/protocol';
import { ok, fail, errorFrame } from '../serviceResult.js';

describe('serviceResult', () => {
  it('ok wraps a value', () => {
    expect(ok(5)).toEqual({ ok: true, value: 5 });
  });

  it.each([
    ['USAGE', false],
    ['NOT_FOUND', false],
    ['BACKEND_DOWN', true],
    ['TIMEOUT', true],
  ] as const)('fail defaults retryable for %s to %s', (code, retryable) => {
    const r = fail(code, 'm');
    expect(r).toEqual({ ok: false, error: { code, message: 'm', retryable } });
  });

  it('fail honours a retryable override and carries the agent id', () => {
    const r = fail('USAGE', 'm', { retryable: true, agentId: 'a1' });
    expect(r).toEqual({ ok: false, error: { code: 'USAGE', message: 'm', retryable: true, agentId: 'a1' } });
  });

  it('errorFrame has the exact keys when neither id is present', () => {
    const r = fail('USAGE', 'm');
    if (r.ok) throw new Error('unreachable');
    const f = errorFrame(r.error);
    expect(f).toEqual({ type: 'agent:error', code: 'USAGE', message: 'm', retryable: false });
    expect(Object.keys(f).sort()).toEqual(['code', 'message', 'retryable', 'type']);
  });

  it('errorFrame includes agentId and reqId when valid and copies retryable', () => {
    const r = fail('BACKEND_DOWN', 'm', { agentId: 'a1' });
    if (r.ok) throw new Error('unreachable');
    const f = errorFrame(r.error, 'req-1');
    expect(f).toEqual({
      type: 'agent:error',
      code: 'BACKEND_DOWN',
      message: 'm',
      retryable: true,
      agentId: 'a1',
      reqId: 'req-1',
    });
  });

  it('errorFrame does not echo a 300-character agentId or reqId, nor empty ones', () => {
    const long = 'x'.repeat(300);
    const r = fail('NOT_FOUND', 'm', { agentId: long });
    if (r.ok) throw new Error('unreachable');
    expect(errorFrame(r.error, long)).not.toHaveProperty('agentId');
    expect(errorFrame(r.error, long)).not.toHaveProperty('reqId');
    const e = fail('NOT_FOUND', 'm', { agentId: '' });
    if (e.ok) throw new Error('unreachable');
    expect(errorFrame(e.error, '')).toEqual({
      type: 'agent:error',
      code: 'NOT_FOUND',
      message: 'm',
      retryable: false,
    });
  });

  it.each(['USAGE', 'NOT_FOUND', 'CONFLICT', 'UNSUPPORTED', 'BACKEND_DOWN', 'INTERNAL'] as const)(
    'every %s frame is accepted by parseServerMessage',
    (code) => {
      const r = fail(code, 'fixed', { agentId: 'a1' });
      if (r.ok) throw new Error('unreachable');
      expect(parseServerMessage(errorFrame(r.error, 'r1')).ok).toBe(true);
      expect(parseServerMessage(errorFrame(r.error)).ok).toBe(true);
    }
  );
});
