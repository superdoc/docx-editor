import { describe, expect, it } from 'vite-plus/test';
import type { TextRun } from '@superdoc/contracts';
import type { FragmentRenderContext } from '../renderer.js';
import type { DerivedRunTextPlane } from '../derived-run-text-plane.js';
import type { RunRenderContext } from './types.js';
import { textRunMergeSignature } from './hash.js';
import { applyRunStyles, renderTextRun, resolveRunText } from './text-run.js';

const makeRunRenderContext = (overrides: Partial<RunRenderContext> = {}): RunRenderContext =>
  ({
    doc: document,
    layoutEpoch: 42,
    showFormattingMarks: false,
    contentControlsChrome: 'default',
    pendingTooltips: new WeakMap<HTMLElement, string>(),
    getNextLinkId: () => 'link-1',
    applySdtDataset: () => {},
    buildImageHyperlinkAnchor: (child: HTMLElement) => child,
    resolveTrackedChangesConfig: () => ({ mode: 'final', enabled: false }),
    applyTrackedChangeDecorations: () => {},
    resolveRunSdtId: () => null,
    createInlineSdtWrapper: () => document.createElement('span'),
    syncInlineSdtWrapperTypography: () => {},
    expandSdtWrapperPmRange: () => {},
    ...overrides,
  }) as unknown as RunRenderContext;

describe('resolveRunText', () => {
  const context: FragmentRenderContext = {
    pageNumber: 1,
    displayPageNumber: 5,
    pageNumberText: 'v',
    totalPages: 10,
    section: 'body',
  };

  it('uses section-formatted page number text without a local format', () => {
    const run: TextRun = { text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 12 };

    expect(resolveRunText(run, context)).toBe('v');
  });

  it('resolves a derived run-text override by stable data attribute identity', () => {
    const run: TextRun = {
      text: '8735',
      fontFamily: 'Arial',
      fontSize: 12,
      dataAttrs: { 'data-v2-note-ref': 'footnote:note-1' },
    };
    const plane: DerivedRunTextPlane = {
      generation: 42,
      revision: 'notes-2',
      valuesByDataAttribute: new Map([['data-v2-note-ref', new Map([['footnote:note-1', '8720']])]]),
    };

    expect(resolveRunText(run, { ...context, derivedRunTextPlane: plane })).toBe('8720');
  });

  it('uses run-local page number format when present', () => {
    const run: TextRun = {
      text: '0',
      token: 'pageNumber',
      pageNumberFieldFormat: { format: 'upperRoman' },
      fontFamily: 'Arial',
      fontSize: 12,
    };

    expect(resolveRunText(run, context)).toBe('V');
  });

  it('preserves chapter prefix when applying run-local page number format', () => {
    const run: TextRun = {
      text: '0',
      token: 'pageNumber',
      pageNumberFieldFormat: { format: 'upperRoman' },
      fontFamily: 'Arial',
      fontSize: 12,
    };

    expect(
      resolveRunText(run, {
        ...context,
        pageNumberText: '3:5',
        pageNumberFormat: 'decimal',
        pageNumberChapterText: '3',
        pageNumberChapterSeparator: 'colon',
      }),
    ).toBe('3:V');
  });

  it('uses section page count context for SECTIONPAGES tokens', () => {
    const run: TextRun = { text: '0', token: 'sectionPageCount', fontFamily: 'Arial', fontSize: 12 };

    expect(resolveRunText(run, { ...context, sectionPageCount: 7 })).toBe('7');
  });

  it('preserves cached SECTIONPAGES text when section page count context is missing', () => {
    const run: TextRun = { text: '42', token: 'sectionPageCount', fontFamily: 'Arial', fontSize: 12 };

    expect(resolveRunText(run, context)).toBe('42');
  });

  it('formats SECTIONPAGES tokens with run-local page number format', () => {
    const run: TextRun = {
      text: '0',
      token: 'sectionPageCount',
      pageNumberFieldFormat: { format: 'upperRoman' },
      fontFamily: 'Arial',
      fontSize: 12,
    };

    expect(resolveRunText(run, { ...context, sectionPageCount: 7 })).toBe('VII');
  });
  it('renders provisional NUMPAGES/SECTIONPAGES from cached run text with an em dash fallback', () => {
    const provisional: FragmentRenderContext = {
      ...context,
      sectionPageCount: 7,
      pageCountFieldsExact: false,
    };

    // PAGE always resolves — the physical page a fragment paints on is known.
    expect(resolveRunText({ text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 12 }, provisional)).toBe(
      'v',
    );
    // Cached DOCX results survive; the partial totals never render.
    expect(
      resolveRunText({ text: '12', token: 'totalPageCount', fontFamily: 'Arial', fontSize: 12 }, provisional),
    ).toBe('12');
    expect(
      resolveRunText({ text: '4', token: 'sectionPageCount', fontFamily: 'Arial', fontSize: 12 }, provisional),
    ).toBe('4');
    // No cached result: em dash placeholder, never a wrong partial number.
    expect(resolveRunText({ text: '', token: 'totalPageCount', fontFamily: 'Arial', fontSize: 12 }, provisional)).toBe(
      '—',
    );
    expect(
      resolveRunText({ text: ' ', token: 'sectionPageCount', fontFamily: 'Arial', fontSize: 12 }, provisional),
    ).toBe('—');
    // Exact mode replaces the provisional values with computed totals.
    expect(
      resolveRunText(
        { text: '12', token: 'totalPageCount', fontFamily: 'Arial', fontSize: 12 },
        { ...context, sectionPageCount: 7 },
      ),
    ).toBe('10');
  });

  it('changes merge signature when pageNumberFieldFormat changes', () => {
    const baseRun: TextRun = { text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 12 };
    const formattedRun: TextRun = { ...baseRun, pageNumberFieldFormat: { format: 'upperRoman' } };

    expect(textRunMergeSignature(baseRun)).not.toBe(textRunMergeSignature(formattedRun));
  });

  it('changes merge signature when vanish changes', () => {
    const baseRun: TextRun = { text: 'Hidden', fontFamily: 'Arial', fontSize: 12 };
    const hiddenRun: TextRun = { ...baseRun, vanish: true };

    expect(textRunMergeSignature(baseRun)).not.toBe(textRunMergeSignature(hiddenRun));
  });

  it('changes merge signature when horizontal scale changes', () => {
    const baseRun: TextRun = { text: 'Scaled', fontFamily: 'Arial', fontSize: 12 };
    const scaledRun: TextRun = { ...baseRun, horizontalScale: 0.9 };

    expect(textRunMergeSignature(baseRun)).not.toBe(textRunMergeSignature(scaledRun));
  });

  it('changes merge signature when paint-only text effects change', () => {
    const baseRun: TextRun = { text: 'Styled', fontFamily: 'Arial', fontSize: 12 };
    const effectedRun: TextRun = { ...baseRun, textEffects: { fill: '#FFFFFF' } };

    expect(textRunMergeSignature(baseRun)).not.toBe(textRunMergeSignature(effectedRun));
  });
});

