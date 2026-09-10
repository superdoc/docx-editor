import { describe, expect, it } from 'vite-plus/test';
import { deriveBlockVersion, derivePmInteriorVersion, sourceAnchorSignature } from './versionSignature.js';
import type {
  FlowBlock,
  ImageBlock,
  ImageRun,
  MarkerTrackedChange,
  ParagraphBlock,
  SourceAnchor,
  TableBlock,
  TabRun,
  TextRun,
  TrackedChangeMeta,
} from '@superdoc/contracts';

describe('sourceAnchorSignature', () => {
  it('is stable for equivalent source anchors with different object key order', () => {
    const anchorA: SourceAnchor = {
      sourceNodeId: 'srcnode_1',
      occurrenceId: 'occ_1',
      schemaQNames: [{ qName: 'w:p', namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' }],
      sourceRef: {
        partUri: 'word/document.xml',
        xpathLikePath: '/w:document[1]/w:body[1]/w:p[1]',
      },
      anchorConfidence: 'high',
    };
    const anchorB: SourceAnchor = {
      anchorConfidence: 'high',
      sourceRef: {
        xpathLikePath: '/w:document[1]/w:body[1]/w:p[1]',
        partUri: 'word/document.xml',
      },
      schemaQNames: [{ namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', qName: 'w:p' }],
      occurrenceId: 'occ_1',
      sourceNodeId: 'srcnode_1',
    };

    expect(sourceAnchorSignature(anchorA)).toBe(sourceAnchorSignature(anchorB));
  });
});

describe('deriveBlockVersion - bidi', () => {
  const makeParagraph = (bidi?: TextRun['bidi']): FlowBlock => ({
    kind: 'paragraph',
    id: 'p1',
    attrs: { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
    runs: [
      {
        text: '23.03.2026',
        fontFamily: 'David, sans-serif',
        fontSize: 16,
        pmStart: 1,
        pmEnd: 11,
        ...(bidi ? { bidi } : {}),
      } as TextRun,
    ],
  });

  // SD-3098: flipping only run.bidi must invalidate the cached block hash,
  // otherwise an edit that toggles <w:rtl/> reuses stale DOM in DomPainter.
  it('produces a different version when bidi.rtl is added', () => {
    const versionPlain = deriveBlockVersion(makeParagraph());
    const versionRtl = deriveBlockVersion(makeParagraph({ rtl: true }));
    expect(versionRtl).not.toBe(versionPlain);
  });

  it('produces a different version for bidi.rtl=true vs bidi.rtl=false', () => {
    const versionTrue = deriveBlockVersion(makeParagraph({ rtl: true }));
    const versionFalse = deriveBlockVersion(makeParagraph({ rtl: false }));
    expect(versionTrue).not.toBe(versionFalse);
  });

  it('is stable when bidi is identical', () => {
    const a = deriveBlockVersion(makeParagraph({ rtl: true }));
    const b = deriveBlockVersion(makeParagraph({ rtl: true }));
    expect(a).toBe(b);
  });
});

describe('deriveBlockVersion - horizontal scale', () => {
  const makeParagraph = (horizontalScale?: number): FlowBlock => ({
    kind: 'paragraph',
    id: 'scaled-paragraph',
    attrs: {},
    runs: [
      {
        text: 'February 2025',
        fontFamily: 'Arial',
        fontSize: 16,
        ...(horizontalScale != null ? { horizontalScale } : {}),
      } as TextRun,
    ],
  });

  it('invalidates the block version when OOXML character width changes', () => {
    expect(deriveBlockVersion(makeParagraph(0.9))).not.toBe(deriveBlockVersion(makeParagraph()));
  });
});

describe('deriveBlockVersion - Word 97-2003 run effects', () => {
  const makeParagraph = (mark?: 'doubleStrike' | 'outline' | 'shadow' | 'emboss' | 'imprint'): FlowBlock => ({
    kind: 'paragraph',
    id: 'effect-paragraph',
    attrs: {},
    runs: [
      {
        text: 'Styled',
        fontFamily: 'Arial',
        fontSize: 16,
        ...(mark ? { [mark]: true } : {}),
      } as TextRun,
    ],
  });

  /**
   * This version is what the painter reuses a fragment by. These flags are
   * paint-only, which is exactly why they are easy to leave out — and leaving
   * them out means applying one changes the file and not the page, the very
   * symptom they were added to fix.
   */
  it('invalidates the block version for each effect flag', () => {
    for (const mark of ['doubleStrike', 'outline', 'shadow', 'emboss', 'imprint'] as const) {
      expect(deriveBlockVersion(makeParagraph(mark))).not.toBe(deriveBlockVersion(makeParagraph()));
    }
  });

  it('gives each flag its own version — two effects are not one state', () => {
    const versions = (['outline', 'shadow', 'emboss', 'imprint'] as const).map((mark) =>
      deriveBlockVersion(makeParagraph(mark)),
    );

    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe('deriveBlockVersion - nested SDT containers', () => {
  const childSdt = {
    type: 'structuredContent',
    scope: 'block',
    id: 'child-sdt',
    alias: 'Client Name',
    tag: 'client-name',
    lockMode: 'unlocked',
  } as const;
  const outerGroup = {
    type: 'structuredContent',
    scope: 'block',
    id: 'outer-group',
    lockMode: 'unlocked',
  } as const;
  const makeParagraph = (containerSdt?: typeof outerGroup): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'payment-terms',
    attrs: {
      sdt: childSdt,
      ...(containerSdt ? { containerSdt } : {}),
    },
    runs: [{ kind: 'text', text: 'Payment Terms', fontFamily: 'Arial', fontSize: 16 }],
  });

  it('invalidates painted DOM when a live group.wrap adds an outer container (SD-3617)', () => {
    expect(deriveBlockVersion(makeParagraph(outerGroup))).not.toBe(deriveBlockVersion(makeParagraph()));
  });
});

describe('deriveBlockVersion - text run hyperlinks', () => {
  const makeParagraph = (link?: TextRun['link']): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'link-version',
    attrs: {},
    runs: [
      {
        text: 'SuperDoc website',
        fontFamily: 'Arial',
        fontSize: 16,
        ...(link ? { link } : {}),
      },
    ],
  });

  it('changes when a text run gains or loses a hyperlink', () => {
    const plain = deriveBlockVersion(makeParagraph());
    const linked = deriveBlockVersion(makeParagraph({ href: 'https://www.superdoc.dev/', rId: 'rId1', version: 2 }));

    expect(linked).not.toBe(plain);
  });

  it('changes when a text run hyperlink target changes', () => {
    const first = deriveBlockVersion(makeParagraph({ href: 'https://first.example/', rId: 'rId1', version: 2 }));
    const second = deriveBlockVersion(makeParagraph({ href: 'https://second.example/', rId: 'rId2', version: 2 }));

    expect(second).not.toBe(first);
  });

  it('is stable when hyperlink metadata is identical', () => {
    const first = deriveBlockVersion(makeParagraph({ href: 'https://example.com/', rId: 'rId1', version: 2 }));
    const second = deriveBlockVersion(makeParagraph({ href: 'https://example.com/', rId: 'rId1', version: 2 }));

    expect(second).toBe(first);
  });
});

describe('deriveBlockVersion - paragraph tracked-change anchors', () => {
  const makeParagraphPropertyTrackedChange = (id: string): MarkerTrackedChange => ({
    kind: 'format',
    id,
    author: 'Test Reviewer',
    date: '2026-07-08T15:31:00Z',
    type: 'formatting',
    subtype: 'paragraph-formatting',
    storyKey: 'body',
    targetKind: 'paragraph',
    groupedIds: [id],
  });

  const makeParagraph = (trackedChangeId?: string): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'paragraph-property-tracked-change-version',
    attrs: {
      indent: { left: 48 },
      ...(trackedChangeId
        ? {
            paragraphPropertyTrackedChange: makeParagraphPropertyTrackedChange(trackedChangeId),
          }
        : {}),
    },
    runs: [{ text: 'Indented paragraph', fontFamily: 'Arial', fontSize: 16 }],
  });

  it('changes when a paragraph property tracked-change anchor is added', () => {
    const plain = deriveBlockVersion(makeParagraph());
    const tracked = deriveBlockVersion(makeParagraph('tc-format-1'));

    expect(tracked).not.toBe(plain);
  });

  it('changes when only the paragraph property tracked-change identity changes', () => {
    const first = deriveBlockVersion(makeParagraph('tc-format-1'));
    const second = deriveBlockVersion(makeParagraph('tc-format-2'));

    expect(second).not.toBe(first);
  });
});

describe('deriveBlockVersion - list marker tracked-change anchors', () => {
  const makeMarkerTrackedChange = (id: string): MarkerTrackedChange => ({
    kind: 'insert',
    id,
    author: 'SuperDoc',
    date: '2026-07-09T21:59:14.632Z',
    type: 'structural',
    subtype: 'paragraph-mark-insertion',
    storyKey: 'body',
    targetKind: 'list-item',
    semanticColorKey: 'insertion',
    groupedIds: [id],
  });

  const makeParagraph = (trackedChangeId?: string): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'list-marker-tracked-change-version',
    attrs: {
      numberingProperties: { numId: 3, ilvl: 0 },
      wordLayout: {
        marker: {
          markerText: '1.',
          markerBoxWidthPx: 24,
          run: { fontFamily: 'Arial', fontSize: 16 },
          ...(trackedChangeId ? { trackedChange: makeMarkerTrackedChange(trackedChangeId) } : {}),
        },
      },
    },
    runs: [{ text: 'testing', fontFamily: 'Arial', fontSize: 16 }],
  });

  it('changes when a list marker tracked-change anchor is added', () => {
    const plain = deriveBlockVersion(makeParagraph());
    const tracked = deriveBlockVersion(makeParagraph('tc-list-marker-1'));

    expect(tracked).not.toBe(plain);
  });

  it('changes when only the list marker tracked-change identity changes', () => {
    const first = deriveBlockVersion(makeParagraph('tc-list-marker-1'));
    const second = deriveBlockVersion(makeParagraph('tc-list-marker-2'));

    expect(second).not.toBe(first);
  });

  it('uses the same list/paragraph tracked-change signature inside table cells', () => {
    const makeTable = (paragraph: ParagraphBlock): TableBlock => ({
      kind: 'table',
      id: 'table-with-tracked-list',
      rows: [{ id: 'row', cells: [{ id: 'cell', blocks: [paragraph] }] }],
    });
    const first = makeParagraph('tc-list-marker-1');
    const changedMarker = {
      ...first,
      attrs: {
        ...first.attrs,
        wordLayout: {
          ...first.attrs?.wordLayout,
          marker: { ...first.attrs?.wordLayout?.marker, markerText: 'A.' },
        },
      },
    } as ParagraphBlock;
    const changedPropertyRevision = {
      ...first,
      attrs: {
        ...first.attrs,
        paragraphPropertyTrackedChange: {
          ...makeMarkerTrackedChange('tc-list-format-2'),
          kind: 'format',
          type: 'formatting',
          subtype: 'list-formatting',
        },
      },
    } as ParagraphBlock;

    const base = deriveBlockVersion(makeTable(first));
    expect(deriveBlockVersion(makeTable(changedMarker))).not.toBe(base);
    expect(deriveBlockVersion(makeTable(changedPropertyRevision))).not.toBe(base);
  });
});

describe('deriveBlockVersion - vanished text runs', () => {
  const makeParagraph = (vanish?: boolean): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'vanish-version',
    attrs: {},
    runs: [
      {
        text: 'Hidden',
        fontFamily: 'Arial',
        fontSize: 16,
        ...(vanish ? { vanish } : {}),
      },
    ],
  });

  it('changes when only vanish changes', () => {
    expect(deriveBlockVersion(makeParagraph(true))).not.toBe(deriveBlockVersion(makeParagraph()));
  });

  it('changes when only a tab run vanish flag changes', () => {
    const tab: TabRun = { kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 16 };
    const plain: ParagraphBlock = {
      kind: 'paragraph',
      id: 'vanish-tab-version',
      attrs: {},
      runs: [tab],
    };
    const hidden: ParagraphBlock = {
      ...plain,
      runs: [{ ...tab, vanish: true }],
    };

    expect(deriveBlockVersion(hidden)).not.toBe(deriveBlockVersion(plain));
  });
});

