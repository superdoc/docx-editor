import { describe, expect, it } from 'vite-plus/test';
import type {
  FlowBlock,
  Measure,
  ParagraphAttrs,
  ParagraphBlock,
  ParagraphMeasure,
  SectionBreakBlock,
  TextRun,
} from '@superdoc/contracts';
import type { LayoutOptions } from '@superdoc/layout-engine';
import {
  getCoupledFootnoteParagraphUpdatesUnsupportedReason,
  supportsCoupledFootnotePagination,
  supportsCoupledFootnoteParagraphUpdates,
  type CoupledFootnoteParagraphUpdate,
  type CoupledFootnoteReference,
} from '../src/coupled-footnote-profile';

const paragraph = (id: string, attrs: ParagraphAttrs = {}): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  attrs,
  runs: [
    { text: 'Before', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 0 },
    { text: 'Middle', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 0 },
    { text: '1', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 0 },
  ],
});

const measure = (): ParagraphMeasure => ({
  kind: 'paragraph',
  totalHeight: 60,
  lines: [0, 1, 2].map((runOrdinal) => ({
    fromRun: runOrdinal,
    toRun: runOrdinal,
    fromChar: 0,
    toChar: 1,
    width: 50,
    ascent: 15,
    descent: 5,
    lineHeight: 20,
  })),
});

const scenario = (attrs: ParagraphAttrs = {}) => {
  const first = paragraph('body-0', attrs);
  const second = paragraph('body-1');
  const section: SectionBreakBlock = {
    kind: 'sectionBreak',
    id: 'section',
    margins: {},
    type: 'continuous',
    attrs: { source: 'sectPr', sectionIndex: 0 },
  };
  const blocks: FlowBlock[] = [first, second, section];
  const measures: Measure[] = [measure(), measure(), { kind: 'sectionBreak' }];
  const options: LayoutOptions = {
    pageSize: { w: 240, h: 320 },
    margins: { top: 10, bottom: 10, left: 10, right: 10 },
    sectionMetadata: [{ sectionIndex: 0, vAlign: 'top' }],
  };
  const refs: CoupledFootnoteReference[] = [
    { id: 'note-0', pos: 0, blockId: first.id, runOrdinal: 2 },
    { id: 'note-1', pos: 0, blockId: second.id, runOrdinal: 0 },
  ];
  return { first, second, section, blocks, measures, options, refs };
};

const localUpdate = (overrides: Partial<CoupledFootnoteParagraphUpdate> = {}): CoupledFootnoteParagraphUpdate => {
  const { first, second, refs } = scenario();
  return {
    block: first,
    measure: measure(),
    refs: [refs[0]],
    previousRefs: [refs[0]],
    predecessor: paragraph('previous-body'),
    successor: second,
    ...overrides,
  };
};

const retainedProfileProof = { baselineProfileExact: true, referenceTopologyExact: true } as const;

