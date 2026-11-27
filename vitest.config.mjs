import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

const testPool = process.env.VITEST_POOL ?? 'threads';
const minWorkers = process.env.VITEST_MIN_WORKERS ?? '50%';
const maxWorkers = process.env.VITEST_MAX_WORKERS ?? '75%';

// Packages migrated to bun test: document-api, layout-engine/{layout-engine,style-engine,geometry-utils},
// word-layout, shared/{common,font-utils,url-validation}.
export const publicTestProjectDirectories = [
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
];

export function publicSuperdocTestProject() {
  return {
    extends: fileURLToPath(new URL('./packages/superdoc/vite.config.js', import.meta.url)),
    root: fileURLToPath(new URL('./packages/superdoc', import.meta.url)),
    resolve: {
      alias: [{
        find: /^vite-plus\/test$/,
        replacement: fileURLToPath(import.meta.resolve('vite-plus/test')),
      }],
    },
  };
}

export default defineConfig({
  test: {
    pool: testPool,
    minWorkers,
    maxWorkers,
    projects: publicTestProjectDirectories.map((project) =>
      project === './packages/superdoc' ? publicSuperdocTestProject() : project,
    ),
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
