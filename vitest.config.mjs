import { defineConfig } from 'vite-plus';

const testPool = process.env.VITEST_POOL ?? 'threads';
const minWorkers = process.env.VITEST_MIN_WORKERS ?? '50%';
const maxWorkers = process.env.VITEST_MAX_WORKERS ?? '75%';

export default defineConfig({
  test: {
    pool: testPool,
    minWorkers,
    maxWorkers,
    // Use package directories; Vitest will pick up each package's vite.config.js.
    // Packages migrated to bun test: document-api, layout-engine/{layout-engine,style-engine,geometry-utils},
    // word-layout, shared/{common,font-utils,url-validation}.
    projects: [
      './packages/superdoc',
      './shared/font-system',
      './packages/fonts',
      './packages/layout-engine/contracts',
      './packages/layout-engine/layout-bridge',
      './packages/layout-engine/layout-resolved',
      './packages/layout-engine/measuring/dom',
      './packages/layout-engine/painters/dom',
      './packages/layout-engine/tests',
      './apps/vscode-ext',
    ],
    coverage: {
      exclude: [
        '**/index.js',
        '**/postcss.config.cjs',
        '**/postcss.config.mjs',
        '**/main.js',
        '**/main.ts',
        '**/types.js',
        '**/migration_after_0_4_14.js',
      ],
    },
  },
});
