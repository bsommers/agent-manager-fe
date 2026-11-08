import { LIMITS } from './limits.js';
import type { FieldSpec } from './fieldspec.js';

// Field specs shared by validate.ts (the WS tables) and operations.ts (the catalog).
// This module imports neither, so neither import direction creates a cycle.

/** Modes a client may ask for in agent:create. */
export const CLIENT_MODES = ['tmux', 'ssh'] as const;

export const idSpec: FieldSpec = { kind: 'string', min: 1, max: LIMITS.MAX_ID_LENGTH };

/** Optional client-chosen request id (idempotency key, ack correlation). */
export const reqIdSpec: FieldSpec = { kind: 'string', min: 1, max: LIMITS.MAX_ID_LENGTH, optional: true };

/** Optional non-negative sequence number. */
export const seqSpec: FieldSpec = { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER, optional: true };

export const positiveInt: FieldSpec = { kind: 'integer', min: 1, max: Number.MAX_SAFE_INTEGER };

/** Terminal input payload (agent:input, agent:broadcast). */
export const inputData: FieldSpec = {
  kind: 'string',
  min: 0,
  max: LIMITS.MAX_INPUT_BYTES,
  maxBytes: LIMITS.MAX_INPUT_BYTES,
};

export const TAGS_SPEC: FieldSpec = {
  kind: 'stringArray',
  minItems: 0,
  maxItems: 32,
  item: { kind: 'string', min: 1, max: 64, noControl: true },
  optional: true,
};

export const GROUP_SPEC: FieldSpec = { kind: 'string', min: 1, max: 64, noControl: true, optional: true };
