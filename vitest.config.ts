import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          globals: true,
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          environment: 'node',
          globals: true,
          include: ['test/api/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          include: ['test/web/**/*.test.{ts,tsx}'],
          setupFiles: ['test/web/setup.ts'],
        },
      },
    ],
  },
});
