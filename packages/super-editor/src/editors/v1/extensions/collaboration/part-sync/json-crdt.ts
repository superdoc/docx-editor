/**
 * JSON ↔ Yjs encode/decode for part CRDT storage.
 *
 * v1 semantics: full-part replace. Envelopes are stored as JSON-safe plain
 * objects inside the Yjs parts map instead of nested Yjs types. This avoids
 * duplicate-Yjs constructor mismatches when a caller provides a Y.Doc created
 * by a different bundled copy of Yjs.
 *
 * `decodeYjsToJson` converts the Yjs structures back to plain JSON for
 * local consumption by the mutation core.
 */

import * as Y from 'yjs';
import type { PartEnvelope } from './types.js';

// ---------------------------------------------------------------------------
// Encode: JSON → Yjs
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Recursively clone a JSON-like value into plain JS storage. */
function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(encodeValue);
  }

  if (isPlainObject(value)) {
    const encoded: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      encoded[key] = encodeValue(nestedValue);
    }
    return encoded;
  }

  // Scalar / binary passthrough
  return value;
}

/**
 * Encode a `PartEnvelope` into a JSON-safe value for the `parts` map.
 */
export function encodeEnvelopeToYjs(envelope: PartEnvelope): Record<string, unknown> {
  return {
    v: envelope.v,
    clientId: envelope.clientId,
    data: encodeValue(envelope.data),
    ...(envelope.generatedCommentAuthors === undefined
      ? {}
      : {
          generatedCommentAuthors: encodeValue(envelope.generatedCommentAuthors),
        }),
  };
}

// ---------------------------------------------------------------------------
// Decode: Yjs → JSON
// ---------------------------------------------------------------------------

/** Recursively decode a Yjs value back to plain JSON. */
function decodeValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      obj[k] = decodeValue(v);
    }
    return obj;
  }

  if (value instanceof Y.Array) {
    return value.toArray().map(decodeValue);
  }

  if (Array.isArray(value)) {
    return value.map(decodeValue);
  }

  if (isPlainObject(value)) {
    const obj: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      obj[key] = decodeValue(nestedValue);
    }
    return obj;
  }

  // Scalar passthrough (string, number, boolean, null, undefined)
  return value;
}

/**
 * Decode a stored `parts` value back into a `PartEnvelope`.
 *
 * Returns `null` if the structure is missing required fields.
 */
export function decodeYjsToEnvelope(value: unknown): PartEnvelope | null {
  let v: unknown;
  let clientId: unknown;
  let rawData: unknown;
  let generatedCommentAuthors: unknown;

  if (value instanceof Y.Map) {
    v = value.get('v');
    clientId = value.get('clientId');
    rawData = value.get('data');
    generatedCommentAuthors = value.get('generatedCommentAuthors');
  } else if (isPlainObject(value)) {
    v = value.v;
    clientId = value.clientId;
    rawData = value.data;
    generatedCommentAuthors = value.generatedCommentAuthors;
  } else {
    return null;
  }

  if (typeof v !== 'number' || typeof clientId !== 'number') return null;

  return {
    v,
    clientId,
    data: decodeValue(rawData),
    ...(generatedCommentAuthors === undefined
      ? {}
      : {
          generatedCommentAuthors: decodeValue(generatedCommentAuthors) as [string, string][],
        }),
  };
}

/**
 * Read the current version from a Yjs parts map entry without full decode.
 * Returns 0 if the entry doesn't exist or lacks a version.
 */
export function readEnvelopeVersion(partsMap: Y.Map<unknown>, partId: string): number {
  return decodeYjsToEnvelope(partsMap.get(partId))?.v ?? 0;
}