describe('renderTextRun', () => {
  const context: FragmentRenderContext = {
    pageNumber: 1,
    section: 'body',
  };

  it('renders vanished text as an empty addressable mapping span', () => {
    const run: TextRun = {
      text: 'Hidden',
      fontFamily: 'Arial',
      fontSize: 16,
      vanish: true,
      pmStart: 10,
      pmEnd: 16,
      dataAttrs: { 'data-source-id': 'run-1' },
      comments: [{ commentId: 'comment-1', internal: true }],
    };

    const element = renderTextRun(run, context, makeRunRenderContext());

    expect(element).toBeInstanceOf(HTMLElement);
    expect(element?.textContent).toBe('');
    expect(element?.getAttribute('aria-hidden')).toBe('true');
    expect(element?.dataset.pmStart).toBe('10');
    expect(element?.dataset.pmEnd).toBe('16');
    expect(element?.dataset.layoutEpoch).toBe('42');
    expect(element?.dataset.sourceId).toBe('run-1');
    expect(element?.dataset.commentIds).toBe('comment-1');
    expect(element?.style.width).toBe('0px');
    expect(element?.style.overflow).toBe('hidden');
  });

  it('renders synthetic deleted paragraph-mark anchors as review glyphs when formatting marks are shown', () => {
    const run: TextRun = {
      text: '\u200B',
      fontFamily: 'Arial',
      fontSize: 16,
      vanish: true,
      dataAttrs: { 'data-paragraph-mark-deletion-anchor': 'true' },
      trackedChange: {
        id: 'tc-delete-mark',
        kind: 'delete',
        type: 'structural',
        subtype: 'paragraph-mark-deletion',
        targetKind: 'paragraph-mark',
        author: 'Ada',
      },
    };

    const element = renderTextRun(
      run,
      context,
      makeRunRenderContext({
        showFormattingMarks: true,
        applyTrackedChangeDecorations: (el) => {
          el.classList.add('track-delete-dec', 'highlighted');
        },
      }),
      { enabled: true, mode: 'review' },
    );

    expect(element?.textContent).toBe('¶');
    expect(element?.classList.contains('superdoc-formatting-paragraph-mark')).toBe(true);
    expect(element?.classList.contains('superdoc-tracked-paragraph-mark')).toBe(true);
    expect(element?.dataset.trackChangeId).toBe('tc-delete-mark');
    expect(element?.dataset.trackChangeMarker).toBe('paragraph');
    expect(element?.dataset.trackChangeSubtype).toBe('paragraph-mark-deletion');
    expect(element?.dataset.trackChangeTargetKind).toBe('paragraph-mark');
    expect(element?.style.display).toBe('inline');
    expect(element?.style.textDecorationLine).toBe('line-through');
    expect(element?.style.width).toBe('');
  });
});

describe('applyRunStyles', () => {
  it('opts painted text into browser font synthesis for reviewed synthetic fallback faces', () => {
    const element = document.createElement('span');
    const run: TextRun = {
      text: 'Bold text',
      fontFamily: 'Cooper Black',
      fontSize: 16,
      bold: true,
      italic: true,
    };

    applyRunStyles(element, run, false, () => 'Caprasimo');

    expect(element.style.fontFamily).toBe('Caprasimo');
    expect(element.style.fontWeight).toBe('bold');
    expect(element.style.fontStyle).toBe('italic');
    expect(element.style.fontKerning).toBe('none');
    expect(element.style.getPropertyValue('font-synthesis')).toBe('weight style');
  });

  it('paints OOXML character-width scaling as a horizontal glyph transform', () => {
    const element = document.createElement('span');
    const run: TextRun = {
      text: 'February 2025',
      fontFamily: 'Arial',
      fontSize: 16,
      horizontalScale: 0.9,
    };

    applyRunStyles(element, run, false, (family) => family);

    expect(element.style.display).toBe('inline-block');
    expect(element.style.transform).toBe('scaleX(0.9)');
    expect(element.style.transformOrigin).toBe('left center');
  });
});
