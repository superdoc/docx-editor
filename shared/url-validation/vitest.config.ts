import { defineConfig } from 'vite-plus';
import baseConfig from '../../vitest.baseConfig';

export default defineConfig({
  ...baseConfig,
  test: {
    name: '@url-validation',
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts'],
  },
});
