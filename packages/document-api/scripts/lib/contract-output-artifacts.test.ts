import { describe, expect, test } from 'bun:test';

import { buildStableSchemaArtifacts, getStableSchemaRoot } from './contract-output-artifacts.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function child(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !(key in value)) return undefined;
  return value[key];
}

function collectRefs(value: JsonValue, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string') refs.push(value.$ref);
    for (const nested of Object.values(value)) collectRefs(nested, refs);
  }
  return refs;
}

function resolvesIn(document: JsonValue, ref: string): boolean {
  if (!ref.startsWith('#/')) return false;
  let node: JsonValue | undefined = document;
  for (const token of ref.slice(2).split('/')) {
    node = child(node, decodeURIComponent(token).replaceAll('~1', '/').replaceAll('~0', '~'));
    if (node === undefined) return false;
  }
  return true;
}

const contractFile = buildStableSchemaArtifacts().find(
  (file) => file.path === `${getStableSchemaRoot()}/document-api-contract.json`,
);
if (!contractFile) throw new Error('document-api-contract.json is not among the stable schema artifacts');
const contract: JsonValue = JSON.parse(contractFile.content);

describe('document-api-contract.json is a self-contained JSON Schema document', () => {
  test('every $ref resolves within the document', () => {
    const refs = collectRefs(contract);
    expect(refs.length).toBeGreaterThan(0);
    const unresolved = [...new Set(refs.filter((ref) => !resolvesIn(contract, ref)))].sort();
    expect(unresolved).toEqual([]);
  });
});
