import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each suite builds its own isolated database; running files in parallel is safe,
    // but a single SQLite file must not be shared across workers.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/domain/**'],
      reporter: ['text-summary'],
      // NFR-MNT-001: 80% of the business-logic layer by line — a gate, not a
      // measurement, so it cannot quietly erode.
      thresholds: { lines: 80, functions: 80, statements: 80 },
    },
  },
});
