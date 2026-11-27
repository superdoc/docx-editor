import { describe, expect, it } from 'bun:test';
import { normalizeFindQuery } from './find.js';
import type { Query, Selector } from '../types/index.js';

describe('normalizeFindQuery', () => {
  it('passes through a full Query object with canonical selector', () => {
    const query: Query = {
      select: { type: 'node', nodeType: 'paragraph' },
      limit: 10,
    };

    const result = normalizeFindQuery(query);
    expect(result).toStrictEqual(query);
  });

  it('wraps a NodeSelector into a Query', () => {
    const selector: Selector = { type: 'node', nodeType: 'heading' };

    expect(normalizeFindQuery(selector)).toEqual({ select: selector });
  });

  it('normalizes the nodeType shorthand into a canonical NodeSelector', () => {
    const selector: Selector = { nodeType: 'paragraph' };

    expect(normalizeFindQuery(selector)).toEqual({
      select: { type: 'node', nodeType: 'paragraph' },
      limit: undefined,
      offset: undefined,
      within: undefined,
      includeNodes: undefined,
      includeUnknown: undefined,
    });
  });

  it('maps FindOptions fields onto the Query', () => {
    const selector: Selector = { type: 'text', pattern: 'hello' };
    const within = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };

    const result = normalizeFindQuery(selector, {
      limit: 5,
      offset: 2,
      within,
      includeNodes: true,
      includeUnknown: true,
    });

    expect(result).toEqual({
      select: selector,
      limit: 5,
      offset: 2,
      within,
      includeNodes: true,
      includeUnknown: true,
    });
  });

  it('leaves optional fields undefined when options are omitted', () => {
    const selector: Selector = { type: 'node', nodeType: 'table' };

    const result = normalizeFindQuery(selector);

    expect(result.select).toStrictEqual(selector);
    expect(result.limit).toBeUndefined();
    expect(result.offset).toBeUndefined();
    expect(result.within).toBeUndefined();
    expect(result.includeNodes).toBeUndefined();
    expect(result.includeUnknown).toBeUndefined();
  });

  it('preserves wholeWord on text selectors', () => {
    const selector: Selector = { type: 'text', pattern: 'alpha', wholeWord: true };

    expect(normalizeFindQuery(selector)).toEqual({
      select: { type: 'text', pattern: 'alpha', wholeWord: true },
    });
  });
});

// ---------------------------------------------------------------------------
// BUG: SDK-shaped find params are not directly usable with the contract API
// ---------------------------------------------------------------------------
// The Node and Python SDKs generate a flat params interface for find:
//   { type?: string, pattern?: string, nodeType?: string, kind?: string, ... }
//
// This works end-to-end because the CLI wraps these flat flags into a proper
// Query object (via find-query.ts buildFlatFindQueryDraft). But the contract
// API (normalizeFindQuery / executeFind) expects either:
//   - A Selector: { type: 'text', pattern: '...' } or { nodeType: 'paragraph' }
//   - A Query: { select: { type: 'text', pattern: '...' }, limit?: ... }
//
// The SDK interface shape misleads consumers about what the actual API expects.
// If anyone bypasses the CLI (e.g. calling the Document API directly), the flat
// params shape doesn't match the contract.

describe('BUG: SDK params shape vs Document API contract', () => {
  it('SDK-shaped params with top-level "type" and "pattern" should produce a valid Query', () => {
    // This is what the SDK sends: flat { type, pattern } fields.
    // The CLI wraps these into { select: { type, pattern } } before calling the API.
    // But normalizeFindQuery receives the raw input and should handle both forms.
    const sdkShapedParams = { type: 'text', pattern: 'termination' } as unknown as Selector;

    // normalizeFindQuery treats { type: 'text', pattern: '...' } as a TextSelector
    // (it has a 'type' discriminant), so this case DOES work for TextSelector.
    const result = normalizeFindQuery(sdkShapedParams);

    expect(result.select).toEqual({ type: 'text', pattern: 'termination' });
  });

  it('SDK-shaped params with additional CLI-only fields pollute the Query', () => {
    // The SDK sends ALL flat params together: type, pattern, limit, offset, etc.
    // When these are passed as a "Selector" to normalizeFindQuery, the extra fields
    // (limit, offset, sessionId, doc) leak into the select object.
    const sdkShapedParams = {
      type: 'text',
      pattern: 'hello',
      limit: 10,
      offset: 0,
      sessionId: 'sess-1',
      doc: './contract.docx',
    } as unknown as Selector;

    const result = normalizeFindQuery(sdkShapedParams);

    // BUG: The select object now contains limit, offset, sessionId, doc —
    // fields that belong on the Query, not on the Selector.
    expect(result.select).toEqual({ type: 'text', pattern: 'hello' });
    expect(result.select).not.toHaveProperty('limit');
    expect(result.select).not.toHaveProperty('sessionId');
    expect(result.select).not.toHaveProperty('doc');
  });

  it('SDK-shaped nodeType params should produce a valid node Query', () => {
    // SDK sends: { type: 'node', nodeType: 'paragraph' }
    // But the Selector shorthand is just { nodeType: 'paragraph' } (no 'type' field).
    // The SDK shape with type='node' IS a valid NodeSelector, so this works.
    const sdkShapedParams = { type: 'node', nodeType: 'paragraph' } as unknown as Selector;

    const result = normalizeFindQuery(sdkShapedParams);

    // The 'type' field should be preserved on the selector
    expect(result.select.type).toBe('node');
    expect((result.select as { nodeType?: string }).nodeType).toBe('paragraph');
  });
});
