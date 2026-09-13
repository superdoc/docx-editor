/**
 * SDM/1 fragment validation conformance tests.
 *
 * Each test corresponds to a numbered validation rule from the spec.
 * Tests cover both SDM/1 shapes (kind-discriminated) and legacy backward compat.
 */
import { describe, it, expect } from 'bun:test';
import { validateSDFragment, validateDocumentFragment } from './fragment-validator.js';
import { DocumentApiValidationError } from '../errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectError(fn: () => void, code: string, msgMatch?: string | RegExp) {
  try {
    fn();
    expect.fail('Expected DocumentApiValidationError to be thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(DocumentApiValidationError);
    expect((e as DocumentApiValidationError).code).toBe(code);
    if (msgMatch) {
      expect((e as DocumentApiValidationError).message).toMatch(msgMatch);
    }
  }
}

function validParagraph() {
  return { kind: 'paragraph', paragraph: { inlines: [] } };
}

// ---------------------------------------------------------------------------
// Rule 1: Fragment must be non-empty
// ---------------------------------------------------------------------------

describe('Rule 1: non-empty fragment', () => {
  it('rejects null', () => expectError(() => validateSDFragment(null), 'INVALID_PAYLOAD'));
  it('rejects undefined', () => expectError(() => validateSDFragment(undefined), 'INVALID_PAYLOAD'));
  it('rejects empty array', () => expectError(() => validateSDFragment([]), 'INVALID_PAYLOAD'));
  it('accepts single node', () => expect(() => validateSDFragment(validParagraph())).not.toThrow());
  it('accepts array of nodes', () => expect(() => validateSDFragment([validParagraph()])).not.toThrow());
});

// ---------------------------------------------------------------------------
// Rule 2: kind must match exactly one payload key
// ---------------------------------------------------------------------------

