import { describe, expect, it } from 'vite-plus/test';
import { createFontResolver, resolvePhysicalFamily } from '@superdoc/font-system';
import { createListMarkerElement, renderLegacyListMarker, renderResolvedListMarker } from './list-marker.js';
import type { ResolvedListMarkerItem } from '@superdoc/contracts';
import type { MarkerTrackedChangeView } from './marker-tracked-change.js';

it('SD-5992 defaults an omitted measured marker justification to inline left', () => {
  const doc = document.implementation.createHTMLDocument('default-list-anchor');
  const lineEl = doc.createElement('div');
  renderLegacyListMarker({
    doc,
    lineEl,
    markerLayout: { markerText: '1.2', suffix: 'nothing' },
    markerMeasure: { markerWidth: 20, markerTextWidth: 20 },
    indentLeftPx: 48,
    hangingIndentPx: 96,
    firstLineIndentPx: 0,
  });
  expect(lineEl.style.paddingLeft).toBe('0px');
  expect(lineEl.querySelector<HTMLElement>('.superdoc-list-marker')?.style.marginLeft).toBe('-48px');
});

describe.each(['measured', 'resolved'] as const)('SD-5992 %s list marker anchors', (renderer) => {
  const paint = ({
    anchor = -48,
    isRtl = false,
    justification = 'left',
    suffix = 'tab',
    vanish = false,
    firstLineIndentMode = false,
  }: {
    anchor?: number;
    isRtl?: boolean;
    justification?: 'left' | 'right' | 'center';
    suffix?: 'tab' | 'space' | 'nothing';
    vanish?: boolean;
    firstLineIndentMode?: boolean;
  } = {}) => {
    const doc = document.implementation.createHTMLDocument('signed-list-anchor');
    const lineEl = doc.createElement('div');
    lineEl.textContent = 'Beta';
    const run = { fontFamily: 'Arial', fontSize: 16, bold: true, color: '#123456', vanish };
    if (renderer === 'measured') {
      const markerLayout = { markerText: '1.2', justification, suffix, run };
      renderLegacyListMarker({
        doc,
        lineEl,
        markerLayout,
        markerMeasure: { markerWidth: 96, markerTextWidth: 20 },
        wordLayout: { marker: markerLayout, firstLineIndentMode },
        indentLeftPx: anchor + 96,
        hangingIndentPx: 96,
        firstLineIndentPx: 0,
        isRtl,
      });
    } else {
      const marker: ResolvedListMarkerItem = {
        text: '1.2',
        justification,
        suffix,
        firstLinePaddingLeftPx: anchor,
        markerStartPx: anchor - (justification === 'right' ? 20 : justification === 'center' ? 10 : 0),
        centerPaddingAdjustPx: justification === 'center' ? 10 : undefined,
        suffixWidthPx: suffix === 'tab' ? 76 : suffix === 'space' ? 4 : 0,
        run,
        vanish,
      };
      renderResolvedListMarker({ doc, lineEl, marker, isRtl });
    }
    return { lineEl, markerEl: lineEl.querySelector<HTMLElement>('.superdoc-list-marker') };
  };

  it.each([false, true])('moves a negative inline anchor through its leading margin (RTL=%s)', (isRtl) => {
    const { lineEl, markerEl } = paint({ isRtl });
    expect(lineEl.style[isRtl ? 'paddingRight' : 'paddingLeft']).toBe('0px');
    expect(lineEl.style[isRtl ? 'paddingLeft' : 'paddingRight']).toBe('');
    expect(markerEl?.style[isRtl ? 'marginRight' : 'marginLeft']).toBe('-48px');
    expect(markerEl?.style[isRtl ? 'marginLeft' : 'marginRight']).toBe('');
    expect(markerEl?.style.position).toBe('relative');
    expect(markerEl?.style.left).toBe('');
    expect(markerEl?.textContent).toBe('1.2');
    expect(markerEl?.firstElementChild?.getAttribute('style')).toContain('font-weight: bold');
    expect(lineEl.querySelector<HTMLElement>('.superdoc-marker-suffix-tab')?.style.width).toBe('76px');
    expect(lineEl.lastChild?.textContent).toBe('Beta');
  });

  it.each([0, 24])('preserves a nonnegative anchor of %spx', (anchor) => {
    const { lineEl, markerEl } = paint({ anchor });
    expect(lineEl.style.paddingLeft).toBe(`${anchor}px`);
    expect(markerEl?.style.marginLeft).toBe('');
    expect(markerEl?.style.marginRight).toBe('');
  });

  it.each(['space', 'nothing'] as const)('preserves the %s suffix at a negative anchor', (suffix) => {
    const { lineEl, markerEl } = paint({ suffix });
    expect(markerEl?.style.marginLeft).toBe('-48px');
    expect(lineEl.querySelector('.superdoc-marker-suffix-tab')).toBeNull();
    expect(lineEl.querySelector('.superdoc-marker-suffix-space')?.textContent ?? '').toBe(
      suffix === 'space' ? '\u00a0' : '',
    );
    expect(lineEl.children.length).toBe(suffix === 'space' ? 2 : 1);
  });

  describe.each(['right', 'center'] as const)('%s absolute markers', (justification) => {
    for (const isRtl of [false, true]) {
      it.each(['tab', 'space', 'nothing'] as const)(
        `moves the negative anchor with the %s suffix (RTL=${isRtl})`,
        (suffix) => {
          const { lineEl, markerEl } = paint({ justification, isRtl, suffix });
          const suffixEl = lineEl.querySelector<HTMLElement>(`.superdoc-marker-suffix-${suffix}`);
          expect(markerEl?.style.position).toBe('absolute');
          expect(markerEl?.style[isRtl ? 'right' : 'left']).toBe('-68px');
          expect(markerEl?.style.marginLeft).toBe('');
          expect(markerEl?.style.marginRight).toBe('');
          expect(lineEl.style[isRtl ? 'paddingRight' : 'paddingLeft']).toBe(
            justification === 'center' ? '10px' : '0px',
          );
          expect(suffixEl?.style[isRtl ? 'marginRight' : 'marginLeft']).toBe('-48px');
          expect(suffixEl?.style[isRtl ? 'marginLeft' : 'marginRight']).toBe('');
          expect(lineEl.lastChild?.textContent).toBe('Beta');
          if (suffix === 'nothing') {
            expect(suffixEl?.textContent).toBe('');
            expect(suffixEl?.style.width).toBe('0px');
          }
        },
      );
    }

    it.each([0, 24])('preserves a nonnegative anchor of %spx', (anchor) => {
      const { lineEl, markerEl } = paint({ anchor, justification });
      expect(lineEl.style.paddingLeft).toBe(`${anchor + (justification === 'center' ? 10 : 0)}px`);
      expect(markerEl?.style.marginLeft).toBe('');
      expect(lineEl.querySelector<HTMLElement>('.superdoc-marker-suffix-tab')?.style.marginLeft).toBe('');
    });
  });

  it('preserves hidden marker behavior', () => {
    const { lineEl, markerEl } = paint({ vanish: true });
    expect(markerEl).toBeNull();
    expect(lineEl.children.length).toBe(0);
    expect(lineEl.style.paddingLeft).toBe('0px');
    expect(lineEl.textContent).toBe('Beta');
  });

  it('uses the same inline anchor in first-line indent mode', () => {
    const { lineEl, markerEl } = paint({ firstLineIndentMode: true });
    expect(lineEl.style.paddingLeft).toBe('0px');
    expect(markerEl?.style.marginLeft).toBe('-48px');
  });
});

