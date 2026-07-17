import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/preflight-engine/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
    environment: 'node',
    projects: [
      {
        test: {
          name: 'engine',
          include: ['packages/preflight-engine/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api',
          include: ['apps/api/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
    restoreMocks: true,
    watch: false,
  },
})
