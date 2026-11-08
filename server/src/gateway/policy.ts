import { OPERATIONS } from '../protocol/wsProtocol.js';
import type { OperationSpec } from '../protocol/wsProtocol.js';
import { fail } from '../services/serviceResult.js';
import type { ServiceError } from '../services/serviceResult.js';

/** One destructive operation and the boolean parameter that must be exactly true before it runs. */
export interface DestructiveRule {
  /** Catalog operation name (e.g. agent.kill). */
  operation: string;
  /** The parameter that carries the confirmation (e.g. confirm). */
  confirmParam: string;
  /** The wire field named in the refusal message: the ws discriminator when it selects this operation, else the operation. */
  field: string;
}

/**
 * Derives the destructive-operation rules from the operations catalog: one per operation whose
 * destructive flag is true. There is no second list. Fails closed: a destructive operation without
 * a confirmParam throws, so the gateway cannot start with an unguarded destructive operation.
 */
export function destructiveRules(
  catalog: Readonly<Record<string, OperationSpec>> = OPERATIONS
): DestructiveRule[] {
  const rules: DestructiveRule[] = [];
  for (const [operation, spec] of Object.entries(catalog)) {
    if (!spec.destructive) continue;
    if (typeof spec.confirmParam !== 'string' || spec.confirmParam.length === 0) {
      throw new Error(`policy: destructive operation ${operation} has no confirmParam`);
    }
    const ws = spec.ws;
    const field = !('none' in ws) && ws.when !== undefined && ws.when.is ? ws.when.field : operation;
    rules.push({ operation, confirmParam: spec.confirmParam, field });
  }
  return rules;
}

function isWireId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 128;
}

/**
 * The policy stage: null when the operation has no rule or its confirm parameter is exactly the boolean
 * true; otherwise a USAGE ServiceError with a fixed message. A refusal writes one warning line carrying
 * the operation and the agent id truncated to 64 characters, never the frame.
 */
export function checkDestructivePolicy(
  operation: string | null,
  params: Readonly<Record<string, unknown>>,
  rules: readonly DestructiveRule[]
): ServiceError | null {
  if (operation === null) return null;
  const rule = rules.find((r) => r.operation === operation);
  if (rule === undefined) return null;
  if (params[rule.confirmParam] === true) return null;

  const agentId = params.agentId;
  const shown = typeof agentId === 'string' ? agentId.slice(0, 64) : '?';
  console.warn(`policy: ${operation} refused (USAGE) for agent ${shown}`);
  const result = fail(
    'USAGE',
    `${rule.field} requires ${rule.confirmParam}: true`,
    isWireId(agentId) ? { retryable: false, agentId } : { retryable: false }
  );
  if (result.ok) throw new Error('policy: unreachable');
  return result.error;
}
