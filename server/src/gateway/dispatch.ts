import type { Agent, AckOp, BroadcastResult, ErrorCode, WSMessageClient } from '../protocol/wsProtocol.js';
import { operationForClientMessage } from '../protocol/wsProtocol.js';
import type { AgentService } from '../services/AgentService.js';
import { fail } from '../services/serviceResult.js';
import type { ServiceError, ServiceResult } from '../services/serviceResult.js';
import { IdempotencyCache, fingerprintOf } from './idempotency.js';
import { checkDestructivePolicy, destructiveRules } from './policy.js';
import type { DestructiveRule } from './policy.js';
import { rejectionFor } from './wsFrames.js';
import type { ParseFailure } from './wsFrames.js';

/** What an acknowledged operation reports; wsFrames turns it into agent:ack when the request had a reqId. */
export interface AckDescriptor {
  op: AckOp;
  agent?: Agent;
}

/** The typed result of executing one validated client message. */
export type DispatchOutcome =
  | { ok: true; ack?: AckDescriptor; results?: BroadcastResult[] }
  | { ok: false; error: ServiceError };

export interface ApiStats {
  /** Known-type frames the validator rejected (unknown types and non-objects are not counted). */
  invalidFrames: number;
}

/** Builds a failed outcome with a fixed message. */
export function failure(
  code: ErrorCode,
  message: string,
  opts: { retryable?: boolean; agentId?: string } = {}
): DispatchOutcome {
  const r = fail(code, message, opts);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * An exception escaped a route or service call. Logs a bounded line (operation + truncated message) for
 * the operator; the reply to the client is a fixed string and never echoes the error.
 */
function internalFailure(msg: WSMessageClient, err: unknown): DispatchOutcome {
  const detail = String((err as { message?: unknown } | null | undefined)?.message ?? err)
    .slice(0, 200)
    .replace(/[\r\n]+/g, ' ');
  console.error(`dispatch: ${String(msg.type).slice(0, 64)} failed with an internal error: ${detail}`);
  return failure('INTERNAL', 'internal error');
}

function outcomeOf<T>(result: ServiceResult<T>, ack?: (value: T) => AckDescriptor): DispatchOutcome {
  if (!result.ok) return { ok: false, error: result.error };
  return ack ? { ok: true, ack: ack(result.value) } : { ok: true };
}

/**
 * The one dispatch path from a validated client message to the service layer. Each operation calls
 * exactly one service method. Transport wrappers (the WS reply layer, the HTTP handler) share it.
 */
export class AgentApi {
  readonly stats: ApiStats = { invalidFrames: 0 };

  /** The reqId store; share an AgentApi (or pass the same cache) to share idempotency across surfaces. */
  readonly cache: IdempotencyCache;

  /** Destructive-operation rules, derived from the operations catalog unless a test injects its own. */
  private readonly rules: readonly DestructiveRule[];

  constructor(
    private readonly service: AgentService,
    options: { cache?: IdempotencyCache; rules?: readonly DestructiveRule[] } = {}
  ) {
    this.cache = options.cache ?? new IdempotencyCache();
    this.rules = options.rules ?? destructiveRules();
  }

  /**
   * Runs a message that already passed parseClientMessage. Synchronous operations have completed
   * when this returns; the promise settles when the outcome is final. It never rejects.
   */
  execute(msg: WSMessageClient): Promise<DispatchOutcome> {
    try {
      return this.route(msg).catch((err: unknown) => internalFailure(msg, err));
    } catch (err) {
      return Promise.resolve(internalFailure(msg, err));
    }
  }

  /** Counts and maps a failed parse to the USAGE or PAYLOAD_TOO_LARGE frame, or null for no reply. */
  reject(raw: unknown, parseFailure: ParseFailure) {
    const frame = rejectionFor(raw, parseFailure);
    if (frame) this.stats.invalidFrames += 1;
    return frame;
  }

  private route(msg: WSMessageClient): Promise<DispatchOutcome> {
    // Policy stage: first, before the idempotency cache, any registry lookup or any process.
    const refusal = checkDestructivePolicy(
      operationForClientMessage(msg),
      msg as unknown as Record<string, unknown>,
      this.rules
    );
    if (refusal) return Promise.resolve({ ok: false, error: refusal });

    switch (msg.type) {
      case 'hello':
      case 'ping':
        return Promise.resolve({ ok: true });

      case 'agent:create': {
        // Fields this gateway cannot honour are refused, never silently dropped, and never cached.
        if (msg.backend !== undefined) {
          return Promise.resolve(
            failure('UNSUPPORTED', 'backends other than the local gateway are not available')
          );
        }
        if (msg.params !== undefined && Object.keys(msg.params).length > 0) {
          return Promise.resolve(
            failure('UNSUPPORTED', 'create parameters are not supported by this backend')
          );
        }
        const { name, mode, targetHost, initialCmd } = msg;
        return this.idempotent(msg, 'agent.create', () => {
          const result = this.service.create({ name, mode, targetHost, initialCmd });
          return Promise.resolve(
            outcomeOf(result, (agent) => ({ op: 'create', agent: structuredClone(agent) }))
          );
        });
      }

      case 'agent:kill': {
        if (operationForClientMessage(msg) === 'agent.kill') {
          return this.idempotent(msg, 'agent.kill', () =>
            this.service
              .destroy(msg.agentId, { confirm: msg.confirm })
              .then((result) => outcomeOf(result, () => ({ op: 'kill' as const })))
          );
        }
        return this.idempotent(msg, 'agent.close', () =>
          Promise.resolve(outcomeOf(this.service.close(msg.agentId), () => ({ op: 'kill' as const })))
        );
      }

      case 'agent:update':
        return this.idempotent(msg, 'agent.update', () => {
          const result = this.service.update(msg.agentId, {
            name: msg.name,
            tags: msg.tags,
            group: msg.group,
          });
          return Promise.resolve(
            outcomeOf(result, (agent) => ({ op: 'update' as const, agent: structuredClone(agent) }))
          );
        });

      case 'agent:input':
        return Promise.resolve(outcomeOf(this.service.input(msg.agentId, msg.data)));

      case 'agent:resize':
        return Promise.resolve(outcomeOf(this.service.resize(msg.agentId, msg.cols, msg.rows)));

      case 'agent:broadcast':
        return Promise.resolve({
          ok: true,
          results: this.service.broadcast(msg.targetAgentIds, msg.data),
        });

      case 'agent:history':
      case 'agent:approve':
        return Promise.resolve(
          failure('UNSUPPORTED', 'this operation is not supported by this gateway', {
            agentId: msg.agentId,
          })
        );
    }
  }

  /** Runs `exec` once per reqId when the message carries one; without a reqId nothing is cached. */
  private idempotent(
    msg: WSMessageClient & { reqId?: string },
    operation: string,
    exec: () => Promise<DispatchOutcome>
  ): Promise<DispatchOutcome> {
    if (typeof msg.reqId !== 'string') return exec();
    return this.cache.run(msg.reqId, fingerprintOf(operation, msg), exec);
  }
}
