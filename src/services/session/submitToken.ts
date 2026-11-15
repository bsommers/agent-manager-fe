import { agentSocket } from '../agentSocket';
import { setToken } from '../auth/tokenStore';

export type SubmitResult = { ok: true } | { ok: false; reason: string };

/**
 * The only restart path after auth_failed (D-05): validate and store the token, then make exactly
 * one connection attempt. Never retries by itself, never echoes the input, writes nothing to a log.
 */
export function submitToken(raw: string): SubmitResult {
  const r = setToken(raw);
  if (!r.ok) return { ok: false, reason: r.reason };
  agentSocket.getAdapter().connect();
  return { ok: true };
}
