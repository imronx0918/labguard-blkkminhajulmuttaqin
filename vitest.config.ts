import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30000, fileParallelism: false,
    env: { AUTH_MODE: 'demo', DATA_STORE: 'memory', MEMORY_STORE_FILE: '', SCHEDULER_ENABLED: 'false', NODE_ENV: 'test', SERVER_SECRET: 'test-secret-0123456789abcdef0123456789' },
  },
});
