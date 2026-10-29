import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const superdocEntry = fileURLToPath(import.meta.resolve('superdoc'));
const engineEntry = createRequire(superdocEntry).resolve('@superdoc/docx-engine');

export default defineConfig({
  optimizeDeps: {
    exclude: ['@superdoc/docx-engine'],
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(exampleRoot), path.dirname(engineEntry)],
    },
  },
});
