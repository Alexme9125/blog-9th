import { resolve } from 'node:path';
import process from 'node:process';

import { defineConfig } from 'vitest/config';

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(resolve(process.cwd(), '.env.local'));
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
      'server-only': resolve(process.cwd(), 'tests/server-only.ts'),
    },
    conditions: ['react-server', 'node', 'import', 'default'],
  },
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**'],
  },
});
