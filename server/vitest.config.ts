import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-manager/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
