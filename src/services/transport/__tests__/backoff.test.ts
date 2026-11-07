import { describe, it, expect } from 'vitest';
import { computeDelay, DEFAULT_BACKOFF } from '../backoff';

describe('computeDelay', () => {
  it('has the contract default config', () => {
    expect(DEFAULT_BACKOFF).toEqual({ baseMs: 500, factor: 2, capMs: 15000 });
  });

  it('ceilings for attempts 0..6 with random=1 are 500..15000 capped', () => {
    const got = [0, 1, 2, 3, 4, 5, 6].map((a) => computeDelay(a, DEFAULT_BACKOFF, () => 1));
    expect(got).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000]);
  });

  it('is 0 for every attempt when random=0', () => {
    for (let a = 0; a < 10; a++) expect(computeDelay(a, DEFAULT_BACKOFF, () => 0)).toBe(0);
  });

  it('floors the jittered value', () => {
    expect(computeDelay(0, DEFAULT_BACKOFF, () => 0.5)).toBe(250);
    expect(computeDelay(0, DEFAULT_BACKOFF, () => 0.9999)).toBe(499);
  });

  it('uses Math.random by default and stays within bounds', () => {
    for (let i = 0; i < 50; i++) {
      const d = computeDelay(3);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });
});
