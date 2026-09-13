import path from 'path';
import { existsSync } from 'node:fs';
import copy from 'rollup-plugin-copy'
import dts from 'vite-plugin-dts'
import sirv from 'sirv';
import { defineConfig } from 'vite-plus'
import { configDefaults } from 'vite-plus'
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { visualizer } from 'rollup-plugin-visualizer';
import vue from '@vitejs/plugin-vue'
import layeredCssPlugin from './vite-plugin-layered-css.mjs';
import { preserveV2WorkerAssetPlugin } from './vite-plugin-v2-worker-asset.mjs';

import { version } from './package.json';
import sourceResolve from '../../vite.sourceResolve';
import {
  headlessImportGuardPlugin,
  resolveEnginePackageRoot,
  resolveSuperDocV2RuntimeMode,
} from './vite.v2-runtime-mode.mjs';
import { resolveDisableTrackedChangeLoading } from './vite.tracked-change-loading.mjs';

// SD-2864: derive the dts include list from the canonical type-surface
// config so vite, ensure-types, audit, and the tsconfig parity check
// share one source of truth for relocations.
const cjsRequire = createRequire(import.meta.url);
const typeSurface = cjsRequire('./scripts/type-surface.config.cjs');

// WORKAROUND: rolldown doesn't support trailing-slash imports (e.g. 'punycode/')
// which Node.js treats as "resolve the package entry point". node-stdlib-browser's
// url polyfill uses `import from 'punycode/'` and rolldown tries to open the
// directory as a file. We resolve the actual entry point here and redirect via a
// small plugin in optimizeDeps.rollupOptions below.
// Track: https://github.com/nicolo-ribaudo/tc39-proposal-import-deferral/issues/3
// TODO: Remove once rolldown supports trailing-slash imports or node-stdlib-browser drops them.
const require = createRequire(import.meta.url);
const stdlibRequire = createRequire(require.resolve('node-stdlib-browser/package.json'));
const punycodeEntry = stdlibRequire.resolve('punycode/punycode.js');
const nodePolyfillShimAliases = ['buffer', 'global', 'process'].map((name) => ({
  find: `vite-plugin-node-polyfills/shims/${name}`,
  replacement: fileURLToPath(import.meta.resolve(`vite-plugin-node-polyfills/shims/${name}`)),
}));

const visualizerConfig = {
  filename: './dist/bundle-analysis.html',
  template: 'treemap',
  gzipSize: true,
  brotliSize: true,
  open: true
}

function resolveV2DistRelativeImportsPlugin(v2DistRoot) {
  const isRelativeImport = (specifier) => specifier.startsWith('./') || specifier.startsWith('../');
  const normalizeId = (id) => {
    let clean = id.split('?')[0];
    if (clean.startsWith('\0')) clean = clean.slice(1);
    if (clean.startsWith('file://')) clean = fileURLToPath(clean);
    return path.isAbsolute(clean) ? clean : path.resolve(__dirname, clean);
  };

  return {
    name: 'superdoc-resolve-v2-dist-relative-imports',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !isRelativeImport(source)) return null;
      const importerPath = normalizeId(importer);
      if (!importerPath.startsWith(`${v2DistRoot}${path.sep}`)) return null;

      const resolved = path.resolve(path.dirname(importerPath), source);
      if (existsSync(resolved)) return { id: resolved };
      if (existsSync(`${resolved}.js`)) return { id: `${resolved}.js` };
      return null;
    },
  };
}

// Internal @superdoc/ paths that map to ./src/ (not workspace packages).
// Rolldown doesn't support regex capture groups ($1) in alias replacements,
// so we list these explicitly instead of using /^@superdoc\/(.*)$/.
// Update this list when adding new src/ subdirectories imported via @superdoc/.
const superdocSrcAliases = ['components', 'composables', 'core', 'helpers', 'stores', 'dev', 'icons.js', 'index.js'];