describe('createListMarkerElement per-document paint isolation', () => {
  const makeDoc = (): Document => document.implementation.createHTMLDocument('list-marker');
  const markerFontFamily = (container: HTMLElement): string =>
    (container.querySelector('.superdoc-paragraph-marker') as HTMLElement).style.fontFamily;

  it('paints the marker through the document resolver, so two documents with different Calibri maps do not share paint', () => {
    const run = { fontFamily: 'Calibri', fontSize: 16 };

    // Same BUILT-IN logical family, DIFFERENT per-document physical mappings -> non-empty, DISTINCT
    // signatures. (Plain Calibri with an empty signature would only exercise the bundled default and
    // would not prove isolation - the whole point of keying paint by the document resolver.)
    const docA = createFontResolver();
    docA.map('Calibri', 'Liberation Sans');
    const docB = createFontResolver();
    docB.map('Calibri', 'Tinos');
    expect(docA.signature).not.toBe('');
    expect(docA.signature).not.toBe(docB.signature);

    const markerA = createListMarkerElement(makeDoc(), '1.', run, undefined, (f) => docA.resolvePhysicalFamily(f));
    const markerB = createListMarkerElement(makeDoc(), '1.', run, undefined, (f) => docB.resolvePhysicalFamily(f));

    // The marker glyph paints each document's mapped physical family, so the two documents differ.
    expect(markerFontFamily(markerA)).toContain('Liberation Sans');
    expect(markerFontFamily(markerB)).toContain('Tinos');
    expect(markerFontFamily(markerA)).not.toBe(markerFontFamily(markerB));
  });

  it('paints the bundled substitute (Calibri -> Carlito) when the document has no override', () => {
    // No per-document override (empty signature): the marker still paints the bundled physical clone,
    // matching the text and the measured advance - the visible consistency fix for built-in families.
    const run = { fontFamily: 'Calibri', fontSize: 16 };
    const marker = createListMarkerElement(makeDoc(), '1.', run, undefined, resolvePhysicalFamily);
    expect(markerFontFamily(marker)).toContain('Carlito');
  });

  it('paints an inherited marker with the same concrete fallback used for measurement', () => {
    const marker = createListMarkerElement(
      makeDoc(),
      '1.',
      { fontFamily: 'inherit', fontSize: 16 },
      undefined,
      (family) => family,
    );

    expect(markerFontFamily(marker)).toBe('Arial, sans-serif');
  });
});