describe('deriveBlockVersion - text transform', () => {
  const makeParagraph = (textTransform?: TextRun['textTransform']): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'text-transform-version',
    attrs: {},
    runs: [
      {
        text: 'Caps',
        fontFamily: 'Arial',
        fontSize: 16,
        ...(textTransform ? { textTransform } : {}),
      },
    ],
  });

  it('changes when only textTransform changes', () => {
    expect(deriveBlockVersion(makeParagraph('uppercase'))).not.toBe(deriveBlockVersion(makeParagraph()));
  });
});

describe('deriveBlockVersion - tracked-change colors', () => {
  const makeParagraph = (color: string, trackedChange: Partial<TrackedChangeMeta> = {}): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'tracked-color',
    attrs: {},
    runs: [
      {
        text: 'Tracked',
        fontFamily: 'Arial',
        fontSize: 16,
        trackedChange: {
          kind: 'insert',
          id: 'tc-1',
          author: 'Alice',
          color,
          ...trackedChange,
        },
      },
    ],
  });

  it('changes when only the tracked-change author color changes', () => {
    const purple = deriveBlockVersion(makeParagraph('#8250df'));
    const blue = deriveBlockVersion(makeParagraph('#1f6feb'));

    expect(blue).not.toBe(purple);
  });

  it('is stable when the tracked-change author color is identical', () => {
    const a = deriveBlockVersion(makeParagraph('#8250df'));
    const b = deriveBlockVersion(makeParagraph('#8250df'));

    expect(a).toBe(b);
  });

  it('changes when only the tracked-change semantic color changes', () => {
    const gold = deriveBlockVersion(
      makeParagraph('#8250df', {
        semanticColorKey: 'cell-merge',
        semanticColor: '#d4a72c',
        subtype: 'cell-merge',
        targetKind: 'cell',
        semanticAnchorScope: 'affected-range',
      }),
    );
    const amber = deriveBlockVersion(
      makeParagraph('#8250df', {
        semanticColorKey: 'cell-merge',
        semanticColor: '#bf8700',
        subtype: 'cell-merge',
        targetKind: 'cell',
        semanticAnchorScope: 'affected-range',
      }),
    );

    expect(amber).not.toBe(gold);
  });

  it('changes when only the tracked-change semantic category metadata changes', () => {
    const merge = deriveBlockVersion(
      makeParagraph('#8250df', {
        semanticColorKey: 'cell-merge',
        semanticColor: '#d4a72c',
        subtype: 'cell-merge',
        targetKind: 'cell',
        semanticAnchorScope: 'affected-range',
      }),
    );
    const split = deriveBlockVersion(
      makeParagraph('#8250df', {
        semanticColorKey: 'cell-split',
        semanticColor: '#d4a72c',
        subtype: 'cell-split',
        targetKind: 'cell',
        semanticAnchorScope: 'direct',
      }),
    );

    expect(split).not.toBe(merge);
  });
});

