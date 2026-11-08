import { LIMITS } from './limits.js';
import type { FieldSpec } from './fieldspec.js';

// Field specs shared by validate.ts (the WS tables) and operations.ts (the catalog).
// This module imports neither, so neither import direction creates a cycle.

/** Optional client-chosen request id (idempotency key, ack correlation). */
export const reqIdSpec: FieldSpec = { kind: 'string', min: 1, max: LIMITS.MAX_ID_LENGTH, optional: true };

/** Modes a client may ask for in agent:create. */
export const CLIENT_MODES = ['tmux', 'ssh'] as const;
