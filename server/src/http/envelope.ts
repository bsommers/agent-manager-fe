import { ERROR_HTTP_STATUS, isRetryableByDefault } from '../protocol/wsProtocol.js';
import type { ErrorBody, ErrorCode } from '../protocol/wsProtocol.js';
import type { DispatchOutcome } from '../gateway/dispatch.js';

/** The HTTP status the contract assigns to an error code. */
export function statusFor(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}

/** The contract's error body. `retryable` defaults from the code; the message must be a fixed string. */
export function errorEnvelope(code: ErrorCode, message: string, retryable?: boolean): ErrorBody {
  return {
    ok: false,
    error: { code, message, retryable: retryable ?? isRetryableByDefault(code) },
  };
}

/** Field paths that are safe to show in a message: letters, digits, underscore, dot and brackets. */
const SAFE_FIELD = /^[A-Za-z0-9_.[\]]{1,64}$/;

/** `invalid field: <name>` when the name is safe to show, else a fixed generic message. Never a value. */
export function sanitizeField(field: unknown): string {
  return typeof field === 'string' && SAFE_FIELD.test(field) ? `invalid field: ${field}` : 'invalid request';
}

export interface HttpReply {
  status: number;
  body: unknown;
}

/** Maps an AgentApi outcome to a status and body: a failure becomes the error envelope for its code. */
export function outcomeToHttp(
  outcome: DispatchOutcome,
  success: (outcome: Extract<DispatchOutcome, { ok: true }>) => HttpReply | null
): HttpReply {
  if (!outcome.ok) {
    const { code, message, retryable } = outcome.error;
    return { status: statusFor(code), body: errorEnvelope(code, message, retryable) };
  }
  return success(outcome) ?? { status: 500, body: errorEnvelope('INTERNAL', 'internal error') };
}
