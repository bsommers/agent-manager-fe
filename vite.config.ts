import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@agent-manager/protocol': path.resolve(__dirname, './packages/protocol/src/index.ts'),
    },
  },
  server: {
    port: 3000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    // Agent worktrees live under .claude/worktrees; never collect their copies of the suite.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
