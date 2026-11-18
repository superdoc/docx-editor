import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    outDir: process.env.SUPERDOC_PUBLIC_NPM_OUT_DIR
      ? resolve(process.env.SUPERDOC_PUBLIC_NPM_OUT_DIR)
      : resolve(root, 'dist'),
    target: 'node20',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(root, 'src/public/collaboration-validation.ts'),
      formats: ['es'],
      fileName: () => 'collaboration-validation.es.js',
    },
    rollupOptions: {
      external: ['@superdoc/docx-engine/document-runtime'],
    },
  },
});
