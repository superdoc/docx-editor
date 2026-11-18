import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CheckpointScheduler } from './checkpoints.ts';
import { headOf } from './version-store.ts';
import {
  ComparisonBlockedError,
  RestoreConflictError,
  VersionNotFoundError,
  type VersionService,
} from './versions.ts';

export interface RouteDependencies {
  versions: VersionService;
  scheduler: CheckpointScheduler | null;
  sourceDocx(): Promise<Uint8Array>;
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOCUMENT_ID = /^[A-Za-z0-9._-]{1,100}$/;
const VERSION_ID = /^v[1-9][0-9]{0,8}$/;
const MAX_BODY_BYTES = 16_384;

class BadRequestError extends Error {}

export async function handleVersionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: RouteDependencies,
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return false;

  try {
    await route(request.method ?? 'GET', parts.slice(1), url.searchParams, request, response, dependencies);
  } catch (error) {
    sendError(response, error);
  }
  return true;
}

async function route(
  method: string,
  parts: string[],
  query: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
  { versions, scheduler, sourceDocx }: RouteDependencies,
) {
  if (method === 'GET' && parts.length === 1 && parts[0] === 'health') return sendJson(response, 200, { ok: true });
  if (parts[0] !== 'documents' || parts.length < 3) return sendJson(response, 404, { error: 'Not found.' });

  const documentId = requireMatch(parts[1], DOCUMENT_ID, 'document id');
  const resource = parts.slice(2).join('/');

  if (method === 'GET' && resource === 'source') return sendDocx(response, await sourceDocx(), `${documentId}.docx`);

  if (method === 'GET' && resource === 'versions') {
    const list = await versions.list(documentId);
    return sendJson(response, 200, { versions: list, head: headOf(list)?.id ?? null });
  }

  if (method === 'POST' && resource === 'versions') {
    const body = await readJson(request);
    const changesInSnapshot = scheduler?.changeCount(documentId) ?? 0;
    const record = await versions.save(documentId, {
      label: requireText(body.label, 'label'),
      trigger: 'named',
      createdBy: requireText(body.createdBy, 'createdBy'),
    });
    scheduler?.checkpointed(documentId, changesInSnapshot);
    return sendJson(response, 201, record);
  }

  if (method === 'GET' && parts.length === 5 && parts[2] === 'versions' && parts[4] === 'content') {
    const versionId = requireMatch(parts[3], VERSION_ID, 'version id');
    const docx = await versions.read(documentId, versionId);
    if (!docx) throw new VersionNotFoundError(versionId);
    return sendDocx(response, docx, `${documentId}-${versionId}.docx`);
  }

  if (method === 'GET' && resource === 'compare') {
    const from = requireMatch(query.get('from') ?? undefined, VERSION_ID, 'from');
    const to = requireMatch(query.get('to') ?? undefined, VERSION_ID, 'to');
    const comparison = await versions.compare(documentId, from, to);
    response.setHeader('x-review-items', String(comparison.reviewItems));
    return sendDocx(response, comparison.docx, `${documentId}-${from}-to-${to}.docx`);
  }

  if (method === 'POST' && resource === 'restore') {
    const body = await readJson(request);
    const changesInSnapshot = scheduler?.changeCount(documentId) ?? 0;
    const baseVersionId = body.baseVersionId === null ? null : requireMatch(body.baseVersionId, VERSION_ID, 'baseVersionId');
    const result = await versions.restore(documentId, {
      versionId: requireMatch(body.versionId, VERSION_ID, 'versionId'),
      baseVersionId,
      requestedBy: requireText(body.requestedBy, 'requestedBy'),
    });
    scheduler?.checkpointed(documentId, changesInSnapshot);
    return sendJson(response, 200, result);
  }

  return sendJson(response, 404, { error: 'Not found.' });
}

function sendError(response: ServerResponse, error: unknown) {
  if (error instanceof BadRequestError) return sendJson(response, 400, { error: error.message });
  if (error instanceof VersionNotFoundError) return sendJson(response, 404, { error: error.message });
  if (error instanceof RestoreConflictError) {
    return sendJson(response, 409, { error: error.message, reason: error.reason, head: error.head });
  }
  if (error instanceof ComparisonBlockedError) {
    return sendJson(response, 422, { error: error.message, blockers: error.blockers });
  }
  console.error(error);
  return sendJson(response, 500, { error: 'The version request failed.' });
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function sendDocx(response: ServerResponse, docx: Uint8Array, filename: string) {
  response.writeHead(200, {
    'content-type': DOCX_TYPE,
    'content-length': String(docx.byteLength),
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  });
  response.end(docx);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BODY_BYTES) throw new BadRequestError('The request body is too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  throw new BadRequestError('The request body must be a JSON object.');
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    throw new BadRequestError(`${name} must be text of 1 to 200 characters.`);
  }
  return value.trim();
}

function requireMatch(value: unknown, pattern: RegExp, name: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new BadRequestError(`${name} is not valid.`);
  return value;
}
