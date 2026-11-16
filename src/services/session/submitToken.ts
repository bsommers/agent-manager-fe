import { agentSocket } from '../agentSocket';
import { setCandidate } from '../auth/tokenStore';

export type SubmitResult = { ok: true } | { ok: false; reason: string };

/**
 * The only restart path after auth_failed (D-05): validate the token, hold it in memory and make
 * exactly one connection attempt. The token is persisted only when the gateway acknowledges it
 * (WR-03), and refused outright while the adapter is disabled by a configuration error. Never
 * retries by itself, never echoes the input, writes nothing to a log.
 */
export function submitToken(raw: string): SubmitResult {
  const adapter = agentSocket.getAdapter();
  if (adapter.disabledReason) return { ok: false, reason: adapter.disabledReason };
  const r = setCandidate(raw);
  if (!r.ok) return { ok: false, reason: r.reason };
  adapter.connect();
  return { ok: true };
}
