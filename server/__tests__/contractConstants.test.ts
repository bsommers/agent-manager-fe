import { describe, it, expect } from 'vitest';
import { LIMITS } from '@agent-manager/protocol';
import { CONFIG } from '../src/config.js';

// Drift guard: the gateway frame cap must equal the shared contract constant.
describe('gateway config matches the contract constants', () => {
  it('CONFIG.MAX_PAYLOAD_BYTES equals LIMITS.MAX_FRAME_BYTES', () => {
    expect(CONFIG.MAX_PAYLOAD_BYTES).toBe(LIMITS.MAX_FRAME_BYTES);
  });
});
