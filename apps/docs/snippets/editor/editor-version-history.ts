import { DOCX, type SuperDoc } from 'superdoc';

const documentEndpoint = '/api/documents/sample';
const versionsEndpoint = `${documentEndpoint}/versions`;

export type DocumentVersion = {
  id: string;
  createdAt: string;
  createdBy: string;
  restoredFromVersionId?: string;
};

export async function listVersions(): Promise<DocumentVersion[]> {
  const response = await fetch(versionsEndpoint);
  if (!response.ok) throw new Error(`Could not list versions: ${response.status}`);

  return response.json() as Promise<DocumentVersion[]>;
}

async function exportDocx(superdoc: SuperDoc): Promise<Blob> {
  const docx = await superdoc.export({
    exportType: ['docx'],
    triggerDownload: false,
  });
  if (!(docx instanceof Blob)) throw new Error('Expected one DOCX file.');

  return docx;
}

export async function saveVersion(
  superdoc: SuperDoc,
  baseVersionId: string,
  restoredFromVersionId?: string,
): Promise<DocumentVersion> {
  const docx = await exportDocx(superdoc);

  const response = await fetch(versionsEndpoint, {
    method: 'POST',
    headers: {
      'content-type': DOCX,
      'x-base-version-id': baseVersionId,
      ...(restoredFromVersionId ? { 'x-restored-from-version-id': restoredFromVersionId } : {}),
    },
    body: docx,
  });
  if (response.status === 409) throw new Error('A newer version exists. Reload before saving.');
  if (!response.ok) throw new Error(`Could not save the version: ${response.status}`);

  return response.json() as Promise<DocumentVersion>;
}

async function openDocument(superdoc: SuperDoc, docx: Blob): Promise<void> {
  const result = await superdoc.replaceFile(docx);
  const state = result && typeof result === 'object' ? ((result as { state?: unknown }).state ?? null) : null;
  if (state !== null && state !== 'review-ready' && state !== 'editing-ready') {
    throw new Error('SuperDoc could not open the DOCX file.');
  }
}

export async function restoreVersion(
  superdoc: SuperDoc,
  versionId: string,
  baseVersionId: string,
): Promise<DocumentVersion> {
  const activeDocx = await exportDocx(superdoc);
  const response = await fetch(`${versionsEndpoint}/${encodeURIComponent(versionId)}`);
  if (!response.ok) throw new Error(`Could not restore the version: ${response.status}`);

  const docx = new Blob([await response.arrayBuffer()], { type: DOCX });

  try {
    await openDocument(superdoc, docx);
    return await saveVersion(superdoc, baseVersionId, versionId);
  } catch (error) {
    const rollbackDocx = await fetch(documentEndpoint)
      .then(async (current) => (current.ok ? new Blob([await current.arrayBuffer()], { type: DOCX }) : activeDocx))
      .catch(() => activeDocx);
    await openDocument(superdoc, rollbackDocx);
    throw error;
  }
}
