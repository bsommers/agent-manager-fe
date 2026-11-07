import type { Agent } from '../types/agent';

/** A create request that was delivered to the gateway but not yet confirmed by a snapshot. */
export interface PendingCreate {
  name: string;
  mode: Agent['mode'];
  targetHost: string;
  startedAt: number;
}

/** Pending id (e.g. "pending-3") to its request. Keys are not integer-like, so insertion order is creation order. */
export type PendingMap = Record<string, PendingCreate>;

export interface ReconcileResult {
  agents: Agent[];
  pending: PendingMap;
  /** pending id -> server agent id, for every pending create claimed by this snapshot */
  claimed: Record<string, string>;
  /** ids of non-pending local agents the snapshot no longer lists */
  removedIds: string[];
}

/**
 * Pure reconciliation of the local roster with a full server snapshot.
 * Replace by id, keep local layout, claim pending creates by name/mode/targetHost in FIFO order.
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
  for (const a of local) {
    if (!Object.prototype.hasOwnProperty.call(pending, a.id)) knownIds.add(a.id);
  }

  // Fresh = in the snapshot, not in the roster before.
  const fresh = snapOrder.filter((a) => !knownIds.has(a.id));
  const claimedFresh = new Set<string>();
  const claimed: Record<string, string> = {};

  for (const pendingId of Object.keys(pending)) {
    const req = pending[pendingId];
    const match = fresh.find(
      (a) =>
        !claimedFresh.has(a.id) &&
        a.name === req.name &&
        a.mode === req.mode &&
        a.targetHost === req.targetHost,
    );
    if (match) {
      claimedFresh.add(match.id);
      claimed[pendingId] = match.id;
    }
  }

  const agents: Agent[] = [];
  const removedIds: string[] = [];
  for (const a of local) {
    if (Object.prototype.hasOwnProperty.call(pending, a.id)) {
      const serverId = claimed[a.id];
      if (serverId !== undefined) {
        const server = snapById.get(serverId) as Agent;
        agents.push({ ...server, layout: a.layout, unreadOutput: false });
      } else {
        agents.push(a);
      }
      continue;
    }
    const server = snapById.get(a.id);
    if (server) {
      agents.push({ ...server, layout: a.layout, unreadOutput: a.unreadOutput });
    } else {
      removedIds.push(a.id);
    }
  }
  for (const a of fresh) {
    if (!claimedFresh.has(a.id)) agents.push(a);
  }

  const nextPending: PendingMap = {};
  for (const key of Object.keys(pending)) {
    if (!(key in claimed)) nextPending[key] = pending[key];
  }

  return { agents, pending: nextPending, claimed, removedIds };
}