// V2 branch: the customer `superdoc` package consumes the internal v2 runtime
// through the stable `@superdoc/docx-engine` contract. `superdoc/v2` is a SEPARATE pnpm
// workspace, so its private implementation packages cannot be node-resolved
// here in source mode. The dual-mode resolver decides how `@superdoc/docx-engine*`
// resolves:
//   - package mode (default for build/pack/release/public clone): node
//     resolution of the installed dist-only `@superdoc/docx-engine`, or a built
//     `superdoc/v2/dist` local substitute. NEVER aliases into v2 source.
//   - source mode (Orbit dev only, opt-in): aliases into `superdoc/v2/**/src`
//     for full v2 + public HMR.
// The engine is the supported runtime dependency. Its implementation packages
// never survive as public dependencies, exports, or unresolved imports.
//
const V2_ROOT = resolveEnginePackageRoot(import.meta.url);
const LAYOUT_ENGINE_ROOT = path.resolve(__dirname, '../layout-engine');

let loggedV2Mode = false;
export const getV2Resolution = (command) => {
  const resolution = resolveSuperDocV2RuntimeMode({
    command,
    env: process.env,
    packageRoot: __dirname,
    v2Root: V2_ROOT,
    layoutEngineRoot: LAYOUT_ENGINE_ROOT,
  });
  if (!loggedV2Mode) {
    // One concise line so build logs record the selected mode and why.
    console.log(`[superdoc] v2 runtime mode: ${resolution.mode} - ${resolution.reason}`);
    loggedV2Mode = true;
  }
  return resolution;
};

export const getAliases = (command, v2Resolution = getV2Resolution(command)) => {
  const aliases = [
    ...v2Resolution.aliases,
    ...nodePolyfillShimAliases,

    // Workspace packages (source paths for dev)
    { find: '@stores', replacement: fileURLToPath(new URL('./src/stores', import.meta.url)) },

    // Map @superdoc/<name> to ./src/<name> for internal paths
    ...superdocSrcAliases.map(name => ({
      find: `@superdoc/${name}`,
      replacement: path.resolve(__dirname, `./src/${name}`),
    })),
    ...sourceResolve.alias,
  ];

  return aliases;
};


// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const v2Resolution = getV2Resolution(command);
  const npmOutDir = process.env.SUPERDOC_PUBLIC_NPM_OUT_DIR
    ? path.resolve(process.env.SUPERDOC_PUBLIC_NPM_OUT_DIR)
    : path.resolve(__dirname, 'dist');
  const engineDistRoot = v2Resolution.engineInput?.surfaceRoots?.dist ?? path.resolve(V2_ROOT, 'dist');
  const disableTrackedChangeLoading = resolveDisableTrackedChangeLoading({
    command,
    runtimeMode: v2Resolution.mode,
    env: process.env,
  });
  if (disableTrackedChangeLoading) {
    console.warn('[superdoc] tracked-change loading: disabled for this dev server');
  }
  const skipDts = process.env.SUPERDOC_SKIP_DTS === '1';
  const stringDecoderEntry = stdlibRequire.resolve('string_decoder/lib/string_decoder.js');
  const plugins = [
    headlessImportGuardPlugin(v2Resolution.mode),
    resolveV2DistRelativeImportsPlugin(engineDistRoot),
    // Rolldown treats trailing-slash imports (`punycode/`, `string_decoder/`) as
    // directory paths and fails to load them. node-stdlib-browser and
    // readable-stream use that form. The optimizeDeps fix below only covers dep
    // pre-bundling (dev); the production build needs the same redirect so the
    // bundled v2 runtime graph (which pulls these polyfills transitively) builds.
    {
      name: 'fix-node-stdlib-trailing-slash',
      enforce: 'pre',
      resolveId(source) {
        if (source === 'punycode/' || source === 'punycode') return { id: punycodeEntry };
        if (source === 'string_decoder/' || source === 'string_decoder') return { id: stringDecoderEntry };
      },
    },
    vue(),
    layeredCssPlugin(),
    preserveV2WorkerAssetPlugin(),
    !skipDts && dts({
      // Foundational sources (superdoc, document-api) are
      // always included; relocation patterns come from the canonical
      // type-surface config (SD-2864). Each `relocations` entry pairs the
      // ensure-types rewriter rule with the vite include patterns so the
      // two cannot drift.
      include: [
        'src/**/*',
        '../document-api/src/**/*',
        ...typeSurface.relocations.flatMap((r) => r.viteIncludes),
      ],
      exclude: [
        'src/dev/**',
        'src/components/SuperToolbar/**',
      ],
      outDir: npmOutDir,
      // vite-plugin-dts still gathers diagnostics for this mixed JS/Vue source
      // tree, but we do not use this build as the authoritative type-check gate.
      // Keep declaration generation enabled and silence the plugin's diagnostic
      // logger so build:es stays clean while postbuild validates emitted entries.
      logLevel: 'silent',
    }),
    copy({
      targets: [
        {
          src: 'node_modules/pdfjs-dist/web/images/*',
          dest: path.join(npmOutDir, 'images'),
        },
      ],
      hook: 'writeBundle'
    }),
    // visualizer(visualizerConfig)
    {
      // Serve dist/ as static files so the docs dev server can load the local UMD build - Development only.
      name: 'serve-dist-for-docs',
      configureServer(server) {
        server.middlewares.use(
          '/dist',
          sirv(path.resolve(__dirname, 'dist'), {
            dev: true,
            setHeaders(res) {
              res.setHeader('Access-Control-Allow-Origin', '*');
            },
          }),
        );
      },
    },
  ].filter(Boolean);
  if (mode !== 'test') plugins.push(nodePolyfills());
  const isDev = command === 'serve';
  // Package mode may read only the verified prepared engine dist. The private
  // headless dist is intentionally NOT allowed: production public source is
  // forbidden from importing it and the published engine has no headless
  // surface (see headlessImportGuardPlugin).
  const v2FsAllow = v2Resolution.mode === 'source'
    ? [V2_ROOT]
    : [engineDistRoot];

  // Use emoji marker instead of ANSI colors to avoid reporter layout issues
  const projectLabel = '🦋 @superdoc';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __IS_DEBUG__: true,
      __SUPERDOC_DISABLE_TRACKED_CHANGE_LOADING__: JSON.stringify(disableTrackedChangeLoading),
    },
    plugins,
    test: {
      name: projectLabel,
      globals: true,
      // Use happy-dom for faster tests (set VITEST_DOM=jsdom to use jsdom)
      environment: process.env.VITEST_DOM || 'happy-dom',
      // Vitest 4 keeps spy call history across tests, so a `vi.spyOn` in a
      // `beforeEach` accumulates over the whole file. Restore per test to keep
      // the isolation these suites were written against.
      restoreMocks: true,
      retry: 2,
      testTimeout: 20000,
      hookTimeout: 10000,
      exclude: [
        ...configDefaults.exclude,
        '**/*.spec.js',
        'tests/cdn-smoke/**',
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'lcov'],
        include: ['src/**'],
        exclude: [
          'src/dev/**',
          'src/index.js',
          'src/main.js',
          // Pure JSDoc typedef files (body is `export {}`, no runtime code)
          'src/core/types/**',
          '**/types.js',
        ],
      },
    },
    build: {
      outDir: npmOutDir,
      target: 'es2022',
      cssCodeSplit: false,
      lib: {
        entry: "src/index.js",
        name: "SuperDoc",
        cssFileName: 'style',
      },
      minify: false,
      sourcemap: false,
      rollupOptions: {
        input: {
          'superdoc': 'src/index.js',
          // v2-native public UI controller + framework bindings. Emitted as
          // their own bundles so `superdoc/ui`, `superdoc/ui/react`, and
          // `superdoc/ui/vue` resolve without dragging in the app-shell/main
          // bundle. `react` and `vue` are external.
          'public/ui': 'src/public/ui.ts',
          'public/ui-react': 'src/public/ui-react.ts',
          'public/ui-vue': 'src/public/ui-vue.ts',
          'public/collaboration-worker': 'src/public/collaboration-worker.ts',
        },
        external: [
          ...(v2Resolution.mode === 'package' ? [/^@superdoc\/docx-engine(?:\/.*)?$/] : []),
          'yjs',
          '@hocuspocus/provider',
          'pdfjs-dist',
          'pdfjs-dist/build/pdf.mjs',
          'pdfjs-dist/legacy/build/pdf.mjs',
          'pdfjs-dist/web/pdf_viewer.mjs',
          'react',
          'react/jsx-runtime',
          'vue',
          // V2 collaboration/runtime peers the host app provides (kept as one
          // shared copy across the page, matching the v2 external-peer policy).
          'y-protocols',
          'y-protocols/awareness',
          'y-protocols/awareness.js',
          'lib0',
          'y-websocket',
          '@liveblocks/client',
          '@liveblocks/yjs',
        ],
        output: [
          {
            format: 'es',
            entryFileNames: '[name].es.js',
            chunkFileNames: 'chunks/[name]-[hash].es.js',
            manualChunks(id) {
              if (id.includes('/node_modules/vue/')) return 'vue';
              if (id.includes('/node_modules/jszip/')) return 'jszip';
              if (id.includes('/node_modules/eventemitter3/')) return 'eventemitter3';
              if (id.includes('/node_modules/uuid/')) return 'uuid';
              if (id.includes('/node_modules/xml-js/')) return 'xml-js';
              if (id.includes('blank.docx')) return 'blank-docx';
            }
          },
          {
            format: 'cjs',
            entryFileNames: '[name].cjs',
            chunkFileNames: 'chunks/[name]-[hash].cjs',
            manualChunks(id) {
              if (id.includes('/node_modules/vue/')) return 'vue';
              if (id.includes('/node_modules/jszip/')) return 'jszip';
              if (id.includes('/node_modules/eventemitter3/')) return 'eventemitter3';
              if (id.includes('/node_modules/uuid/')) return 'uuid';
              if (id.includes('/node_modules/xml-js/')) return 'xml-js';
              if (id.includes('blank.docx')) return 'blank-docx';
            }
          }
        ],
      }
    },
    optimizeDeps: {
      include: ['yjs', '@hocuspocus/provider'],
      // Rolldown treats trailing-slash imports as directory paths.
      // node-stdlib-browser's url polyfill imports 'punycode/' — resolve it to the
      // actual file since punycode is also a Node.js builtin and pnpm isolates it.
      rollupOptions: {
        plugins: [
          {
            name: 'fix-punycode-trailing-slash',
            resolveId(source) {
              if (source === 'punycode/' || source === 'punycode') {
                return { id: punycodeEntry };
              }
            },
          },
        ],
      },
    },
    resolve: {
      // Under Vitest and the dev server (command 'serve'), alias @superdoc/font-system to its
      // source: cdn-entry.test.js needs it for the import cdn-entry.js makes, and the dev
      // playground imports it transitively through layout rendering. font-system
      // lives under shared/, so it is NOT covered by vite.sourceResolve's packages/** aliases.
      // The production CDN build aliases it in vite.config.cdn.js; the ES build never imports
      // cdn-entry. Kept OUT of getAliases so the vite-plugin-dts build (command 'build') is
      // unaffected - an alias there makes it emit unresolvable source paths. /bundled precedes the bare one.
      alias: [
        ...(process.env.VITEST || isDev
          ? [
              { find: '@superdoc/font-system/bundled', replacement: path.resolve(__dirname, '../../shared/font-system/src/bundled.ts') },
              { find: '@superdoc/font-system', replacement: path.resolve(__dirname, '../../shared/font-system/src/index.ts') },
            ]
          : []),
        ...getAliases(command, v2Resolution),
      ],
      dedupe: ['yjs'],
      extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
      conditions: v2Resolution.conditions,
      preserveSymlinks: false,
    },
    css: {
      postcss: './postcss.config.mjs',
    },
    server: {
      port: 9094,
      host: '0.0.0.0',
      fs: {
        allow: [
          path.resolve(__dirname, '../layout-engine'),
          ...v2FsAllow,
          '../',
          '../../',
        ],
      },
    },
  }
});
