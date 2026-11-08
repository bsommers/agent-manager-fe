import { describe, it, expect } from 'vitest';
import { ERROR_CODES, ERROR_HTTP_STATUS, isRetryableByDefault, parseHttpBody } from '../../protocol/wsProtocol.js';
import { errorEnvelope, outcomeToHttp, sanitizeField, statusFor } from '../envelope.js';

describe('statusFor', () => {
  it.each(ERROR_CODES.map((c) => [c]))('returns the contract status for %s', (code) => {
    expect(statusFor(code)).toBe(ERROR_HTTP_STATUS[code]);
  });

  it('maps the codes the router relies on to the documented statuses', () => {
    expect(statusFor('USAGE')).toBe(400);
    expect(statusFor('FORBIDDEN')).toBe(403);
    expect(statusFor('NOT_FOUND')).toBe(404);
    expect(statusFor('CONFLICT')).toBe(409);
    expect(statusFor('PAYLOAD_TOO_LARGE')).toBe(413);
    expect(statusFor('UNSUPPORTED')).toBe(422);
    expect(statusFor('INTERNAL')).toBe(500);
  });
});

describe('errorEnvelope', () => {
  it.each(ERROR_CODES.map((c) => [c]))('takes retryable from the default for %s and validates', (code) => {
    const body = errorEnvelope(code, 'fixed text');
    expect(body.error.retryable).toBe(isRetryableByDefault(code));
    expect(parseHttpBody('error', body).ok).toBe(true);
  });

  it('lets an explicit retryable override the default', () => {
    expect(errorEnvelope('BACKEND_DOWN', 'x', false).error.retryable).toBe(false);
    expect(errorEnvelope('USAGE', 'x', true).error.retryable).toBe(true);
  });

  it('has no key other than ok and error, and no detail', () => {
    const body = errorEnvelope('NOT_FOUND', 'agent not found');
    expect(Object.keys(body).sort()).toEqual(['error', 'ok']);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'retryable']);
    expect(body.ok).toBe(false);
  });
});

describe('sanitizeField', () => {
  it('names a safe field and nothing else', () => {
    expect(sanitizeField('name')).toBe('invalid field: name');
    expect(sanitizeField('params.key[0]')).toBe('invalid field: params.key[0]');
  });

  it.each([['<script>'], ['a b'], ['x'.repeat(65)], [''], [undefined], [42]])(
    'falls back to a fixed message for %s',
    (field) => {
      expect(sanitizeField(field)).toBe('invalid request');
    }
  );
});

describe('outcomeToHttp', () => {
  it('maps a failure to its status and envelope, dropping the agent id', () => {
    const reply = outcomeToHttp(
      { ok: false, error: { code: 'NOT_FOUND', message: 'agent not found', retryable: false, agentId: 'a1' } },
      () => ({ status: 200, body: {} })
    );
    expect(reply.status).toBe(404);
    expect(reply.body).toEqual(errorEnvelope('NOT_FOUND', 'agent not found', false));
  });

  it('uses the success mapping for an ok outcome', () => {
    const reply = outcomeToHttp({ ok: true }, () => ({ status: 200, body: { ok: true } }));
    expect(reply).toEqual({ status: 200, body: { ok: true } });
  });

  it('turns a success mapping that yields nothing into INTERNAL', () => {
    const reply = outcomeToHttp({ ok: true }, () => null);
    expect(reply.status).toBe(500);
    expect((reply.body as { error: { code: string } }).error.code).toBe('INTERNAL');
  });
});
