import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Empty counts as unset: an exported developer token must never switch the suite into auth mode (08-02).
    env: { AGENT_MANAGER_TOKEN: '', AGENT_MANAGER_TRUST_PROXY: '' },
  },
  resolve: {
    alias: {
      '@agent-manager/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
