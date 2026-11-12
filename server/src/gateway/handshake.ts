import { CONTRACT_VERSION, LIMITS, parseClientMessage } from '../protocol/wsProtocol.js';
import type { WSMessageClient, WSMessageServer } from '../protocol/wsProtocol.js';
import type { AuthGuard } from './auth.js';

/** Close code: unauthenticated, or no valid hello in time (contract spec 2.6). */
export const CLOSE_UNAUTHENTICATED = 4401;
/** Close code: rate limited; the reason text carries the retry delay (contract spec 2.6). */
export const CLOSE_RATE_LIMITED = 4429;
/** A socket that has not sent a valid hello by now is closed 4401 (D-07). */
export const HELLO_TIMEOUT_MS = 5000;
/** The first frame of an unauthenticated socket is capped far below maxPayload; a hello is a few hundred bytes. */
export const MAX_PREAUTH_FRAME_BYTES = 16384;
/** Fixed close reason for every 4401; never describes why, so it cannot act as an oracle. */
export const UNAUTHENTICATED_REASON = 'unauthenticated';

export const GATEWAY_NAME = 'agent-manager-gateway';
/** Equals server/package.json version (pinned by a drift test). */
export const GATEWAY_VERSION = '1.0.0';
/** Only what dispatch.ts implements: agent:history and agent:approve are routed to UNSUPPORTED. */
export const GATEWAY_CAPABILITIES = ['terminal', 'broadcast'] as const;

export type HelloRejectReason =
  | 'oversize'
  | 'malformed'
  | 'not_hello'
  | 'invalid_hello'
  | 'missing_token'
  | 'bad_token';

type HelloMessage = Extract<WSMessageClient, { type: 'hello' }>;

/** The reject arm carries only a reason, never text from the frame. */
export type HelloVerdict =
  | { kind: 'ok'; hello: HelloMessage }
  | { kind: 'reject'; reason: HelloRejectReason };

const reject = (reason: HelloRejectReason): HelloVerdict => ({ kind: 'reject', reason });

/** The single pre-auth decision (D-07, D-13). Pure: no logging, no I/O. */
export function checkHello(raw: string, guard: AuthGuard): HelloVerdict {
  if (Buffer.byteLength(raw, 'utf8') > MAX_PREAUTH_FRAME_BYTES) return reject('oversize');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The thrown SyntaxError quotes a prefix of the input; it is discarded on purpose.
    return reject('malformed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return reject('malformed');
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== 'string') return reject('malformed');
  if (type !== 'hello') return reject('not_hello');

  const result = parseClientMessage(parsed);
  if (!result.ok || result.msg.type !== 'hello') return reject('invalid_hello');

  const token = result.msg.token;
  if (token === undefined || token === '') return reject('missing_token');
  if (!guard.verify(token)) return reject('bad_token');
  return { kind: 'ok', hello: result.msg };
}

/** The hello_ack the gateway sends once a hello is accepted (or at once, with no token configured). */
export function buildHelloAck(opts: { epoch: string; authRequired: boolean }): Extract<
  WSMessageServer,
  { type: 'hello_ack' }
> {
  return {
    type: 'hello_ack',
    contract: CONTRACT_VERSION,
    epoch: opts.epoch,
    server: { name: GATEWAY_NAME, version: GATEWAY_VERSION },
    auth: { required: opts.authRequired },
    limits: {
      maxFrameBytes: LIMITS.MAX_FRAME_BYTES,
      maxInputBytes: LIMITS.MAX_INPUT_BYTES,
      maxBroadcastTargets: LIMITS.MAX_BROADCAST_TARGETS,
    },
    backends: [{ id: 'local', label: 'Local', up: true, capabilities: [...GATEWAY_CAPABILITIES] }],
  };
}
