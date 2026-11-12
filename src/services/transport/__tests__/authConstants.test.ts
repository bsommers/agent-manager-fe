import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLOSE_AUTH_FAILED, CLOSE_RATE_LIMITED, ACK_TIMEOUT_MS } from '../Transport';

// Drift guard: the FE auth constants must equal what the contract spec states (sections 2.5 and 2.6).
const SPEC = readFileSync(
  resolve(process.cwd(), 'docs/superpowers/specs/2026-11-07-fe-be-contract.md'),
  'utf8',
);

function section(title: string): string {
  const start = SPEC.indexOf(title);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = SPEC.indexOf('\n### ', start + title.length);
  const hr = SPEC.indexOf('\n---', start + title.length);
  const ends = [next, hr].filter((n) => n > 0);
  return SPEC.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('auth constants match contract spec 2.5 and 2.6', () => {
  const closeCodes = section('### 2.6 WebSocket close codes');
  const handshake = section('### 2.5 Handshake');

  it('CLOSE_AUTH_FAILED is the code in the 2.6 unauthenticated row', () => {
    const row = closeCodes.split('\n').find((l) => /^\|\s*\d+\s*\|\s*Unauthenticated/.test(l));
    expect(row).toBeDefined();
    expect(Number(/^\|\s*(\d+)/.exec(row as string)?.[1])).toBe(CLOSE_AUTH_FAILED);
    expect(CLOSE_AUTH_FAILED).toBe(4401);
  });

  it('CLOSE_RATE_LIMITED is the code in the 2.6 rate limited row', () => {
    const row = closeCodes.split('\n').find((l) => /^\|\s*\d+\s*\|\s*Rate limited/.test(l));
    expect(row).toBeDefined();
    expect(Number(/^\|\s*(\d+)/.exec(row as string)?.[1])).toBe(CLOSE_RATE_LIMITED);
    expect(CLOSE_RATE_LIMITED).toBe(4429);
  });

  it('ACK_TIMEOUT_MS is 3000 and the spec still states a 3 s acknowledgement wait', () => {
    expect(ACK_TIMEOUT_MS).toBe(3000);
    expect(handshake).toMatch(/no `hello_ack` within 3 s/);
  });

  it('the spec still carries the exact auth_failed message', () => {
    expect(handshake).toContain('gateway did not acknowledge authentication');
  });
});
