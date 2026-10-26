import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { nodeStdlibEntriesPlugin } from './vite-plugin-node-stdlib-entries.mjs';

import { version } from './package.json';
import { getAliases, getV2Resolution } from './vite.config.js';

// Production build of the DEV APP PAGE (index.html -> src/main.js ->
// src/dev/components/SuperdocDev.vue). This is NOT a library build: it exists
// so the app-typing perf lane (tests/performance test:app:typing) can run
// against bundled + minified + production-Vue code and record the dev-mode
// multiplier vs `dev:orbit`.
//
// REQUIRED ENV: SUPERDOC_V2_RUNTIME_MODE=source must be set for the build
// (`pnpm run devapp:build` does this). "Built" here means the bundler
// compiles/minifies the v2 SOURCE tree the same way dev:orbit serves it —
// the point of the exercise is measuring the same code without dev-mode
// overhead (no on-demand transform, no HMR, minified, production Vue), not
// consuming pre-built dist packages. The config fails closed on any other
// mode so the lane can never silently measure a different runtime graph.
//
// Serve the result with `pnpm run devapp:preview` (vite preview, port 9096).

const here = path.dirname(fileURLToPath(import.meta.url));

// The dev page imports @superdoc/font-system transitively through layout
// rendering. vite.config.js only aliases it for `serve`/vitest (an alias
// there breaks the dts build), so this app build adds it explicitly, same as
// vite.config.cdn.js. `/bundled` precedes the bare alias (longest-prefix wins).
const fontSystemAliases = [
  { find: '@superdoc/font-system/bundled', replacement: path.resolve(here, '../../shared/font-system/src/bundled.ts') },
  { find: '@superdoc/font-system', replacement: path.resolve(here, '../../shared/font-system/src/index.ts') },
];

export default defineConfig(({ command }) => {
  // `vite preview` loads this config with command 'serve'. Preview is pure
  // static serving of dist-devapp — it must not require v2 resolution (and
  // must not throw when SUPERDOC_V2_RUNTIME_MODE is unset), so it gets a
  // minimal config that only names the outDir + port.
  if (command !== 'build') {
    return {
      build: { outDir: 'dist-devapp' },
      preview: { port: 9096, strictPort: true },
    };
  }

  const v2Resolution = getV2Resolution(command);
  if (v2Resolution.mode !== 'source') {
    throw new Error(
      '[devapp] the dev-app page build requires SUPERDOC_V2_RUNTIME_MODE=source ' +
        '(use `pnpm run devapp:build`). It must bundle the exact source graph dev:orbit serves; ' +
        `got mode "${v2Resolution.mode}" (${v2Resolution.reason}).`,
    );
  }

  return {
    // Same defines the dev server injects (src/core/SuperDoc.ts reads both).
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __IS_DEBUG__: true,
    },
    plugins: [nodeStdlibEntriesPlugin(), vue(), nodePolyfills()],
    resolve: {
      alias: [...fontSystemAliases, ...getAliases(command, v2Resolution)],
      dedupe: ['yjs'],
      extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
      conditions: v2Resolution.conditions,
      preserveSymlinks: false,
    },
    css: {
      postcss: './postcss.config.mjs',
    },
    // The v2 kernel worker is a module worker whose graph code-splits; the
    // default iife worker format cannot represent that in a build. ES module
    // workers are fine for this lane (Chromium-only measurement target).
    worker: { format: 'es' },
    build: {
      outDir: 'dist-devapp',
      emptyOutDir: true,
      target: 'es2022',
      minify: 'esbuild',
      sourcemap: false,
    },
    preview: { port: 9096, strictPort: true },
  };
});