describe('deriveBlockVersion - table tracked-change semantic colors', () => {
  const makeTrackedChange = (semanticColor: string, overrides: Partial<TrackedChangeMeta> = {}): TrackedChangeMeta => ({
    kind: 'format',
    id: 'tc-cell',
    author: 'Alice',
    color: '#8250df',
    semanticColorKey: 'cell-merge',
    semanticColor,
    subtype: 'cell-merge',
    targetKind: 'cell',
    semanticAnchorScope: 'affected-range',
    ...overrides,
  });

  const makeTable = (input: {
    rowTrackedChange?: TrackedChangeMeta;
    cellTrackedChange?: TrackedChangeMeta;
  }): TableBlock => ({
    kind: 'table',
    id: 'tracked-table',
    rows: [
      {
        id: 'row-1',
        ...(input.rowTrackedChange ? { attrs: { trackedChange: input.rowTrackedChange } } : {}),
        cells: [
          {
            id: 'cell-1',
            ...(input.cellTrackedChange ? { attrs: { trackedChange: input.cellTrackedChange } } : {}),
            blocks: [
              {
                kind: 'paragraph',
                id: 'table-cell-p',
                attrs: {},
                runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 16 }],
              },
            ],
          },
        ],
      },
    ],
  });

  it('changes when only a row-level tracked-change semantic color changes', () => {
    const gold = deriveBlockVersion(makeTable({ rowTrackedChange: makeTrackedChange('#d4a72c') }));
    const amber = deriveBlockVersion(makeTable({ rowTrackedChange: makeTrackedChange('#bf8700') }));

    expect(amber).not.toBe(gold);
  });

  it('changes when only a cell-level tracked-change semantic color changes', () => {
    const gold = deriveBlockVersion(makeTable({ cellTrackedChange: makeTrackedChange('#d4a72c') }));
    const amber = deriveBlockVersion(makeTable({ cellTrackedChange: makeTrackedChange('#bf8700') }));

    expect(amber).not.toBe(gold);
  });
});

