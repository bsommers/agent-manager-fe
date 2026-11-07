/** Wire contract version (see docs/superpowers/specs/2026-11-07-fe-be-contract.md). */
export const CONTRACT_VERSION = 1;

/** Hard limits applied by the validators (contract spec section 8). */
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
});
