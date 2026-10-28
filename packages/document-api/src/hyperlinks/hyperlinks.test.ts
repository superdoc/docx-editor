import { describe, it, expect, mock } from 'bun:test';
import {
  executeHyperlinksList,
  executeHyperlinksGet,
  executeHyperlinksWrap,
  executeHyperlinksInsert,
  executeHyperlinksPatch,
  executeHyperlinksRemove,
  type HyperlinksAdapter,
} from './hyperlinks.js';
import { DocumentApiValidationError } from '../errors.js';
import type {
  HyperlinksListResult,
  HyperlinkInfo,
  HyperlinkMutationResult,
  HyperlinkTarget,
} from './hyperlinks.types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAdapter(overrides: Partial<HyperlinksAdapter> = {}): HyperlinksAdapter {
  const defaultResult: HyperlinkMutationResult = {
    success: true,
    hyperlink: validTarget(),
  };
  const defaultInfo: HyperlinkInfo = {
    address: validTarget(),
    properties: { href: 'https://example.com' },
    text: 'Example',
  };
  const defaultList: HyperlinksListResult = {
    evaluatedRevision: '1',
    total: 0,
    items: [],
    page: { limit: 100, offset: 0, returned: 0 },
  };

  return {
    list: mock(() => defaultList),
    get: mock(() => defaultInfo),
    wrap: mock(() => defaultResult),
    insert: mock(() => defaultResult),
    patch: mock(() => defaultResult),
    remove: mock(() => defaultResult),
    ...overrides,
  };
}

function validTarget(): HyperlinkTarget {
  return {
    kind: 'inline',
    nodeType: 'hyperlink',
    anchor: {
      start: { blockId: 'p1', offset: 0 },
      end: { blockId: 'p1', offset: 5 },
    },
  };
}

function validTextAddress(start = 0, end = 5) {
  return { kind: 'text' as const, blockId: 'p1', range: { start, end } };
}

function validLink() {
  return { destination: { href: 'https://example.com' } };
}

function expectValidationError(fn: () => void, code: string, messagePattern?: RegExp) {
  try {
    fn();
    throw new Error('Expected DocumentApiValidationError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(DocumentApiValidationError);
    expect((err as DocumentApiValidationError).code).toBe(code);
    if (messagePattern) {
      expect((err as DocumentApiValidationError).message).toMatch(messagePattern);
    }
  }
}

// ---------------------------------------------------------------------------
// hyperlinks.list
// ---------------------------------------------------------------------------

describe('executeHyperlinksList', () => {
  it('projects adapter-only story catalogs while preserving discovery data and future validation visibility', () => {
    const canonical: HyperlinksListResult = {
      evaluatedRevision: '7',
      total: 0,
      items: [],
      page: { limit: 10, offset: 0, returned: 0 },
    };
    const privateResult = { ...canonical, stories: [{ storyId: 'main', hyperlinks: [] }], unknownResultField: true };
    const adapter = makeAdapter({ list: mock(() => privateResult) });
    const actual = executeHyperlinksList(adapter);
    expect(actual).toEqual({ ...canonical, unknownResultField: true });
    expect(actual).not.toHaveProperty('stories');
    expect(privateResult.stories).toHaveLength(1);
  });

  it('delegates to adapter.list', () => {
    const adapter = makeAdapter();
    executeHyperlinksList(adapter);
    expect(adapter.list).toHaveBeenCalledTimes(1);
  });

  it('passes query through', () => {
    const adapter = makeAdapter();
    const query = { hrefPattern: 'example', limit: 10 };
    executeHyperlinksList(adapter, query);
    expect(adapter.list).toHaveBeenCalledWith(query);
  });

  it('passes a note story through unchanged', () => {
    const adapter = makeAdapter();
    const query = { in: { kind: 'story', storyType: 'footnote', noteId: '1' } } as const;
    executeHyperlinksList(adapter, query);
    expect(adapter.list).toHaveBeenCalledWith(query);
  });

  it('rejects a malformed story before reaching the adapter', () => {
    const adapter = makeAdapter();
    expect(() => executeHyperlinksList(adapter, { in: { kind: 'story', storyType: 'footnote' } as never })).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
    expect(adapter.list).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// hyperlinks.get
// ---------------------------------------------------------------------------

describe('executeHyperlinksGet', () => {
  it('delegates to adapter.get with valid target', () => {
    const adapter = makeAdapter();
    executeHyperlinksGet(adapter, { target: validTarget() });
    expect(adapter.get).toHaveBeenCalledTimes(1);
  });

  it('rejects missing target', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeHyperlinksGet(adapter, { target: undefined as never }), 'INVALID_TARGET');
  });

  it('rejects target with wrong kind', () => {
    const adapter = makeAdapter();
    const badTarget = { ...validTarget(), kind: 'block' } as never;
    expectValidationError(() => executeHyperlinksGet(adapter, { target: badTarget }), 'INVALID_TARGET');
  });

  it('rejects target with wrong nodeType', () => {
    const adapter = makeAdapter();
    const badTarget = { ...validTarget(), nodeType: 'comment' } as never;
    expectValidationError(() => executeHyperlinksGet(adapter, { target: badTarget }), 'INVALID_TARGET');
  });

  it('rejects target with missing anchor', () => {
    const adapter = makeAdapter();
    const badTarget = { kind: 'inline', nodeType: 'hyperlink' } as never;
    expectValidationError(() => executeHyperlinksGet(adapter, { target: badTarget }), 'INVALID_TARGET');
  });
});

// ---------------------------------------------------------------------------
// hyperlinks.wrap
// ---------------------------------------------------------------------------

describe('executeHyperlinksWrap', () => {
  it('delegates to adapter.wrap with valid input', () => {
    const adapter = makeAdapter();
    executeHyperlinksWrap(adapter, { target: validTextAddress(), link: validLink() });
    expect(adapter.wrap).toHaveBeenCalledTimes(1);
  });

  it('rejects non-TextAddress target', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksWrap(adapter, { target: { kind: 'block' } as never, link: validLink() }),
      'INVALID_TARGET',
    );
  });

  it('rejects collapsed range (start === end)', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksWrap(adapter, { target: validTextAddress(3, 3), link: validLink() }),
      'INVALID_TARGET',
      /non-collapsed/,
    );
  });

  it('rejects link with no destination href or anchor', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksWrap(adapter, { target: validTextAddress(), link: { destination: {} } }),
      'INVALID_INPUT',
      /at least one of/,
    );
  });

  it('accepts link with anchor-only destination', () => {
    const adapter = makeAdapter();
    executeHyperlinksWrap(adapter, {
      target: validTextAddress(),
      link: { destination: { anchor: 'bookmark1' } },
    });
    expect(adapter.wrap).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// hyperlinks.insert
// ---------------------------------------------------------------------------

describe('executeHyperlinksInsert', () => {
  it('delegates to adapter.insert with valid input and target', () => {
    const adapter = makeAdapter();
    executeHyperlinksInsert(adapter, { target: validTextAddress(3, 3), text: 'Click', link: validLink() });
    expect(adapter.insert).toHaveBeenCalledTimes(1);
  });

  it('allows omitted target (target-less insert)', () => {
    const adapter = makeAdapter();
    executeHyperlinksInsert(adapter, { text: 'Click', link: validLink() });
    expect(adapter.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects empty text', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksInsert(adapter, { text: '', link: validLink() }),
      'INVALID_INPUT',
      /non-empty text/,
    );
  });

  it('rejects non-TextAddress target', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksInsert(adapter, { target: { kind: 'block' } as never, text: 'Click', link: validLink() }),
      'INVALID_TARGET',
    );
  });

  it('rejects non-collapsed target range', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksInsert(adapter, { target: validTextAddress(0, 5), text: 'Click', link: validLink() }),
      'INVALID_TARGET',
      /collapsed range/,
    );
  });

  it('rejects link with no destination', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksInsert(adapter, { text: 'Click', link: { destination: {} } }),
      'INVALID_INPUT',
      /at least one of/,
    );
  });
});