describe('deriveBlockVersion - tab underline', () => {
  const makeTabParagraph = (underline?: { style?: string; color?: string }): FlowBlock => ({
    kind: 'paragraph',
    id: 'p1',
    attrs: {},
    runs: [{ kind: 'tab', text: '\t', pmStart: 1, pmEnd: 2, ...(underline ? { underline } : {}) } as TabRun],
  });

  // SD-3330: toggling underline on a tab must change the block version, otherwise the
  // DomPainter reuses the cached (non-underlined) fragment and the underline does not
  // appear until an unrelated edit forces a rebuild.
  it('produces a different version when a tab gains an underline', () => {
    const plain = deriveBlockVersion(makeTabParagraph());
    const underlined = deriveBlockVersion(makeTabParagraph({ style: 'single', color: '#000000' }));
    expect(underlined).not.toBe(plain);
  });

  it('produces a different version when the tab underline color changes', () => {
    const black = deriveBlockVersion(makeTabParagraph({ style: 'single', color: '#000000' }));
    const red = deriveBlockVersion(makeTabParagraph({ style: 'single', color: '#FF0000' }));
    expect(red).not.toBe(black);
  });

  it('is stable when the tab underline is identical', () => {
    const a = deriveBlockVersion(makeTabParagraph({ style: 'single', color: '#000000' }));
    const b = deriveBlockVersion(makeTabParagraph({ style: 'single', color: '#000000' }));
    expect(a).toBe(b);
  });

  // SD-3330: the painter's tab underline thickness comes from fontSize, and its offset/color
  // come from measured line metrics fed by fontFamily and the run color. Each must change the
  // block version, or a font-size/family/color edit leaves a stale tab underline cached.
  const makeStyledTabParagraph = (
    overrides: Partial<{ fontSize: number; fontFamily: string; color: string; bold: boolean; italic: boolean }>,
  ): FlowBlock => ({
    kind: 'paragraph',
    id: 'p1',
    attrs: {},
    runs: [
      {
        kind: 'tab',
        text: '\t',
        pmStart: 1,
        pmEnd: 2,
        underline: { style: 'single', color: '#000000' },
        ...overrides,
      } as TabRun,
    ],
  });

  it('produces a different version when the tab fontSize changes', () => {
    const small = deriveBlockVersion(makeStyledTabParagraph({ fontSize: 12 }));
    const large = deriveBlockVersion(makeStyledTabParagraph({ fontSize: 24 }));
    expect(large).not.toBe(small);
  });

  it('produces a different version when the tab fontFamily changes', () => {
    const arial = deriveBlockVersion(makeStyledTabParagraph({ fontFamily: 'Arial' }));
    const times = deriveBlockVersion(makeStyledTabParagraph({ fontFamily: 'Times New Roman' }));
    expect(times).not.toBe(arial);
  });

  it('produces a different version when the tab run color changes', () => {
    const black = deriveBlockVersion(makeStyledTabParagraph({ color: '#000000' }));
    const red = deriveBlockVersion(makeStyledTabParagraph({ color: '#FF0000' }));
    expect(red).not.toBe(black);
  });

  // SD-3330 review: tab-only line metrics now come from the tab's font via getFontInfoFromRun, which
  // feeds bold/italic into the measured ascent/descent, so toggling them must change the version.
  it('produces a different version when the tab bold changes', () => {
    const plain = deriveBlockVersion(makeStyledTabParagraph({ bold: false }));
    const bold = deriveBlockVersion(makeStyledTabParagraph({ bold: true }));
    expect(bold).not.toBe(plain);
  });

  it('produces a different version when the tab italic changes', () => {
    const plain = deriveBlockVersion(makeStyledTabParagraph({ italic: false }));
    const italic = deriveBlockVersion(makeStyledTabParagraph({ italic: true }));
    expect(italic).not.toBe(plain);
  });

  it('is stable when tab fontSize, fontFamily and color are identical', () => {
    const a = deriveBlockVersion(makeStyledTabParagraph({ fontSize: 16, fontFamily: 'Arial', color: '#123456' }));
    const b = deriveBlockVersion(makeStyledTabParagraph({ fontSize: 16, fontFamily: 'Arial', color: '#123456' }));
    expect(a).toBe(b);
  });
});

