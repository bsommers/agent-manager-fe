import type { Agent, AckOp, BroadcastResult, ErrorCode, WSMessageClient } from '../protocol/wsProtocol.js';
import { operationForClientMessage } from '../protocol/wsProtocol.js';
import type { AgentService } from '../services/AgentService.js';
import { fail } from '../services/serviceResult.js';
import type { ServiceError, ServiceResult } from '../services/serviceResult.js';
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

  constructor(private readonly service: AgentService) {}

  /**
   * Runs a message that already passed parseClientMessage. Synchronous operations have completed
   * when this returns; the promise settles when the outcome is final. It never rejects.
   */
  execute(msg: WSMessageClient): Promise<DispatchOutcome> {
    try {
      return this.route(msg).catch(() => failure('INTERNAL', 'internal error'));
    } catch {
      return Promise.resolve(failure('INTERNAL', 'internal error'));
    }
  }

  /** Counts and maps a failed parse to the USAGE or PAYLOAD_TOO_LARGE frame, or null for no reply. */
  reject(raw: unknown, parseFailure: ParseFailure) {
    const frame = rejectionFor(raw, parseFailure);
    if (frame) this.stats.invalidFrames += 1;
    return frame;
  }

  private route(msg: WSMessageClient): Promise<DispatchOutcome> {
    switch (msg.type) {
      case 'hello':
      case 'ping':
        return Promise.resolve({ ok: true });

      case 'agent:create': {
        const { name, mode, targetHost, initialCmd } = msg;
        const result = this.service.create({ name, mode, targetHost, initialCmd });
        return Promise.resolve(
          outcomeOf(result, (agent) => ({ op: 'create', agent: structuredClone(agent) }))
        );
      }

      case 'agent:kill': {
        if (operationForClientMessage(msg) === 'agent.kill') {
          return this.service
            .destroy(msg.agentId, { confirm: msg.confirm })
            .then((result) => outcomeOf(result, () => ({ op: 'kill' as const })));
        }
        return Promise.resolve(outcomeOf(this.service.close(msg.agentId), () => ({ op: 'kill' })));
      }

      case 'agent:update': {
        const result = this.service.update(msg.agentId, {
          name: msg.name,
          tags: msg.tags,
          group: msg.group,
        });
        return Promise.resolve(outcomeOf(result, (agent) => ({ op: 'update', agent })));
      }

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
}
