import { isRetryableByDefault } from '../protocol/wsProtocol.js';
import type { ErrorCode, WSMessageServer } from '../protocol/wsProtocol.js';

/** A typed, expected failure of a service operation. The message is always a fixed string. */
export interface ServiceError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  agentId?: string;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

export function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  opts: { retryable?: boolean; agentId?: string } = {}
): ServiceResult<T> {
  const error: ServiceError = {
    code,
    message,
    retryable: opts.retryable ?? isRetryableByDefault(code),
  };
  if (opts.agentId !== undefined) error.agentId = opts.agentId;
  return { ok: false, error };
}

function isWireId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 128;
}

/** Builds the agent:error frame for a service error; the single place every WS error reply is built. */
export function errorFrame(
  error: ServiceError,
  reqId?: string
): Extract<WSMessageServer, { type: 'agent:error' }> {
  return {
    type: 'agent:error',
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(isWireId(error.agentId) ? { agentId: error.agentId } : {}),
    ...(isWireId(reqId) ? { reqId } : {}),
  };
}