describe('deriveBlockVersion - table image content', () => {
  const makeTableWithImage = (image: ImageBlock): TableBlock => ({
    kind: 'table',
    id: 'table-with-image',
    rows: [
      {
        id: 'row-1',
        cells: [
          {
            id: 'cell-1',
            blocks: [image],
          },
        ],
      },
    ],
  });

  const baseImage: ImageBlock = {
    kind: 'image',
    id: 'image-1',
    src: 'data:image/png;base64,AAA',
    width: 40,
    height: 20,
  };

  it('changes when a table image filter changes', () => {
    const plain = deriveBlockVersion(makeTableWithImage(baseImage));
    const filtered = deriveBlockVersion(makeTableWithImage({ ...baseImage, grayscale: true }));

    expect(filtered).not.toBe(plain);
  });

  it('changes when a table image fixed alpha changes', () => {
    const plain = deriveBlockVersion(makeTableWithImage(baseImage));
    const transparent = deriveBlockVersion(makeTableWithImage({ ...baseImage, alphaModFix: { amt: 9000 } }));

    expect(transparent).not.toBe(plain);
  });

  it('changes when a table image hyperlink changes', () => {
    const unlinked = deriveBlockVersion(makeTableWithImage(baseImage));
    const linked = deriveBlockVersion(
      makeTableWithImage({
        ...baseImage,
        hyperlink: { url: 'https://example.com/image', tooltip: 'Open image' },
      }),
    );

    expect(linked).not.toBe(unlinked);
  });

  it('does not collide when image hyperlink URL and tooltip contain separators', () => {
    const first = deriveBlockVersion(
      makeTableWithImage({
        ...baseImage,
        hyperlink: { url: 'https://example.com/a', tooltip: 'b:c' },
      }),
    );
    const second = deriveBlockVersion(
      makeTableWithImage({
        ...baseImage,
        hyperlink: { url: 'https://example.com/a:b', tooltip: 'c' },
      }),
    );

    expect(second).not.toBe(first);
  });
});