describe('bounded coupled footnote paragraph updates', () => {
  it('validates an interior changed paragraph without requiring a local section seed', () => {
    const update = localUpdate();

    expect(supportsCoupledFootnoteParagraphUpdates([update], retainedProfileProof)).toBe(true);
  });

  it('accepts a note-free dirty paragraph under the retained global profile', () => {
    const update = localUpdate({ refs: [], previousRefs: [] });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(null);
  });

  it.each([8, 512])('does not revisit unchanged paragraph content with a %i-paragraph suffix', (suffixCount) => {
    const reads = { dirty: 0, unchanged: 0 };
    const countedParagraph = (id: string, counter: keyof typeof reads): ParagraphBlock => {
      const block = paragraph(id);
      return {
        ...block,
        get runs() {
          reads[counter] += 1;
          return block.runs;
        },
      };
    };
    const dirty = countedParagraph('body-0', 'dirty');
    const blocks = [
      countedParagraph('prefix', 'unchanged'),
      dirty,
      ...Array.from({ length: suffixCount }, (_, index) => countedParagraph(`suffix-${index}`, 'unchanged')),
    ];
    const { refs, options } = scenario();
    const measures = blocks.map(() => measure());
    expect(supportsCoupledFootnotePagination(blocks, measures, options, [refs[0]])).toBe(true);
    reads.dirty = 0;
    reads.unchanged = 0;
    const update = localUpdate({ block: dirty, measure: measures[1], predecessor: blocks[0], successor: blocks[2] });

    const reason = getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof);

    expect(reason).toBe(null);
    expect(reads.unchanged).toBe(0);
    expect(reads.dirty).toBeLessThanOrEqual(4);
  });

  it('preserves immutable current and cached reference arrays', () => {
    const update = localUpdate();
    Object.freeze(update.refs);
    Object.freeze(update.previousRefs);
    Object.freeze(update);

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(null);
  });

  it('requires the bridge to prove retained profile and topology ownership', () => {
    const update = localUpdate();

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], null)).toBe('retained-profile-unproved');
  });

  it('accepts a marker moved to a new run ordinal by text splitting while IDs and carrier order stay exact', () => {
    const { first, refs } = scenario();
    first.runs.splice(1, 0, { text: 'typed', fontFamily: 'Arial', fontSize: 12 });
    const currentMeasure: ParagraphMeasure = {
      ...measure(),
      totalHeight: 80,
      lines: [...measure().lines, { ...measure().lines[2], fromRun: 3, toRun: 3 }],
    };
    const update = localUpdate({
      block: first,
      measure: currentMeasure,
      refs: [{ ...refs[0], runOrdinal: 3, pos: 17 }],
    });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(null);
  });

  it.each<ParagraphAttrs>([
    { borders: { bottom: { style: 'solid', width: 1 } } },
    { frame: { wrap: 'none', y: 0 } },
    { frame: { wrap: 'around', y: 20 } },
  ])('rejects a dirty paragraph that gains unproved geometry (%j)', (attrs) => {
    const update = localUpdate({ block: paragraph('body-0', attrs) });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
      'unsupported-paragraph-geometry',
    );
  });

  it.each<NonNullable<TextRun['token']>>(['pageNumber', 'totalPageCount', 'pageReference', 'sectionPageCount'])(
    'rejects a newly introduced body %s token',
    (token) => {
      const block = paragraph('body-0');
      block.runs[0] = { text: '1', fontFamily: 'Arial', fontSize: 12, token };
      const update = localUpdate({ block });

      expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
        'body-page-token',
      );
    },
  );

  it('rejects a cached marker whose native run was removed', () => {
    const block = paragraph('body-0');
    block.runs.pop();
    const update = localUpdate({ block });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
      'missing-native-owner',
    );
  });

  it('rejects a current native run missing from the updated measurement', () => {
    const update = localUpdate({ measure: { ...measure(), lines: measure().lines.slice(0, 2) } });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
      'unresolved-reference-line',
    );
  });

  it('rejects an emptied section-marker owner using its actual current neighbors', () => {
    const { section } = scenario();
    const predecessor = paragraph('predecessor');
    predecessor.runs = [{ text: '', fontFamily: 'Arial', fontSize: 12 }];
    const block = paragraph('body-0', { sectPrMarker: true });
    block.runs = [{ text: '', fontFamily: 'Arial', fontSize: 12 }];
    const ref = { id: 'note-0', pos: 0, blockId: block.id, runOrdinal: 0 };
    const update = localUpdate({
      block,
      predecessor,
      successor: section,
      measure: { ...measure(), lines: [measure().lines[0]] },
      refs: [ref],
      previousRefs: [ref],
    });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
      'missing-native-owner',
    );
  });

  it.each<Partial<CoupledFootnoteParagraphUpdate>>([
    { refs: [] },
    { refs: [{ id: 'changed-id', pos: 0, blockId: 'body-0', runOrdinal: 2 }] },
    { refs: [{ id: 'note-0', pos: 0, blockId: 'other-body', runOrdinal: 2 }] },
  ])('rejects changed reference membership despite a caller topology claim (%j)', (changed) => {
    const update = localUpdate(changed);

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
      'reference-topology-changed',
    );
  });

  it('rejects reversed cached/current note ID order even when both current owners resolve', () => {
    const first = { id: 'first', pos: 0, blockId: 'body-0', runOrdinal: 0 };
    const second = { id: 'second', pos: 0, blockId: 'body-0', runOrdinal: 2 };
    const update = localUpdate({
      previousRefs: [first, second],
      refs: [
        { ...second, runOrdinal: 0 },
        { ...first, runOrdinal: 2 },
      ],
    });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
      'reference-topology-changed',
    );
  });

  it('rejects current native run order that contradicts the preserved note order', () => {
    const first = { id: 'first', pos: 0, blockId: 'body-0', runOrdinal: 0 };
    const second = { id: 'second', pos: 0, blockId: 'body-0', runOrdinal: 2 };
    const update = localUpdate({
      previousRefs: [first, second],
      refs: [
        { ...first, runOrdinal: 2 },
        { ...second, runOrdinal: 0 },
      ],
    });

    expect(getCoupledFootnoteParagraphUpdatesUnsupportedReason([update], retainedProfileProof)).toBe(
      'unordered-native-references',
    );
  });
});

