import type { SuperDoc } from 'superdoc';
import type { DocumentMarkCleanResult, DocumentVersion } from 'superdoc/ui';

declare const superdoc: SuperDoc;
declare function store(file: Blob): Promise<void>;

const { ui } = superdoc;

async function save(): Promise<void> {
  const version: DocumentVersion | null = ui.document.getVersion();
  const file = await ui.document.export({ exportType: ['docx'], triggerDownload: false });
  if (!file) return;
  await store(file);
  if (!version) return;
  const result: DocumentMarkCleanResult = ui.document.markClean(version);
  if (!result.ok) {
    const reason: 'document-changed' | 'unavailable' = result.reason;
    void reason;
  }
}

const stop = ui.document.observe(({ dirty }) => void dirty);
ui.document.markClean();

// @ts-expect-error a version comes from getVersion(), not an arbitrary string.
ui.document.markClean('1.0:3');

void save;
void stop;