// ---------------------------------------------------------------------------
// hyperlinks.patch
// ---------------------------------------------------------------------------

describe('executeHyperlinksPatch', () => {
  it('delegates to adapter.patch with valid input', () => {
    const adapter = makeAdapter();
    executeHyperlinksPatch(adapter, { target: validTarget(), patch: { href: 'https://new.com' } });
    expect(adapter.patch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid target', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksPatch(adapter, { target: {} as never, patch: { href: 'https://new.com' } }),
      'INVALID_TARGET',
    );
  });

  it('rejects non-object patch', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksPatch(adapter, { target: validTarget(), patch: 'bad' as never }),
      'INVALID_INPUT',
    );
  });

  it('rejects unknown patch fields', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksPatch(adapter, { target: validTarget(), patch: { unknown: 'x' } as never }),
      'INVALID_INPUT',
      /Unknown field/,
    );
  });

  it('rejects empty patch (no fields set)', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksPatch(adapter, { target: validTarget(), patch: {} }),
      'INVALID_INPUT',
      /at least one field/,
    );
  });

  it('accepts null values for clearing fields', () => {
    const adapter = makeAdapter();
    executeHyperlinksPatch(adapter, { target: validTarget(), patch: { tooltip: null } });
    expect(adapter.patch).toHaveBeenCalledTimes(1);
  });

  it('rejects non-string, non-null field values', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksPatch(adapter, { target: validTarget(), patch: { href: 42 as never } }),
      'INVALID_INPUT',
      /string, null, or omitted/,
    );
  });
});

// ---------------------------------------------------------------------------
// hyperlinks.remove
// ---------------------------------------------------------------------------

describe('executeHyperlinksRemove', () => {
  it('delegates to adapter.remove with valid input', () => {
    const adapter = makeAdapter();
    executeHyperlinksRemove(adapter, { target: validTarget() });
    expect(adapter.remove).toHaveBeenCalledTimes(1);
  });

  it('accepts mode: unwrap', () => {
    const adapter = makeAdapter();
    executeHyperlinksRemove(adapter, { target: validTarget(), mode: 'unwrap' });
    expect(adapter.remove).toHaveBeenCalledTimes(1);
  });

  it('accepts mode: deleteText', () => {
    const adapter = makeAdapter();
    executeHyperlinksRemove(adapter, { target: validTarget(), mode: 'deleteText' });
    expect(adapter.remove).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid mode', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeHyperlinksRemove(adapter, { target: validTarget(), mode: 'invalid' as never }),
      'INVALID_INPUT',
      /unwrap.*deleteText/,
    );
  });

  it('rejects invalid target', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeHyperlinksRemove(adapter, { target: null as never }), 'INVALID_TARGET');
  });
});
