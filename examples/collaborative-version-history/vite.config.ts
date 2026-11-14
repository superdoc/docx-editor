import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const superdocEntry = fileURLToPath(import.meta.resolve('superdoc'));
const engineEntry = createRequire(superdocEntry).resolve('@superdoc/docx-engine');
const serverPort = 1250 + Number(process.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
const proxy = { '/api': `http://127.0.0.1:${serverPort}` };

export default defineConfig({
  resolve: {
    dedupe: ['yjs'],
    alias: [{ find: /^vue$/, replacement: createRequire(superdocEntry).resolve('vue/dist/vue.runtime.esm-bundler.js') }],
  },
  optimizeDeps: {
    exclude: ['@superdoc/docx-engine'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: path.join(exampleRoot, 'index.html'),
        compare: path.join(exampleRoot, 'compare.html'),
      },
    },
  },
  server: {
    proxy,
    fs: {
      allow: [searchForWorkspaceRoot(exampleRoot), path.dirname(engineEntry)],
    },
  },
  preview: { proxy },
});
