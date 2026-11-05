import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { version } from './package.json';
import { resolveExactEngineVersion } from './cdn-engine-version.js';
import { getAliases, getV2Resolution } from './vite.config.js';
import { headlessImportGuardPlugin } from './vite.v2-runtime-mode.mjs';
import layeredCssPlugin from './vite-plugin-layered-css.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_PACKAGE_NAME = '@superdoc/docx-engine';

function readExactEngineVersion() {
  const manifest = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
  const engineSpec = manifest.dependencies?.[ENGINE_PACKAGE_NAME];
  return resolveExactEngineVersion(engineSpec, engineSpec?.startsWith('workspace:') === true);
}
// CDN-only alias: this IIFE build inlines superdoc's own modules, and cdn-entry.ts
// imports the font-asset base setter from @superdoc/font-system (superdoc only depends on
// it transitively). Kept OUT of the shared getAliases so the dts build's resolver is
// unaffected (an alias there would make vite-plugin-dts emit unresolvable source paths).
// The /bundled subpath alias precedes the bare one (longest-prefix wins).
const fontSystemAliases = [
  {
    find: /^@superdoc\/font-system\/bundled$/,
    replacement: path.resolve(here, '../../shared/font-system/src/bundled.ts'),
  },
  { find: /^@superdoc\/font-system$/, replacement: path.resolve(here, '../../shared/font-system/src/index.ts') },
];

// Standalone browser bundle for CDN / <script> tag consumption.
// Exposes `window.SuperDoc`. Inlines runtime deps in the IIFE and emits the
// v2 browser worker as a sibling dist asset. Only pdfjs-dist stays external
// because of its size; PDF viewing requires the ESM + import-map path.
export default defineConfig(({ command }) => {
  const v2Resolution = getV2Resolution(command);
  const plugins = [headlessImportGuardPlugin(v2Resolution.mode), vue(), layeredCssPlugin()].filter(Boolean);
  const engineVersion = readExactEngineVersion();
  const engineCdnBaseUrl = process.env.SUPERDOC_ENGINE_CDN_BASE_URL?.trim() || '';
  const cdnOutDir = process.env.SUPERDOC_PUBLIC_CDN_OUT_DIR
    ? path.resolve(process.env.SUPERDOC_PUBLIC_CDN_OUT_DIR)
    : path.resolve(here, 'dist-cdn');

  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __DOCX_ENGINE_VERSION__: JSON.stringify(engineVersion),
      __DOCX_ENGINE_CDN_BASE_URL__: JSON.stringify(engineCdnBaseUrl),
      __SUPERDOC_BUILD__: JSON.stringify('cdn-iife'),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    plugins,
    resolve: {
      alias: [
        {
          find: /^\.\/collaboration-comment-map\.js$/,
          replacement: path.resolve(here, 'src/core/collaboration/cdn-collaboration-comment-map.ts'),
        },
        ...fontSystemAliases,
        ...getAliases(command, v2Resolution),
      ],
      extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
      conditions: v2Resolution.conditions,
    },
    build: {
      ...(process.argv.includes('--watch') && { watch: { buildDelay: 300 } }),
      outDir: cdnOutDir,
      emptyOutDir: true,
      target: 'es2022',
      cssCodeSplit: false,
      lib: {
        entry: 'src/cdn-entry.ts',
        formats: ['iife'],
        name: 'SuperDoc',
        cssFileName: 'superdoc.min',
        fileName: () => 'superdoc.min.js',
      },
      minify: process.env.SUPERDOC_EVAL_FAST_BUILD === '1' ? false : 'esbuild',
      cssMinify: process.env.SUPERDOC_EVAL_FAST_BUILD !== '1',
      reportCompressedSize: process.env.SUPERDOC_EVAL_FAST_BUILD !== '1',
      // Published CDN artifact must never carry a source map (it would expose
      // the bundled private v2 runtime source). The publish-artifact auditor is
      // the enforcing backstop.
      sourcemap: false,
      rollupOptions: {
        external: [
          /^@superdoc\/docx-engine(?:\/.*)?$/,
          'pdfjs-dist',
          'pdfjs-dist/build/pdf.mjs',
          'pdfjs-dist/legacy/build/pdf.mjs',
          'pdfjs-dist/web/pdf_viewer.mjs',
        ],
        output: {
          globals: {
            '@superdoc/docx-engine': 'SuperDocDocxEngine',
            'pdfjs-dist': 'pdfjsLib',
            'pdfjs-dist/build/pdf.mjs': 'pdfjsLib',
            'pdfjs-dist/legacy/build/pdf.mjs': 'pdfjsLib',
            'pdfjs-dist/web/pdf_viewer.mjs': 'pdfjsViewer',
          },
        },
      },
    },
  };
});
