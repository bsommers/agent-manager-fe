export interface BackoffConfig {
  baseMs: number;
  factor: number;
  capMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 500, factor: 2, capMs: 15000 };

/** Full-jitter exponential backoff: floor(random * min(cap, base * factor^attempt)). */
export function computeDelay(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(config.capMs, config.baseMs * Math.pow(config.factor, attempt));
  return Math.floor(random() * ceiling);
}