describe('Rule 2: kind matches payload key', () => {
  it('rejects node missing payload key', () => {
    expectError(
      () => validateSDFragment({ kind: 'paragraph' }),
      'INVALID_PAYLOAD',
      /must have a "paragraph" payload key/,
    );
  });

  it('rejects non-object payload', () => {
    expectError(() => validateSDFragment({ kind: 'paragraph', paragraph: 'not an object' }), 'INVALID_PAYLOAD');
  });

  it('accepts marker kinds without payload key', () => {
    expect(() => validateSDFragment({ kind: 'break' })).not.toThrow();
    expect(() => validateSDFragment({ kind: 'sectionBreak' })).not.toThrow();
  });

  it('accepts extension kinds without payload key', () => {
    expect(() => validateSDFragment({ kind: 'ext.custom' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 3: IDs must be unique when provided
// ---------------------------------------------------------------------------

describe('Rule 3: unique IDs', () => {
  it('rejects duplicate IDs in fragment', () => {
    expectError(
      () =>
        validateSDFragment([
          { kind: 'paragraph', id: 'dup-1', paragraph: {} },
          { kind: 'paragraph', id: 'dup-1', paragraph: {} },
        ]),
      'DUPLICATE_ID',
      /dup-1/,
    );
  });

  it('accepts unique IDs', () => {
    expect(() =>
      validateSDFragment([
        { kind: 'paragraph', id: 'a', paragraph: {} },
        { kind: 'paragraph', id: 'b', paragraph: {} },
      ]),
    ).not.toThrow();
  });

  it('allows nodes without IDs', () => {
    expect(() =>
      validateSDFragment([
        { kind: 'paragraph', paragraph: {} },
        { kind: 'paragraph', paragraph: {} },
      ]),
    ).not.toThrow();
  });

  it('detects duplicate IDs in nested table cells', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'table',
          table: {
            rows: [
              {
                cells: [
                  {
                    content: [{ kind: 'paragraph', id: 'dup', paragraph: {} }],
                  },
                  {
                    content: [{ kind: 'paragraph', id: 'dup', paragraph: {} }],
                  },
                ],
              },
            ],
          },
        }),
      'DUPLICATE_ID',
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 4: Inline arrays must be valid inline unions
// ---------------------------------------------------------------------------

describe('Rule 4: inline array validation', () => {
  it('rejects non-array inlines', () => {
    expectError(
      () => validateSDFragment({ kind: 'paragraph', paragraph: { inlines: 'not-array' } }),
      'INVALID_PAYLOAD',
      /inlines must be an array/,
    );
  });

  it('rejects inline without kind', () => {
    expectError(
      () => validateSDFragment({ kind: 'paragraph', paragraph: { inlines: [{ text: 'hi' }] } }),
      'INVALID_PAYLOAD',
      /must have a string "kind" field/,
    );
  });

  it('rejects unknown inline kind', () => {
    expectError(
      () => validateSDFragment({ kind: 'paragraph', paragraph: { inlines: [{ kind: 'bogus' }] } }),
      'INVALID_PAYLOAD',
      /not a valid inline node kind/,
    );
  });

  it('accepts valid inline run', () => {
    expect(() =>
      validateSDFragment({
        kind: 'paragraph',
        paragraph: { inlines: [{ kind: 'run' }] },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 5: Heading level must be 1–9
// ---------------------------------------------------------------------------

describe('Rule 5: heading level', () => {
  it('rejects missing level', () => {
    expectError(() => validateSDFragment({ kind: 'heading', heading: {} }), 'INVALID_PAYLOAD', /between 1 and 9/);
  });

  it('rejects level 0', () => {
    expectError(() => validateSDFragment({ kind: 'heading', heading: { level: 0 } }), 'INVALID_PAYLOAD');
  });

  it('rejects level 10', () => {
    expectError(() => validateSDFragment({ kind: 'heading', heading: { level: 10 } }), 'INVALID_PAYLOAD');
  });

  it('rejects non-integer level', () => {
    expectError(() => validateSDFragment({ kind: 'heading', heading: { level: 2.5 } }), 'INVALID_PAYLOAD');
  });

  it('accepts level 1', () => {
    expect(() => validateSDFragment({ kind: 'heading', heading: { level: 1 } })).not.toThrow();
  });

  it('accepts level 6', () => {
    expect(() => validateSDFragment({ kind: 'heading', heading: { level: 6 } })).not.toThrow();
  });

  it.each([7, 8, 9])('accepts level %i', (level) => {
    expect(() => validateSDFragment({ kind: 'heading', heading: { level } })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 6: Table row/cell spans must be valid positive integers
// ---------------------------------------------------------------------------

describe('Rule 6: table spans', () => {
  function tableWithCellSpans(rowSpan?: unknown, colSpan?: unknown) {
    return {
      kind: 'table',
      table: {
        rows: [{ cells: [{ rowSpan, colSpan, content: [] }] }],
      },
    };
  }

  it('rejects rowSpan 0', () => expectError(() => validateSDFragment(tableWithCellSpans(0)), 'INVALID_PAYLOAD'));
  it('rejects colSpan -1', () =>
    expectError(() => validateSDFragment(tableWithCellSpans(undefined, -1)), 'INVALID_PAYLOAD'));
  it('rejects non-integer rowSpan', () =>
    expectError(() => validateSDFragment(tableWithCellSpans(1.5)), 'INVALID_PAYLOAD'));
  it('accepts valid spans', () => expect(() => validateSDFragment(tableWithCellSpans(2, 3))).not.toThrow());
  it('accepts omitted spans', () => expect(() => validateSDFragment(tableWithCellSpans())).not.toThrow());

  it('accepts semantic header cells', () => {
    expect(() =>
      validateSDFragment({
        kind: 'table',
        table: { rows: [{ cells: [{ header: true, content: [validParagraph()] }] }] },
      }),
    ).not.toThrow();
  });

  it('rejects malformed and unknown header-cell fields', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'table',
          table: { rows: [{ cells: [{ header: 'true', content: [] }] }] },
        }),
      'INVALID_PAYLOAD',
      /header must be a boolean/,
    );
    expectError(
      () =>
        validateSDFragment({
          kind: 'table',
          table: { rows: [{ cells: [{ header: true, isHeader: true, content: [] }] }] },
        }),
      'INVALID_PAYLOAD',
      /Unknown table cell field/,
    );
  });
});

describe('horizontalRule content node', () => {
  it('accepts the explicit empty-payload form', () => {
    expect(() => validateSDFragment({ kind: 'horizontalRule', horizontalRule: {} })).not.toThrow();
  });

  it('rejects missing, non-empty, and unknown forms', () => {
    expectError(() => validateSDFragment({ kind: 'horizontalRule' }), 'INVALID_PAYLOAD', /payload key/);
    expectError(
      () => validateSDFragment({ kind: 'horizontalRule', horizontalRule: { style: 'border' } }),
      'INVALID_PAYLOAD',
      /must be empty/,
    );
    expectError(
      () => validateSDFragment({ kind: 'horizontalRule', horizontalRule: {}, border: true }),
      'INVALID_PAYLOAD',
      /Unknown horizontalRule field/,
    );
    expectError(
      () => validateSDFragment({ kind: 'horizontalRule', horizontalRule: {}, ext: {} }),
      'INVALID_PAYLOAD',
      /Unknown horizontalRule field/,
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 7: SDT/CustomXml — exactly one of inlines/content
// ---------------------------------------------------------------------------

describe('Rule 7: sdt inlines/content exclusivity', () => {
  it('rejects both inlines and content on sdt', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'sdt',
          sdt: { inlines: [], content: [] },
        }),
      'INVALID_PAYLOAD',
      /either "inlines" or "content", not both/,
    );
  });

  it('accepts sdt with only inlines', () => {
    expect(() => validateSDFragment({ kind: 'sdt', sdt: { inlines: [] } })).not.toThrow();
  });

  it('accepts sdt with only content', () => {
    expect(() =>
      validateSDFragment({
        kind: 'sdt',
        sdt: { content: [{ kind: 'paragraph', paragraph: {} }] },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 8: Hyperlink nesting forbidden
// ---------------------------------------------------------------------------

describe('Rule 8: hyperlink nesting', () => {
  it('rejects nested hyperlinks', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'paragraph',
          paragraph: {
            inlines: [
              {
                kind: 'hyperlink',
                hyperlink: {
                  inlines: [{ kind: 'hyperlink', hyperlink: {} }],
                },
              },
            ],
          },
        }),
      'INVALID_NESTING',
      /cannot be nested/,
    );
  });

  it('accepts non-nested hyperlink', () => {
    expect(() =>
      validateSDFragment({
        kind: 'paragraph',
        paragraph: {
          inlines: [{ kind: 'hyperlink', hyperlink: { inlines: [{ kind: 'run' }] } }],
        },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 9: Unknown kinds only via ext.*
// ---------------------------------------------------------------------------

describe('Rule 9: extension kinds', () => {
  it('rejects unknown kind without ext. prefix', () => {
    expectError(() => validateSDFragment({ kind: 'foobar' }), 'INVALID_PAYLOAD', /not a valid content node kind/);
  });

  it('accepts ext.* kind', () => {
    expect(() => validateSDFragment({ kind: 'ext.myPlugin' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 10: TOC ranges 1..9, from <= to
// ---------------------------------------------------------------------------

describe('Rule 10: TOC outline level range', () => {
  it('rejects outlineLevels from > to', () => {
    expectError(
      () => validateSDFragment({ kind: 'toc', toc: { sourceConfig: { outlineLevels: { from: 5, to: 2 } } } }),
      'INVALID_PAYLOAD',
      /must be <= to/,
    );
  });

  it('rejects outlineLevels from 0', () => {
    expectError(
      () => validateSDFragment({ kind: 'toc', toc: { sourceConfig: { outlineLevels: { from: 0, to: 3 } } } }),
      'INVALID_PAYLOAD',
    );
  });

  it('rejects outlineLevels to 10', () => {
    expectError(
      () => validateSDFragment({ kind: 'toc', toc: { sourceConfig: { outlineLevels: { from: 1, to: 10 } } } }),
      'INVALID_PAYLOAD',
    );
  });

  it('accepts valid outlineLevels range', () => {
    expect(() =>
      validateSDFragment({ kind: 'toc', toc: { sourceConfig: { outlineLevels: { from: 1, to: 6 } } } }),
    ).not.toThrow();
  });

  it('rejects tcFieldLevels from > to', () => {
    expectError(
      () => validateSDFragment({ kind: 'toc', toc: { sourceConfig: { tcFieldLevels: { from: 7, to: 3 } } } }),
      'INVALID_PAYLOAD',
      /must be <= to/,
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 11: displayConfig.includePageNumbers vs displayConfig.omitPageNumberLevels
// ---------------------------------------------------------------------------

describe('Rule 11: TOC page number exclusion', () => {
  it('rejects both includePageNumbers=false and omitPageNumberLevels', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'toc',
          toc: { displayConfig: { includePageNumbers: false, omitPageNumberLevels: { from: 1, to: 1 } } },
        }),
      'INVALID_PAYLOAD',
      /includePageNumbers/,
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 12: displayConfig.tabLeader vs displayConfig.separator
// ---------------------------------------------------------------------------

describe('Rule 12: TOC tabLeader vs separator', () => {
  it('rejects both tabLeader and separator', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'toc',
          toc: { displayConfig: { tabLeader: 'dot', separator: '-' } },
        }),
      'INVALID_PAYLOAD',
      /tabLeader.*separator/,
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 13: paragraph.numbering.level 0..8
// ---------------------------------------------------------------------------

describe('Rule 13: numbering level', () => {
  it('rejects level -1', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'paragraph',
          paragraph: { numbering: { level: -1 } },
        }),
      'INVALID_PAYLOAD',
      /0–8/,
    );
  });

  it('rejects level 9', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'paragraph',
          paragraph: { numbering: { level: 9 } },
        }),
      'INVALID_PAYLOAD',
    );
  });

  it('accepts level 0', () => {
    expect(() =>
      validateSDFragment({
        kind: 'paragraph',
        paragraph: { numbering: { level: 0 } },
      }),
    ).not.toThrow();
  });

  it('accepts level 8', () => {
    expect(() =>
      validateSDFragment({
        kind: 'paragraph',
        paragraph: { numbering: { level: 8 } },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 14: paragraph.tabs[*].position must be positive
// ---------------------------------------------------------------------------

describe('Rule 14: tab stop position', () => {
  it('rejects zero position', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'paragraph',
          paragraph: { tabs: [{ position: 0 }] },
        }),
      'INVALID_PAYLOAD',
      /positive/,
    );
  });

  it('rejects negative position', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'paragraph',
          paragraph: { tabs: [{ position: -5 }] },
        }),
      'INVALID_PAYLOAD',
    );
  });

  it('accepts positive position', () => {
    expect(() =>
      validateSDFragment({
        kind: 'paragraph',
        paragraph: { tabs: [{ position: 72 }] },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 15: sectionBreak.targetSectionId shape check (string when present)
// ---------------------------------------------------------------------------

describe('Rule 15: sectionBreak targetSectionId shape', () => {
  it('rejects empty string targetSectionId', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'sectionBreak',
          sectionBreak: { targetSectionId: '' },
        }),
      'INVALID_PAYLOAD',
      /non-empty string/,
    );
  });

  it('accepts valid targetSectionId', () => {
    expect(() =>
      validateSDFragment({
        kind: 'sectionBreak',
        sectionBreak: { targetSectionId: 'section-1' },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 16: SDList + paragraph.numbering conflict
// ---------------------------------------------------------------------------

describe('Rule 16: list/numbering conflict', () => {
  it('rejects paragraph with numbering inside SDList', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'list',
          list: {
            items: [
              {
                level: 0,
                content: [
                  {
                    kind: 'paragraph',
                    paragraph: { inlines: [], props: { numbering: { numId: '1', level: 0 } } },
                  },
                ],
              },
            ],
          },
        }),
      'INVALID_PAYLOAD',
      /numbering conflicts with SDList context/,
    );
  });

  it('rejects heading with numbering inside SDList', () => {
    expectError(
      () =>
        validateSDFragment({
          kind: 'list',
          list: {
            items: [
              {
                level: 0,
                content: [
                  {
                    kind: 'heading',
                    heading: { level: 1, inlines: [], props: { numbering: { numId: '2', level: 1 } } },
                  },
                ],
              },
            ],
          },
        }),
      'INVALID_PAYLOAD',
      /numbering conflicts with SDList context/,
    );
  });

  it('accepts paragraph without numbering inside SDList', () => {
    expect(() =>
      validateSDFragment({
        kind: 'list',
        list: {
          items: [
            {
              level: 0,
              content: [{ kind: 'paragraph', paragraph: { inlines: [] } }],
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it('accepts standalone paragraph with numbering (read-only fidelity)', () => {
    expect(() =>
      validateSDFragment({
        kind: 'paragraph',
        paragraph: { numbering: { numId: '1', level: 0 } },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Legacy backward compatibility
// ---------------------------------------------------------------------------

describe('Legacy shape backward compat', () => {
  it('accepts legacy paragraph with type discriminant', () => {
    expect(() =>
      validateDocumentFragment({ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }),
    ).not.toThrow();
  });

  it('rejects legacy empty fragment', () => {
    expectError(() => validateDocumentFragment([]), 'INVALID_PAYLOAD');
  });

  it('rejects invalid legacy top-level type', () => {
    expectError(() => validateDocumentFragment({ type: 'div' }), 'INVALID_PAYLOAD');
  });

  it('routes kind-discriminated nodes to SDM/1 path', () => {
    expect(() => validateDocumentFragment({ kind: 'paragraph', paragraph: {} })).not.toThrow();
  });
});