describe('createListMarkerElement tracked-change marker review (Plan 5)', () => {
  const makeDoc = (): Document => document.implementation.createHTMLDocument('list-marker-tc');
  const run = { fontFamily: 'Calibri', fontSize: 16 };
  const glyph = (container: HTMLElement): HTMLElement =>
    container.querySelector('.superdoc-paragraph-marker') as HTMLElement;

  it('leaves normal markers free of review metadata, classes, and styling when no tracked change is present', () => {
    const markerEl = glyph(createListMarkerElement(makeDoc(), '1.', run, undefined, resolvePhysicalFamily));
    expect(markerEl.dataset.trackChangeId).toBeUndefined();
    expect(markerEl.dataset.trackChangeKind).toBeUndefined();
    expect(markerEl.classList.contains('track-insert-dec')).toBe(false);
    expect(markerEl.classList.contains('track-list-marker-dec')).toBe(false);
    // Critical: no review color/underline leaks onto the normal marker glyph.
    expect(markerEl.style.color).toBe('');
    expect(markerEl.style.textDecorationLine).toBe('');
  });

  it('stamps insert review metadata and underline on the marker glyph without forcing review color', () => {
    const tc: MarkerTrackedChangeView = {
      id: 'tc-1',
      kind: 'insert',
      type: 'paragraph-mark',
      targetKind: 'list-item',
      semanticColor: '#00853d',
      author: 'Ada',
      authorEmail: 'ada@example.com',
      date: '2026-06-26T00:00:00Z',
    };
    const markerEl = glyph(createListMarkerElement(makeDoc(), '1.', run, undefined, resolvePhysicalFamily, tc));
    expect(markerEl.dataset.trackChangeId).toBe('tc-1');
    expect(markerEl.dataset.trackChangeIds).toBe('tc-1');
    expect(markerEl.dataset.trackChangeKind).toBe('insert');
    expect(markerEl.dataset.trackChangeType).toBe('paragraph-mark');
    expect(markerEl.dataset.trackChangeTargetKind).toBe('list-item');
    expect(markerEl.dataset.trackChangeAuthor).toBe('Ada');
    expect(markerEl.dataset.trackChangeMarker).toBe('list');
    expect(markerEl.classList.contains('track-insert-dec')).toBe(true);
    expect(markerEl.classList.contains('track-list-marker-dec')).toBe(true);
    // Word-like marker glyph styling: paragraph foreground + review underline.
    expect(markerEl.style.color).toBe('');
    expect(markerEl.style.textDecorationLine).toBe('underline');
    expect(markerEl.style.textDecorationColor).toBe('currentColor');
    // Shared element-scoped CSS variable family (consistent with run path).
    expect(markerEl.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('#00853d');
  });

  it('uses delete styling (strikethrough) for removed list-item markers', () => {
    const tc: MarkerTrackedChangeView = { id: 'tc-2', kind: 'delete', color: '#cb0e47' };
    const markerEl = glyph(createListMarkerElement(makeDoc(), '2.', run, undefined, resolvePhysicalFamily, tc));
    expect(markerEl.dataset.trackChangeKind).toBe('delete');
    expect(markerEl.classList.contains('track-delete-dec')).toBe(true);
    expect(markerEl.style.color).toBe('');
    expect(markerEl.style.textDecorationLine).toBe('line-through');
    expect(markerEl.style.textDecorationColor).toBe('currentColor');
  });

  it('emits grouped data-track-change-ids when several changes affect one marker', () => {
    const tc: MarkerTrackedChangeView = { id: 'tc-a', kind: 'format', groupedIds: ['tc-a', 'tc-b'], color: '#806000' };
    const markerEl = glyph(createListMarkerElement(makeDoc(), 'a.', run, undefined, resolvePhysicalFamily, tc));
    expect(markerEl.dataset.trackChangeId).toBe('tc-a');
    expect(markerEl.dataset.trackChangeIds).toBe('tc-a,tc-b');
    expect(markerEl.classList.contains('track-format-dec')).toBe(true);
    expect(markerEl.style.textDecorationLine).toBe('underline');
  });

  it('keeps visible final-mode insertion markers review-targetable without forcing review glyph styling', () => {
    const tc: MarkerTrackedChangeView = { id: 'tc-final', kind: 'insert', color: '#00853d' };
    const markerEl = glyph(
      createListMarkerElement(makeDoc(), '3.', run, undefined, resolvePhysicalFamily, tc, {
        mode: 'final',
        enabled: true,
      }),
    );
    expect(markerEl.dataset.trackChangeId).toBe('tc-final');
    expect(markerEl.classList.contains('track-insert-dec')).toBe(true);
    expect(markerEl.classList.contains('normal')).toBe(true);
    expect(markerEl.classList.contains('highlighted')).toBe(false);
    expect(markerEl.style.color).toBe('');
    expect(markerEl.style.textDecorationLine).toBe('');
  });

  it('does not stamp marker review metadata when tracked changes are off', () => {
    const tc: MarkerTrackedChangeView = { id: 'tc-off', kind: 'insert', color: '#00853d' };
    const markerEl = glyph(
      createListMarkerElement(makeDoc(), '4.', run, undefined, resolvePhysicalFamily, tc, {
        mode: 'off',
        enabled: true,
      }),
    );
    expect(markerEl.dataset.trackChangeId).toBeUndefined();
    expect(markerEl.classList.contains('track-insert-dec')).toBe(false);
    expect(markerEl.style.color).toBe('');
    expect(markerEl.style.textDecorationLine).toBe('');
  });
});
