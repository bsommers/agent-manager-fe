import { describe, it, expect } from 'vitest';
import { LIMITS } from '@agent-manager/protocol';
import { DEFAULT_BACKOFF } from '../backoff';
import { DEFAULT_HEARTBEAT } from '../Transport';

// Drift guard: the FE transport defaults must equal the shared contract constants.
describe('transport defaults match the contract constants', () => {
  it('DEFAULT_BACKOFF equals LIMITS.RECONNECT', () => {
    expect(DEFAULT_BACKOFF).toEqual(LIMITS.RECONNECT);
  });

  it('DEFAULT_HEARTBEAT equals LIMITS.HEARTBEAT', () => {
    expect(DEFAULT_HEARTBEAT).toEqual(LIMITS.HEARTBEAT);
  });
});
