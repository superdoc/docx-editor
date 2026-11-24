import { describe, expect, it } from 'bun:test';
import { assertOperationId, isOperationId, isValidOperationIdFormat } from './types.js';
import type { DocumentApiMemberPath } from './operation-map.js';

describe('isValidOperationIdFormat', () => {
  it('accepts simple camelCase identifiers', () => {
    expect(isValidOperationIdFormat('find')).toBe(true);
    expect(isValidOperationIdFormat('getNode')).toBe(true);
    expect(isValidOperationIdFormat('getText')).toBe(true);
  });

  it('accepts namespaced identifiers (namespace.camelCase)', () => {
    expect(isValidOperationIdFormat('comments.create')).toBe(true);
    expect(isValidOperationIdFormat('trackChanges.list')).toBe(true);
    expect(isValidOperationIdFormat('lists.create')).toBe(true);
  });

  it('accepts three-segment identifiers (group.subgroup.camelCase)', () => {
    expect(isValidOperationIdFormat('format.paragraph.setAlignment')).toBe(true);
    expect(isValidOperationIdFormat('styles.paragraph.setStyle')).toBe(true);
    expect(isValidOperationIdFormat('a.b.c')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isValidOperationIdFormat('')).toBe(false);
  });

  it('rejects identifiers starting with uppercase', () => {
    expect(isValidOperationIdFormat('Find')).toBe(false);
    expect(isValidOperationIdFormat('Comments.add')).toBe(false);
  });

  it('rejects identifiers with four or more segments', () => {
    expect(isValidOperationIdFormat('a.b.c.d')).toBe(false);
  });

  it('rejects identifiers with special characters', () => {
    expect(isValidOperationIdFormat('find-all')).toBe(false);
    expect(isValidOperationIdFormat('find_all')).toBe(false);
    expect(isValidOperationIdFormat('find all')).toBe(false);
  });

  it('rejects trailing or leading dots', () => {
    expect(isValidOperationIdFormat('.find')).toBe(false);
    expect(isValidOperationIdFormat('find.')).toBe(false);
  });
});

describe('isOperationId', () => {
  it('returns true for known operation IDs', () => {
    expect(isOperationId('insert')).toBe(true);
    expect(isOperationId('format.paragraph.setAlignment')).toBe(true);
  });

  it('returns false for unknown but validly formatted strings', () => {
    expect(isOperationId('unknown')).toBe(false);
    expect(isOperationId('comments.unknown')).toBe(false);
  });

  it('returns false for invalid format strings', () => {
    expect(isOperationId('')).toBe(false);
    expect(isOperationId('FIND')).toBe(false);
  });
});

describe('assertOperationId', () => {
  it('does not throw for a known operation ID', () => {
    expect(() => assertOperationId('comments.create')).not.toThrow();
  });

  it('throws for unknown operation IDs', () => {
    expect(() => assertOperationId('nonexistent')).toThrow(/Unknown operationId "nonexistent"/);
  });

  it('throws for invalid format strings', () => {
    expect(() => assertOperationId('BAD FORMAT')).toThrow(/Unknown operationId/);
  });
});

describe('DocumentApiMemberPath type safety', () => {
  it('is narrower than string', () => {
    type IsWideString = string extends DocumentApiMemberPath ? true : false;
    const isWideString: IsWideString = false;
    expect(isWideString).toBe(false);
  });
});
