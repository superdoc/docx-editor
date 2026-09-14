import { describe, expect, it } from 'vite-plus/test';
import type { TextRun } from '@superdoc/contracts';
import type { FragmentRenderContext } from '../renderer.js';
import type { DerivedRunTextPlane } from '../derived-run-text-plane.js';
import type { RunRenderContext } from './types.js';
import { textRunMergeSignature } from './hash.js';
import { applyRunStyles, renderTextRun, resolveRunText, runStrikeDecoration } from './text-run.js';

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

  it('changes merge signature for each Word 97-2003 effect flag', () => {
    const baseRun: TextRun = { text: 'Styled', fontFamily: 'Arial', fontSize: 12 };

    // Neighbouring runs that differ only in one of these are not one span:
    // merging them would paint the first run's effect over the second's text.
    for (const mark of ['doubleStrike', 'outline', 'shadow', 'emboss', 'imprint'] as const) {
      expect(textRunMergeSignature({ ...baseRun, [mark]: true })).not.toBe(textRunMergeSignature(baseRun));
    }
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

  const effectRun = (marks: Partial<TextRun>): TextRun => ({
    text: 'Effect',
    fontFamily: 'Arial',
    fontSize: 16,
    ...marks,
  });

  /** The two shading colors of the emboss/imprint pair, as the painter writes them. */
  const EFFECT_LIGHT_CSS = 'rgba(255, 255, 255, 0.85)';
  const EFFECT_DARK_CSS = 'rgba(0, 0, 0, 0.45)';

  it('paints w:outline as a hollow glyph: a hairline stroke with the fill removed', () => {
    const element = document.createElement('span');

    applyRunStyles(element, effectRun({ outline: true, color: '#123456' }), false, (family) => family);

    expect(element.style.webkitTextStroke).toBe('0.67px currentColor');
    // The fill goes; the color stays, because the stroke reads currentColor from it.
    expect(element.style.webkitTextFillColor).toBe('transparent');
    expect(element.style.color).toBe('#123456');
  });

  /**
   * The default path, and the one that goes invisible if the fill is cleared
   * through `color`: Word's Font dialog writes the Outline effect with Automatic
   * color, and `normalizeRunAttrsFromOoxml` deliberately reports Automatic as no
   * color at all so paint can apply the document default. Clearing `color` here
   * would leave the glyph with no fill AND a transparent stroke — blank space
   * where there used to be readable text.
   */
  it('keeps an outlined run visible when it carries no explicit color', () => {
    const element = document.createElement('span');

    applyRunStyles(element, effectRun({ outline: true }), false, (family) => family);

    expect(element.style.color).toBe('');
    expect(element.style.webkitTextFillColor).toBe('transparent');
    expect(element.style.webkitTextStroke).toBe('0.67px currentColor');
  });

  it('paints w:shadow as a single offset copy behind the glyph', () => {
    const element = document.createElement('span');

    applyRunStyles(element, effectRun({ shadow: true }), false, (family) => family);

    expect(element.style.textShadow).toBe('1px 1px 0 rgba(0, 0, 0, 0.45)');
  });

  it('separates emboss from imprint by the side the light falls on', () => {
    const embossed = document.createElement('span');
    const imprinted = document.createElement('span');

    applyRunStyles(embossed, effectRun({ emboss: true }), false, (family) => family);
    applyRunStyles(imprinted, effectRun({ imprint: true }), false, (family) => family);

    expect(embossed.style.textShadow).toBe('-1px -1px 0 rgba(255, 255, 255, 0.85), 1px 1px 0 rgba(0, 0, 0, 0.45)');
    expect(imprinted.style.textShadow).toBe('1px 1px 0 rgba(255, 255, 255, 0.85), -1px -1px 0 rgba(0, 0, 0, 0.45)');
    expect(embossed.style.textShadow).not.toBe(imprinted.style.textShadow);
  });

  it('scales the effect offset and the outline stroke with the font size', () => {
    const heading = document.createElement('span');

    applyRunStyles(heading, effectRun({ fontSize: 48, outline: true, shadow: true }), false, (family) => family);

    expect(heading.style.webkitTextStroke).toBe('2px currentColor');
    expect(heading.style.textShadow).toBe('3px 3px 0 rgba(0, 0, 0, 0.45)');
  });

  it('stands aside for an authored w14 outline on the same run', () => {
    const element = document.createElement('span');
    const run = effectRun({
      outline: true,
      color: '#000000',
      textEffects: { outline: { width: 3, fill: '#ff0000' } },
    });

    applyRunStyles(element, run, false, (family) => family);

    expect(element.style.webkitTextStroke).toBe('3px #ff0000');
    // And the legacy pass leaves no transparent fill behind: `w14:textOutline`
    // strokes a **filled** glyph, so a leftover empty fill would turn an
    // authored outline into a hollow one.
    expect(element.style.webkitTextFillColor).toBeFalsy();
  });

  it('stands aside for an authored w14 fill, which would otherwise paint into an empty glyph', () => {
    const element = document.createElement('span');
    const run = effectRun({ outline: true, textEffects: { fill: '#00ff00' } });

    applyRunStyles(element, run, false, (family) => family);

    expect(element.style.color).toBe('#00ff00');
    expect(element.style.webkitTextFillColor).toBeFalsy();
  });

  /**
   * Glow is not a shadow generation ahead of emboss — they are two different
   * effects, and both are just `text-shadow` layers. Assigning rather than
   * appending would let a glow silently erase the emboss on the same run.
   */
  /**
   * `<w14:textOutline w14:w="0"><w14:noFill/></w14:textOutline>` is what Word
   * writes for "no outline": the object is present and `applyTextEffects` paints
   * nothing from it. Standing aside for its mere existence would leave the run
   * with neither an authored stroke nor the legacy one — blank space, which is
   * the failure this whole change exists to remove.
   */
  it('does not stand aside for a w14 outline that paints nothing', () => {
    const element = document.createElement('span');
    const run = effectRun({ outline: true, textEffects: { outline: { width: 0, fill: null } } });

    applyRunStyles(element, run, false, (family) => family);

    expect(element.style.webkitTextStroke).toBe('0.67px currentColor');
    expect(element.style.webkitTextFillColor).toBe('transparent');
  });

  it('stands aside for an authored w14 shadow rather than drawing a second one', () => {
    const element = document.createElement('span');
    const run = effectRun({
      shadow: true,
      textEffects: { shadow: { color: { color: '#0000ff' }, direction: 45, distance: 3, blurRadius: 2 } },
    });

    applyRunStyles(element, run, false, (family) => family);

    expect(element.style.textShadow).toContain('#0000ff');
    // One shadow, not two: the legacy flag and `w14:shadow` are the same effect.
    expect(element.style.textShadow).not.toContain(EFFECT_DARK_CSS);
  });

  it('composes a legacy emboss with an authored w14 glow instead of losing one', () => {
    const element = document.createElement('span');
    const run = effectRun({ emboss: true, textEffects: { glow: { color: { color: '#ff0000' }, radius: 4 } } });

    applyRunStyles(element, run, false, (family) => family);

    const shadow = element.style.textShadow;
    expect(shadow).toContain('#ff0000');
    expect(shadow).toContain(EFFECT_LIGHT_CSS);
    expect(shadow).toContain(EFFECT_DARK_CSS);
  });

  it('draws w:dstrike as two lines rather than one', () => {
    const element = document.createElement('span');

    applyRunStyles(element, effectRun({ strike: true, doubleStrike: true }), false, (family) => family);

    expect(element.style.textDecorationLine).toBe('line-through');
    expect(element.style.textDecorationStyle).toBe('double');
  });

  /**
   * `doubleStrike` is its own `RunMarks` field and its own settable run
   * attribute, so a run carrying only it still has a strikethrough to draw.
   * Reading the line off `strike` alone would render such a run undecorated.
   */
  it('draws a run that carries only doubleStrike', () => {
    const element = document.createElement('span');

    applyRunStyles(element, effectRun({ doubleStrike: true }), false, (family) => family);

    expect(element.style.textDecorationLine).toBe('line-through');
    expect(element.style.textDecorationStyle).toBe('double');
  });

  it('keeps the authored underline style when a run is both underlined and double-struck', () => {
    const element = document.createElement('span');
    const run = effectRun({ strike: true, doubleStrike: true, underline: { style: 'wavy' } });

    applyRunStyles(element, run, false, (family) => family);

    expect(element.style.textDecorationLine).toBe('underline line-through');
    expect(element.style.textDecorationStyle).toBe('wavy');
  });

  /**
   * `render-line.ts` re-derives the strike after painting on the paths that lift
   * an underline onto a line overlay. It read the line off `strike` alone, so a
   * run carrying only `w:dstrike` came out undecorated there while an ordinary
   * line drew it — the shared helper is what keeps the two in step.
   */
  it('reports the strike for a doubleStrike-only run through the shared helper', () => {
    expect(runStrikeDecoration(effectRun({ doubleStrike: true }))).toEqual({
      line: 'line-through',
      style: 'double',
    });
    expect(runStrikeDecoration(effectRun({ strike: true }))).toEqual({ line: 'line-through' });
    expect(runStrikeDecoration(effectRun({}))).toEqual({ line: 'none' });
  });

  it('leaves the strike single for the helper when the element keeps its underline', () => {
    // One `text-decoration-style` for the whole set: the underline's authored
    // style wins, and the overlay paths get `double` because the underline has
    // already been lifted off the run.
    expect(runStrikeDecoration(effectRun({ strike: true, doubleStrike: true, underline: { style: 'wavy' } }))).toEqual({
      line: 'line-through',
    });
  });

  it('paints nothing extra for a run that carries no effect flag', () => {
    const element = document.createElement('span');

    applyRunStyles(element, effectRun({ strike: true }), false, (family) => family);

    expect(element.style.webkitTextStroke).toBeFalsy();
    expect(element.style.webkitTextFillColor).toBeFalsy();
    expect(element.style.textShadow).toBeFalsy();
    expect(element.style.textDecorationStyle).toBeFalsy();
    expect(element.style.color).toBe('');
  });
});
