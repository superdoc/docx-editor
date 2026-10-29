import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const reactEntry = fileURLToPath(import.meta.resolve('@superdoc/react'));
const superdocEntry = createRequire(reactEntry).resolve('superdoc');
const engineEntry = createRequire(superdocEntry).resolve('@superdoc/docx-engine');

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@superdoc/docx-engine'],
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(exampleRoot), path.dirname(engineEntry)],
    },
  },
});
