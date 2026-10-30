import path from 'node:path';
import { createAtomicWriter } from './atomic-write.ts';
import type { DocxStore } from './types.ts';

export function createFileDocxStore(directory: string): DocxStore {
  const writeFileAtomically = createAtomicWriter(directory);

  return {
    put: (documentId, docx) =>
      writeFileAtomically(path.join(directory, `${encodeURIComponent(documentId)}.docx`), docx),
  };
}