describe('coupled footnote input profile', () => {
  it('accepts exact native run owners with coincident synthetic PM positions and no source-anchor branding', () => {
    const { blocks, measures, options, refs } = scenario();

    expect(supportsCoupledFootnotePagination(blocks, measures, options, refs)).toBe(true);
  });

  it('accepts a single implicit section without a terminal section block', () => {
    const { first, second, options, refs } = scenario();

    expect(supportsCoupledFootnotePagination([first, second], [measure(), measure()], options, refs)).toBe(true);
  });

  it('accepts the native leading continuous first-section geometry seed', () => {
    const { first, second, section, options, refs } = scenario();
    const seed: SectionBreakBlock = {
      ...section,
      pageSize: options.pageSize,
      margins: options.margins!,
      columns: { count: 1, gap: 0 },
      vAlign: 'top',
      attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true, typeIsExplicit: false },
    };

    expect(
      supportsCoupledFootnotePagination(
        [seed, first, second],
        [{ kind: 'sectionBreak' }, measure(), measure()],
        options,
        refs,
      ),
    ).toBe(true);
  });

  it.each<Partial<SectionBreakBlock>>([
    { attrs: { source: 'sectPr', sectionIndex: 0 } },
    { attrs: { source: 'sectPr', sectionIndex: 1, isFirstSection: true } },
    { type: 'nextPage' },
    { type: undefined },
    { vAlign: 'center' },
    { columns: { count: 2, gap: 10 } },
  ])('rejects an unproved leading section boundary (%j)', (unsupported) => {
    const { first, second, section, options, refs } = scenario();
    const seed: SectionBreakBlock = { ...section, attrs: { ...section.attrs, isFirstSection: true }, ...unsupported };

    expect(
      supportsCoupledFootnotePagination(
        [seed, first, second],
        [{ kind: 'sectionBreak' }, measure(), measure()],
        options,
        refs,
      ),
    ).toBe(false);
  });

  it('rejects both a leading seed and an additional section boundary', () => {
    const { first, second, section, options, refs } = scenario();
    const seed: SectionBreakBlock = { ...section, id: 'seed', attrs: { ...section.attrs, isFirstSection: true } };

    expect(
      supportsCoupledFootnotePagination(
        [seed, first, second, section],
        [{ kind: 'sectionBreak' }, measure(), measure(), { kind: 'sectionBreak' }],
        options,
        refs,
      ),
    ).toBe(false);
  });

  it('rejects a first-section flag on a boundary after body flow has started', () => {
    const { first, second, section, options, refs } = scenario();
    const seed: SectionBreakBlock = { ...section, attrs: { ...section.attrs, isFirstSection: true } };

    expect(
      supportsCoupledFootnotePagination(
        [first, seed, second],
        [measure(), { kind: 'sectionBreak' }, measure()],
        options,
        refs,
      ),
    ).toBe(false);
  });

  it('rejects references on section-marker paragraphs that the engine omits', () => {
    const { first, second, section, options } = scenario();
    first.runs = [{ text: '', fontFamily: 'Arial', fontSize: 12 }];
    second.runs = [{ text: '', fontFamily: 'Arial', fontSize: 12 }];
    second.attrs = { sectPrMarker: true };
    const emptyMeasure: ParagraphMeasure = { ...measure(), lines: [measure().lines[0]] };

    expect(
      supportsCoupledFootnotePagination(
        [first, second, section],
        [emptyMeasure, emptyMeasure, { kind: 'sectionBreak' }],
        options,
        [{ id: 'note', pos: 0, blockId: second.id, runOrdinal: 0 }],
      ),
    ).toBe(false);
  });

  it('rejects decreasing native run order within a paragraph instead of choosing the wrong last note', () => {
    const { blocks, measures, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination(blocks, measures, options, [
        refs[0],
        { ...refs[0], id: 'earlier-note', runOrdinal: 0 },
      ]),
    ).toBe(false);
  });

  it('accepts increasing run owners in one paragraph even when their PM positions coincide', () => {
    const { blocks, measures, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination(blocks, measures, options, [
        { ...refs[0], id: 'earlier-note', runOrdinal: 0 },
        refs[0],
      ]),
    ).toBe(true);
  });

  it.each<ParagraphAttrs>([
    { keepNext: true },
    { keepLines: true, widowControl: false },
    { widowControl: true },
    { pageBreakBefore: true },
    { styleId: 'CustomHeading', headingLevel: 2, keepNext: true, keepLines: true, widowControl: true },
    { numberingProperties: { numId: 4, ilvl: 1 }, contextualSpacing: true, spacing: { before: 10, after: 10 } },
  ])('preserves normal paragraph pagination controls (%j)', (attrs) => {
    const { blocks, measures, options, refs } = scenario(attrs);

    expect(supportsCoupledFootnotePagination(blocks, measures, options, refs)).toBe(true);
  });

  it('accepts a page break inside a paragraph without discarding the later native anchor', () => {
    const { first, blocks, measures, options, refs } = scenario();
    first.runs[1] = { kind: 'break', breakType: 'page', pmStart: 0, pmEnd: 0 };

    expect(supportsCoupledFootnotePagination(blocks, measures, options, refs)).toBe(true);
  });

  it('leaves header and footer geometry and numbering to the normal path', () => {
    const { blocks, measures, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination(
        blocks,
        measures,
        {
          ...options,
          headerContentHeights: { first: 20, default: 10 },
          footerContentHeights: { default: 20 },
          sectionMetadata: [
            {
              sectionIndex: 0,
              numbering: { start: 3 },
              headerRefs: { default: 'rId1' },
              footerRefs: { default: 'rId2' },
            },
          ],
        },
        refs,
      ),
    ).toBe(true);
  });

  it.each<Partial<CoupledFootnoteReference>>([
    { blockId: undefined },
    { blockId: 'missing' },
    { blockId: 'section' },
    { runOrdinal: undefined },
    { runOrdinal: null },
    { runOrdinal: -1 },
    { runOrdinal: 0.5 },
    { runOrdinal: NaN },
    { runOrdinal: Infinity },
    { runOrdinal: 3 },
  ])('rejects unresolved native paragraph/run ownership (%j)', (owner) => {
    const { blocks, measures, options, refs } = scenario();

    expect(supportsCoupledFootnotePagination(blocks, measures, options, [{ ...refs[0], ...owner }])).toBe(false);
  });

  it('rejects duplicate reference IDs even when they point at different paragraphs', () => {
    const { blocks, measures, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination(blocks, measures, options, [refs[0], { ...refs[1], id: refs[0].id }]),
    ).toBe(false);
  });

  it('rejects duplicate block IDs rather than selecting an arbitrary run owner', () => {
    const { first, second, section, measures, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination([first, { ...second, id: first.id }, section], measures, options, refs),
    ).toBe(false);
  });

  it('rejects an anchor absent from the measured lines', () => {
    const { blocks, measures, options, refs } = scenario();
    const missingOwnerLine = { ...measure(), lines: measure().lines.slice(0, 2) };

    expect(supportsCoupledFootnotePagination(blocks, [missingOwnerLine, ...measures.slice(1)], options, refs)).toBe(
      false,
    );
  });

  it('rejects a line range that resolves only through an invalid run boundary', () => {
    const { blocks, measures, options, refs } = scenario();
    const invalidRange = { ...measure(), lines: [{ ...measure().lines[0], toRun: 99 }] };

    expect(supportsCoupledFootnotePagination(blocks, [invalidRange, ...measures.slice(1)], options, refs)).toBe(false);
  });

  it('rejects missing measures instead of trusting positional array alignment', () => {
    const { blocks, measures, options, refs } = scenario();

    expect(supportsCoupledFootnotePagination(blocks, measures.slice(1), options, refs)).toBe(false);
  });

  it('rejects a non-paragraph measure for a paragraph owner', () => {
    const { blocks, measures, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination(blocks, [{ kind: 'sectionBreak' }, ...measures.slice(1)], options, refs),
    ).toBe(false);
  });

  it.each<NonNullable<TextRun['token']>>(['pageNumber', 'totalPageCount', 'pageReference', 'sectionPageCount'])(
    'rejects body %s tokens until page-dependent remeasurement is proved',
    (token) => {
      const { first, blocks, measures, options, refs } = scenario();
      first.runs[0] = { text: '1', fontFamily: 'Arial', fontSize: 12, token };

      expect(supportsCoupledFootnotePagination(blocks, measures, options, refs)).toBe(false);
    },
  );

  it.each<ParagraphAttrs>([
    { frame: { wrap: 'none', y: 0 } },
    { frame: { wrap: 'around', y: 20 } },
    { floatAlignment: 'right' },
    { borders: { bottom: { style: 'solid', width: 1 } } },
    { dropCap: 'drop' },
    { textboxId: 'textbox-0' },
    { directionContext: { inlineDirection: 'ltr', writingMode: 'vertical-rl' } },
  ])('rejects unproved paragraph geometry (%j)', (attrs) => {
    const { blocks, measures, options, refs } = scenario(attrs);

    expect(supportsCoupledFootnotePagination(blocks, measures, options, refs)).toBe(false);
  });

  it.each<FlowBlock>([
    { kind: 'table', id: 'table', rows: [] },
    { kind: 'list', id: 'list', listType: 'bullet', items: [] },
    { kind: 'image', id: 'image', src: 'image.png', anchor: { isAnchored: true, vRelativeFrom: 'page' } },
    {
      kind: 'drawing',
      drawingKind: 'image',
      id: 'drawing',
      src: 'image.png',
      anchor: { isAnchored: true, vRelativeFrom: 'page' },
    },
    { kind: 'pageBreak', id: 'page-break' },
    { kind: 'columnBreak', id: 'column-break' },
  ])('rejects unsupported body blocks (%j)', (unsupported) => {
    const { first, section, measures, options, refs } = scenario();

    expect(supportsCoupledFootnotePagination([first, unsupported, section], measures, options, refs.slice(0, 1))).toBe(
      false,
    );
  });

  it('rejects a section boundary before the end even if its page geometry matches', () => {
    const { first, second, section, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination(
        [first, section, second],
        [measure(), { kind: 'sectionBreak' }, measure()],
        options,
        refs,
      ),
    ).toBe(false);
  });

  it.each<Partial<SectionBreakBlock>>([
    { columns: { count: 2, gap: 20 } },
    { vAlign: 'center' },
    { vAlign: 'bottom' },
    { vAlign: 'both' },
    { pageSize: { w: 240, h: NaN } },
  ])('rejects unsupported terminal section geometry (%j)', (geometry) => {
    const { first, second, section, measures, options, refs } = scenario();

    expect(
      supportsCoupledFootnotePagination([first, second, { ...section, ...geometry }], measures, options, refs),
    ).toBe(false);
  });

  it.each<LayoutOptions>([
    { columns: { count: 2, gap: 20 } },
    { sectionMetadata: [{ sectionIndex: 0 }, { sectionIndex: 1 }] },
    { sectionMetadata: [{ sectionIndex: 0, vAlign: 'center' }] },
    { flowMode: 'semantic' },
    { startContext: { pageNumberOffset: 3 } },
    { pageBoundary: { shouldStopBeforeNewPage: () => true } },
    { pageSize: { w: 240, h: Infinity } },
    { nonFlowPositionedParagraphFrameIds: new Set(['body-0']) },
  ])('rejects unsupported document geometry or partial flow (%j)', (unsupported) => {
    const { blocks, measures, options, refs } = scenario();

    expect(supportsCoupledFootnotePagination(blocks, measures, { ...options, ...unsupported }, refs)).toBe(false);
  });
});
