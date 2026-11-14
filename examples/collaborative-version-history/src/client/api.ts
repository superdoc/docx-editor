export interface VersionRecord {
  id: string;
  number: number;
  label: string;
  trigger: string;
  createdBy: string;
  createdAt: string;
  sha256: string;
  byteLength: number;
  restoredFrom?: string;
}

export interface VersionList {
  versions: VersionRecord[];
  head: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const DOCUMENT_ID = new URLSearchParams(window.location.search).get('doc') ?? 'contract-42';

const base = `/api/documents/${encodeURIComponent(DOCUMENT_ID)}`;

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${base}${path}`, init);
  if (response.ok) return response;
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  throw new ApiError(response.status, typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`, body);
}

const postJson = (path: string, body: unknown) =>
  request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  source: async () => (await request('/source')).blob(),
  list: async () => (await (await request('/versions')).json()) as VersionList,
  save: async (label: string, createdBy: string) =>
    (await (await postJson('/versions', { label, createdBy })).json()) as VersionRecord,
  content: async (versionId: string) => (await request(`/versions/${versionId}/content`)).blob(),
  compare: async (from: string, to: string) => {
    const response = await request(`/compare?from=${from}&to=${to}`);
    return { docx: await response.blob(), reviewItems: Number(response.headers.get('x-review-items') ?? '0') };
  },
  restore: async (versionId: string, baseVersionId: string | null, requestedBy: string) =>
    (await (await postJson('/restore', { versionId, baseVersionId, requestedBy })).json()) as {
      before: VersionRecord;
      restored: VersionRecord;
    },
};
