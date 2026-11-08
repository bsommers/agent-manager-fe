/** Wire contract version (see docs/superpowers/specs/2026-11-07-fe-be-contract.md). */
export const CONTRACT_VERSION = 1;

/** Hard limits and transport defaults (contract spec section 8). Frozen at every level. */
export const LIMITS = Object.freeze({
  MAX_FRAME_BYTES: 1048576,
  MAX_INPUT_BYTES: 65536,
  MAX_BROADCAST_TARGETS: 64,
  MAX_ID_LENGTH: 128,
  MAX_NAME_LENGTH: 128,
  MAX_TARGET_HOST_LENGTH: 255,
  MAX_INITIAL_CMD_LENGTH: 4096,
  MAX_AGENTS: 1000,
  MAX_MODE_LENGTH: 64,
  MAX_SEARCH_QUERY_LENGTH: 256,
  RECONNECT: Object.freeze({ baseMs: 500, factor: 2, capMs: 15000 }),
  HEARTBEAT: Object.freeze({ intervalMs: 15000, timeoutMs: 10000 }),
});
