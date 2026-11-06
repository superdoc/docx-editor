/**
 * Migration: `meta.docx` → Yjs `parts` map.
 *
 * Copies non-document OOXML parts from the legacy `meta.docx` array into
 * individual `parts` map entries with versioned envelopes. The migration is
 * idempotent and safe to re-run — already-present keys are skipped.
 *
 * `meta.docx` is NEVER deleted or modified.
 */

import * as Y from 'yjs';
import type { PartsMigrationMeta, PartsCapability } from './types.js';
import { encodeEnvelopeToYjs } from './json-crdt.js';
import { parseXmlToJson } from '../../../core/super-converter/v2/docxHelper.js';
import { preservePeopleWhitespace } from '../../../core/super-converter/comment-author-identity.js';
import {
  PARTS_MAP_KEY,
  META_MAP_KEY,
  META_PARTS_MIGRATION_KEY,
  META_PARTS_CAPABILITY_KEY,
  META_PARTS_SCHEMA_VERSION_KEY,
  EXCLUDED_PART_IDS,
  PARTS_SCHEMA_VERSION,
} from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocxEntry {
  name: string;
  content: unknown;
}

export interface MigrationResult {
  migrated: boolean;
  partsMigrated: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Migration Trigger Check
// ---------------------------------------------------------------------------

/**
 * Determine if migration from `meta.docx` → `parts` is needed.
 *
 * Migration triggers when any of these hold:
 * 1. `parts` map has no non-document entries and `meta.docx` exists.
 * 2. `parts` map exists but is missing keys present in `meta.docx`.
 * 3. `partsMigration.status` is not `'success'`.
 */
export function isMigrationNeeded(ydoc: Y.Doc): boolean {
  const metaMap = ydoc.getMap(META_MAP_KEY);
  const partsMap = ydoc.getMap(PARTS_MAP_KEY);

  const migrationMeta = metaMap.get(META_PARTS_MIGRATION_KEY) as PartsMigrationMeta | undefined;
  if (migrationMeta?.status === 'success') {
    // Check for partial migration (keys in meta.docx not yet in parts)
    const docxEntries = readDocxEntries(metaMap);
    const candidateKeys = getCandidateKeys(docxEntries, partsMap);
    return candidateKeys.length > 0;
  }

  // No successful migration recorded — check if there's source data
  const docxValue = metaMap.get('docx');
  return docxValue != null;
}

// ---------------------------------------------------------------------------
// Migration Algorithm
// ---------------------------------------------------------------------------

/**
 * Run the migration from `meta.docx` to individual `parts` entries.
 *
 * All-or-nothing: parse all candidates first, then write them in a single
 * Yjs transaction. On parse failure, nothing is written.
 */
export function migrateMetaDocxToParts(ydoc: Y.Doc, options: { force?: boolean } = {}): MigrationResult {
  const metaMap = ydoc.getMap(META_MAP_KEY);
  const partsMap = ydoc.getMap(PARTS_MAP_KEY) as Y.Map<unknown>;

  // Read and normalize meta.docx entries
  const docxEntries = readDocxEntries(metaMap);
  if (docxEntries.length === 0) {
    return { migrated: false, partsMigrated: 0, error: 'No meta.docx entries found' };
  }

  // Build candidate set: entries absent from parts map
  const candidates = options.force
    ? docxEntries.filter((e) => !EXCLUDED_PART_IDS.has(e.name))
    : getCandidateEntries(docxEntries, partsMap);

  if (candidates.length === 0) {
    // Already fully migrated — ensure status is recorded
    updateMigrationStatus(metaMap, 'success', null, ydoc);
    return { migrated: false, partsMigrated: 0, error: null };
  }

  // Record attempt
  updateMigrationStatus(metaMap, 'in-progress', null, ydoc);

  // Parse stage: validate all candidates before writing.
  // Always parse from meta.docx (authoritative source for legacy rooms).
  const parsed: Array<{ name: string; data: unknown }> = [];
  try {
    for (const entry of candidates) {
      const data = parsePartContent(entry);
      parsed.push({ name: entry.name, data });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateMigrationStatus(metaMap, 'failed', errorMsg, ydoc);
    return { migrated: false, partsMigrated: 0, error: errorMsg };
  }

  // Write stage: single transaction for all parts + metadata
  ydoc.transact(
    () => {
      for (const { name, data } of parsed) {
        const envelope = encodeEnvelopeToYjs({ v: 1, clientId: ydoc.clientID, data });
        partsMap.set(name, envelope);
      }

      metaMap.set(META_PARTS_SCHEMA_VERSION_KEY, PARTS_SCHEMA_VERSION);

      // Set capability marker atomically with migration
      const capability: PartsCapability = {
        version: PARTS_SCHEMA_VERSION,
        enabledAt: new Date().toISOString(),
        clientId: ydoc.clientID,
      };
      metaMap.set(META_PARTS_CAPABILITY_KEY, capability);
    },
    { event: 'parts-migration' },
  );

  updateMigrationStatus(metaMap, 'success', null, ydoc);

  return { migrated: true, partsMigrated: parsed.length, error: null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readDocxEntries(metaMap: Y.Map<unknown>): DocxEntry[] {
  const docxValue = metaMap.get('docx');
  if (!docxValue) return [];

  if (Array.isArray(docxValue)) return docxValue as DocxEntry[];
  if (typeof (docxValue as { toArray?: unknown }).toArray === 'function') {
    return (docxValue as { toArray: () => DocxEntry[] }).toArray();
  }
  if (docxValue && typeof (docxValue as Iterable<DocxEntry>)[Symbol.iterator] === 'function') {
    return Array.from(docxValue as Iterable<DocxEntry>);
  }
  return [];
}

function getCandidateKeys(docxEntries: DocxEntry[], partsMap: Y.Map<unknown>): string[] {
  return docxEntries.filter((e) => !EXCLUDED_PART_IDS.has(e.name) && !partsMap.has(e.name)).map((e) => e.name);
}

function getCandidateEntries(docxEntries: DocxEntry[], partsMap: Y.Map<unknown>): DocxEntry[] {
  return docxEntries.filter((e) => !EXCLUDED_PART_IDS.has(e.name) && !partsMap.has(e.name));
}

function parsePartContent(entry: DocxEntry): unknown {
  if (entry.content === null || entry.content === undefined) {
    throw new Error(`Part "${entry.name}" has no content`);
  }

  // meta.docx content is authoritative for legacy rooms. It can be:
  // - An object (JSON tree from the original seeder)
  // - A string (raw XML from a legacy collaboration export)
  if (typeof entry.content === 'object') return entry.content;

  if (typeof entry.content === 'string') {
    // Parse raw XML to JSON using the same xml-js path the converter uses,
    // ensuring the JSON tree shape matches converter.convertedXml exactly.
    return preservePeopleWhitespace(entry.content, parseXmlToJson(entry.content));
  }

  throw new Error(`Part "${entry.name}" has unsupported content type: ${typeof entry.content}`);
}

function updateMigrationStatus(
  metaMap: Y.Map<unknown>,
  status: PartsMigrationMeta['status'],
  error: string | null,
  ydoc: Y.Doc,
): void {
  const existing = (metaMap.get(META_PARTS_MIGRATION_KEY) ?? {}) as Partial<PartsMigrationMeta>;
  const updated: PartsMigrationMeta = {
    status,
    attempts: (existing.attempts ?? 0) + (status === 'in-progress' ? 1 : 0),
    lastAttemptAt: status === 'in-progress' ? new Date().toISOString() : (existing.lastAttemptAt ?? null),
    lastSuccessAt: status === 'success' ? new Date().toISOString() : (existing.lastSuccessAt ?? null),
    lastError: error,
    source: `client:${ydoc.clientID}`,
  };
  metaMap.set(META_PARTS_MIGRATION_KEY, updated);
}
