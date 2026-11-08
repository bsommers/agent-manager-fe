import type { ParseResult, WSMessageClient, WSMessageServer } from '../protocol/wsProtocol.js';
import { errorFrame, fail } from '../services/serviceResult.js';
import type { DispatchOutcome } from './dispatch.js';

export type ParseFailure = Extract<ParseResult<unknown>, { ok: false }>;

type ServerFrame = WSMessageServer;

/** Field paths that are safe to show: letters, digits, underscore, dot and brackets, at most 64 characters. */
const SAFE_FIELD = /^[A-Za-z0-9_.[\]]{1,64}$/;

function isWireId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 128;
}

/** An own string property of an untrusted frame, or undefined. Never reads the prototype chain. */
function ownString(raw: unknown, key: string): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return undefined;
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * The only mapping from an execution outcome to the frames sent back to the requester: one
 * agent:ack for an acknowledged operation that carried a reqId, one agent:error for a failure.
 * agent:input and agent:resize never reply (no reqId, and a per-keystroke error would flood the socket).
 */
export function repliesFor(msg: WSMessageClient, outcome: DispatchOutcome): ServerFrame[] {
  const reqId = 'reqId' in msg ? msg.reqId : undefined;
  if (outcome.ok) {
    if (!outcome.ack || !isWireId(reqId)) return [];
    return [
      {
        type: 'agent:ack',
        reqId,
        op: outcome.ack.op,
        ok: true,
        ...(outcome.ack.agent ? { agent: outcome.ack.agent } : {}),
      },
    ];
  }
  if (msg.type === 'agent:input' || msg.type === 'agent:resize') return [];
  return [errorFrame(outcome.error, reqId)];
}

/**
 * The reply to a frame of a known type that failed validation: one USAGE error naming the field
 * (never the value), or PAYLOAD_TOO_LARGE for oversized terminal input. Null means no reply: unknown
 * types are ignored and non-objects are logged by the caller.
 */
export function rejectionFor(
  raw: unknown,
  failure: ParseFailure
): Extract<ServerFrame, { type: 'agent:error' }> | null {
  if (failure.reason !== 'invalid_field') return null;
  const field = typeof failure.field === 'string' && SAFE_FIELD.test(failure.field) ? failure.field : undefined;
  const message = field ? `invalid field: ${field}` : 'invalid frame';

  const reqId = ownString(raw, 'reqId');
  const agentId = ownString(raw, 'agentId');
  const result = fail('USAGE', message, {
    retryable: false,
    ...(isWireId(agentId) ? { agentId } : {}),
  });
  if (result.ok) return null;
  return errorFrame(result.error, isWireId(reqId) ? reqId : undefined);
}
