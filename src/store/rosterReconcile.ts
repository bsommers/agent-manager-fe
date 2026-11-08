import type { Agent } from '../types/agent';

/** A create request that was delivered to the gateway but not yet answered. */
export interface PendingCreate {
  name: string;
  mode: Agent['mode'];
  targetHost: string;
  startedAt: number;
  /** Correlation key of the in-flight request; optional so hand-built entries in tests keep compiling. */
  reqId?: string;
}

/** Pending id (e.g. "pending-3") to its request. Keys are not integer-like, so insertion order is creation order. */
export type PendingMap = Record<string, PendingCreate>;

export interface ReconcileResult {
  agents: Agent[];
  pending: PendingMap;
  /** ids of non-pending local agents the snapshot no longer lists */
  removedIds: string[];
}

/**
 * Pure reconciliation of the local roster with a full server snapshot.
 * Replace by id, keep local layout and unreadOutput, keep pending panes untouched (their request's
 * answer settles them, never a field comparison), drop agents the snapshot no longer lists.
 * Never mutates its inputs.
 */
export function reconcileSnapshot(
  local: readonly Agent[],
  pending: Readonly<PendingMap>,
  snapshot: readonly Agent[],
): ReconcileResult {
  // Collapse duplicate ids, keep the first.
  const snapById = new Map<string, Agent>();
  const snapOrder: Agent[] = [];
  for (const a of snapshot) {
    if (snapById.has(a.id)) continue;
    snapById.set(a.id, a);
    snapOrder.push(a);
  }

  const knownIds = new Set<string>();
  const agents: Agent[] = [];
  const removedIds: string[] = [];
  for (const a of local) {
    if (Object.prototype.hasOwnProperty.call(pending, a.id)) {
      agents.push(a);
      continue;
    }
    knownIds.add(a.id);
    const server = snapById.get(a.id);
    if (server) {
      agents.push({ ...server, layout: a.layout, unreadOutput: a.unreadOutput });
    } else {
      removedIds.push(a.id);
    }
  }
  for (const a of snapOrder) {
    if (!knownIds.has(a.id)) agents.push(a);
  }

  return { agents, pending: { ...pending }, removedIds };
}
