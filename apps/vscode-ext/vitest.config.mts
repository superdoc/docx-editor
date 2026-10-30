import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    alias: [
      {
        find: /^superdoc\/style\.css$/,
        replacement: fileURLToPath(new URL('./__tests__/stubs/superdoc-style.ts', import.meta.url)),
      },
      { find: /^superdoc$/, replacement: fileURLToPath(new URL('./__tests__/stubs/superdoc.ts', import.meta.url)) },
    ],
  },
});