describe('deriveBlockVersion - table text run hyperlinks', () => {
  const makeTableWithTextLink = (link?: TextRun['link']): TableBlock => ({
    kind: 'table',
    id: 'table-with-text-link',
    rows: [
      {
        id: 'row-1',
        cells: [
          {
            id: 'cell-1',
            blocks: [
              {
                kind: 'paragraph',
                id: 'cell-p1',
                attrs: {},
                runs: [
                  {
                    text: 'SuperDoc website',
                    fontFamily: 'Arial',
                    fontSize: 16,
                    pmStart: 1,
                    pmEnd: 17,
                    ...(link ? { link } : {}),
                  } as TextRun,
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  it('changes when a table cell text run hyperlink target changes', () => {
    const first = deriveBlockVersion(
      makeTableWithTextLink({ href: 'https://first.example/', rId: 'rId1', version: 2 }),
    );
    const second = deriveBlockVersion(
      makeTableWithTextLink({ href: 'https://second.example/', rId: 'rId2', version: 2 }),
    );

    expect(second).not.toBe(first);
  });

  it('changes when only a table cell text run vanish flag changes', () => {
    const plain = deriveBlockVersion(makeTableWithTextLink());
    const hidden = deriveBlockVersion({
      ...makeTableWithTextLink(),
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-p1',
                  attrs: {},
                  runs: [
                    {
                      text: 'SuperDoc website',
                      fontFamily: 'Arial',
                      fontSize: 16,
                      pmStart: 1,
                      pmEnd: 17,
                      vanish: true,
                    } as TextRun,
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(hidden).not.toBe(plain);
  });

  it('changes when only a table cell text run textTransform changes', () => {
    const plain = deriveBlockVersion(makeTableWithTextLink());
    const caps = deriveBlockVersion({
      ...makeTableWithTextLink(),
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-p1',
                  attrs: {},
                  runs: [
                    {
                      text: 'SuperDoc website',
                      fontFamily: 'Arial',
                      fontSize: 16,
                      pmStart: 1,
                      pmEnd: 17,
                      textTransform: 'uppercase',
                    } as TextRun,
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(caps).not.toBe(plain);
  });
});

describe('deriveBlockVersion - textboxShape content', () => {
  const makeTextboxParagraph = (text: string): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'textbox-para-1',
    runs: [{ text, fontFamily: 'Arial', fontSize: 16, pmStart: 10, pmEnd: 10 + text.length }],
  });

  const makeTextbox = (text: string): FlowBlock => ({
    kind: 'drawing',
    id: 'textbox-1',
    drawingKind: 'textboxShape',
    geometry: { width: 120, height: 40, rotation: 0, flipH: false, flipV: false },
    shapeKind: 'rect',
    contentBlocks: [makeTextboxParagraph(text)],
    textContent: {
      parts: [{ text, fontFamily: 'Arial', fontSize: 16 }],
    },
    textInsets: { top: 4, right: 6, bottom: 4, left: 6 },
    textVerticalAlign: 'top',
  });

  it('produces a different version when textbox text changes', () => {
    const first = deriveBlockVersion(makeTextbox('Alpha'));
    const second = deriveBlockVersion(makeTextbox('Beta'));
    expect(second).not.toBe(first);
  });

  it('produces a different version when textbox insets change', () => {
    const first = deriveBlockVersion(makeTextbox('Alpha'));
    const second = deriveBlockVersion({
      ...makeTextbox('Alpha'),
      textInsets: { top: 8, right: 6, bottom: 4, left: 6 },
    });
    expect(second).not.toBe(first);
  });
});

describe('deriveBlockVersion - inline image runs', () => {
  const baseImageRun: ImageRun = {
    kind: 'image',
    src: 'data:image/png;base64,AAA',
    width: 40,
    height: 20,
  };

  const makeParagraphWithImageRun = (image: ImageRun): FlowBlock => ({
    kind: 'paragraph',
    id: 'paragraph-with-image-run',
    runs: [image],
  });

  const makeTableWithImageRun = (image: ImageRun): TableBlock => ({
    kind: 'table',
    id: 'table-with-inline-image-run',
    rows: [
      {
        id: 'row-1',
        cells: [
          {
            id: 'cell-1',
            blocks: [makeParagraphWithImageRun(image)],
          },
        ],
      },
    ],
  });

  it('changes when an inline image filter changes', () => {
    const plain = deriveBlockVersion(makeParagraphWithImageRun(baseImageRun));
    const filtered = deriveBlockVersion(
      makeParagraphWithImageRun({ ...baseImageRun, grayscale: true, lum: { bright: 25000 } }),
    );

    expect(filtered).not.toBe(plain);
  });

  it('changes when an inline image fixed alpha changes', () => {
    const plain = deriveBlockVersion(makeParagraphWithImageRun(baseImageRun));
    const transparent = deriveBlockVersion(makeParagraphWithImageRun({ ...baseImageRun, alphaModFix: { amt: 9000 } }));

    expect(transparent).not.toBe(plain);
  });

  it('changes when an inline image transform changes', () => {
    const plain = deriveBlockVersion(makeParagraphWithImageRun(baseImageRun));
    const transformed = deriveBlockVersion(makeParagraphWithImageRun({ ...baseImageRun, rotation: 45, flipH: true }));

    expect(transformed).not.toBe(plain);
  });

  it('changes when an inline image hyperlink changes', () => {
    const unlinked = deriveBlockVersion(makeParagraphWithImageRun(baseImageRun));
    const linked = deriveBlockVersion(
      makeParagraphWithImageRun({ ...baseImageRun, hyperlink: { url: 'https://example.com/inline-image' } }),
    );

    expect(linked).not.toBe(unlinked);
  });

  it('changes when an inline image tracked-change decoration is added or removed', () => {
    const trackedChange: TrackedChangeMeta = {
      kind: 'insert',
      id: 'tc-image-insert',
      author: 'Reviewer',
      semanticColorKey: 'image-insertion',
      targetKind: 'image',
    };
    const plain = deriveBlockVersion(makeParagraphWithImageRun(baseImageRun));
    const tracked = deriveBlockVersion(makeParagraphWithImageRun({ ...baseImageRun, trackedChange }));

    expect(tracked).not.toBe(plain);
  });

  it('changes when inline image tracked-change identity changes', () => {
    const first: TrackedChangeMeta = {
      kind: 'insert',
      id: 'tc-image-insert-1',
      semanticColorKey: 'image-insertion',
      targetKind: 'image',
    };
    const second: TrackedChangeMeta = {
      ...first,
      id: 'tc-image-insert-2',
    };

    expect(deriveBlockVersion(makeParagraphWithImageRun({ ...baseImageRun, trackedChange: second }))).not.toBe(
      deriveBlockVersion(makeParagraphWithImageRun({ ...baseImageRun, trackedChange: first })),
    );
  });

  it('changes when inline image SDT metadata changes', () => {
    const plain = deriveBlockVersion(makeParagraphWithImageRun(baseImageRun));
    const locked = deriveBlockVersion(
      makeParagraphWithImageRun({
        ...baseImageRun,
        sdt: {
          type: 'structuredContent',
          scope: 'inline',
          id: 'image-sdt',
          lockMode: 'contentLocked',
        },
      }),
    );

    expect(locked).not.toBe(plain);
  });

  it('changes when inline image data attributes change', () => {
    const plain = deriveBlockVersion(makeParagraphWithImageRun(baseImageRun));
    const withDataAttrs = deriveBlockVersion(
      makeParagraphWithImageRun({ ...baseImageRun, dataAttrs: { 'data-example': '1' } }),
    );

    expect(withDataAttrs).not.toBe(plain);
  });

  it('changes when an inline image raw clip path changes', () => {
    const clipA = { ...baseImageRun, clipPath: 'url(#clip-a)' };
    const clipB = { ...baseImageRun, clipPath: 'url(#clip-b)' };

    expect(deriveBlockVersion(makeParagraphWithImageRun(clipA))).not.toBe(
      deriveBlockVersion(makeParagraphWithImageRun(clipB)),
    );
    expect(deriveBlockVersion(makeTableWithImageRun(clipA))).not.toBe(deriveBlockVersion(makeTableWithImageRun(clipB)));
  });

  it('changes when a table-cell inline image visual property changes', () => {
    const plain = deriveBlockVersion(makeTableWithImageRun(baseImageRun));
    const filtered = deriveBlockVersion(makeTableWithImageRun({ ...baseImageRun, grayscale: true }));
    const linked = deriveBlockVersion(
      makeTableWithImageRun({ ...baseImageRun, hyperlink: { url: 'https://example.com/table-inline-image' } }),
    );

    expect(filtered).not.toBe(plain);
    expect(linked).not.toBe(plain);
  });

  it('changes when a table-cell inline image tracked-change decoration changes', () => {
    const plain = deriveBlockVersion(makeTableWithImageRun(baseImageRun));
    const tracked = deriveBlockVersion(
      makeTableWithImageRun({
        ...baseImageRun,
        trackedChange: {
          kind: 'insert',
          id: 'tc-table-image',
          semanticColorKey: 'image-insertion',
          targetKind: 'image',
        },
      }),
    );

    expect(tracked).not.toBe(plain);
  });
});

describe('pm positions and paint stamps (painter plan P5)', () => {
  const tableWithCellPm = (pmBase: number, secondRunStart?: number): TableBlock =>
    ({
      kind: 'table',
      id: 'pm-table',
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-para',
                  runs: [
                    { text: 'Cell', fontFamily: 'Arial', fontSize: 12, pmStart: pmBase, pmEnd: pmBase + 4 },
                    {
                      text: ' text',
                      fontFamily: 'Arial',
                      fontSize: 12,
                      pmStart: secondRunStart ?? pmBase + 4,
                      pmEnd: (secondRunStart ?? pmBase + 4) + 5,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }) as unknown as TableBlock;

  it('table stamps are pm-free: a pm-only drift keeps deriveBlockVersion byte-equal', () => {
    // The stamp is the product reuse mechanism; positions are coordinates,
    // not content. Re-adding any pm-derived term here reintroduces the
    // rebuild-every-keystroke storm on downstream table pages (P5).
    expect(deriveBlockVersion(tableWithCellPm(100))).toBe(deriveBlockVersion(tableWithCellPm(140)));
  });

  const relativePart = (version: string): string => version.slice(0, version.lastIndexOf('@'));
  const basePart = (version: string): number => Number(version.slice(version.lastIndexOf('@') + 1));

  it('derivePmInteriorVersion: relative part is drift-insensitive, base tracks the shift, redistribution changes the relative part', () => {
    const at100 = derivePmInteriorVersion(tableWithCellPm(100));
    const at140 = derivePmInteriorVersion(tableWithCellPm(140));
    // Uniform shift: relative offsets unchanged (the remap proof) while the
    // absolute base moves by exactly the drift (the uniformity witness).
    expect(relativePart(at100)).toBe(relativePart(at140));
    expect(basePart(at140) - basePart(at100)).toBe(40);
    // Interior redistribution (a moved PM node emits no run): second run
    // shifts within the block -> relative part differs (rebuild).
    expect(relativePart(at100)).not.toBe(relativePart(derivePmInteriorVersion(tableWithCellPm(100, 106))));
  });

  it('derivePmInteriorVersion covers paragraph runs and reports pm-less blocks as pm:none', () => {
    const para = (pmBase: number): ParagraphBlock =>
      ({
        kind: 'paragraph',
        id: 'p',
        runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 12, pmStart: pmBase, pmEnd: pmBase + 3 }],
      }) as unknown as ParagraphBlock;
    expect(relativePart(derivePmInteriorVersion(para(5)))).toBe(relativePart(derivePmInteriorVersion(para(50))));
    expect(basePart(derivePmInteriorVersion(para(50))) - basePart(derivePmInteriorVersion(para(5)))).toBe(45);
    const noPm = {
      kind: 'paragraph',
      id: 'p2',
      runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 12 }],
    } as unknown as ParagraphBlock;
    expect(derivePmInteriorVersion(noPm)).toBe('pm:none');
  });
});

describe('deriveBlockVersion - inline boxes', () => {
  const makeParagraph = (paddingInlineStart = 4, backgroundColor = '#eef2ff'): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'inline-box-version',
    runs: [{ text: 'Citation', fontFamily: 'Arial', fontSize: 12 }],
    inlineBoxes: [
      {
        id: 'citation',
        from: 0,
        to: 8,
        layout: {
          paddingInlineStart,
          paddingInlineEnd: 4,
          paddingBlockStart: 1,
          paddingBlockEnd: 1,
          gapBefore: 1,
          gapAfter: 1,
          borderWidth: 1,
        },
        appearance: { backgroundColor, borderColor: '#a5b4fc', borderStyle: 'solid', borderRadius: 4 },
      },
    ],
  });

  it('changes when only inline-box metrics or appearance change', () => {
    const base = deriveBlockVersion(makeParagraph());
    expect(deriveBlockVersion(makeParagraph(8))).not.toBe(base);
    expect(deriveBlockVersion(makeParagraph(4, '#ffffff'))).not.toBe(base);
  });

  it('is stable when inline-box content is identical', () => {
    expect(deriveBlockVersion(makeParagraph())).toBe(deriveBlockVersion(makeParagraph()));
  });
});
