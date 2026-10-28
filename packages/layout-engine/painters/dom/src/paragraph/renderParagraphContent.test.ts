import { describe, expect, it } from 'vite-plus/test';
import { renderParagraphContent } from './renderParagraphContent.js';
import type { Line, ParagraphBlock, ParagraphMeasure, ResolvedParagraphContent } from '@superdoc/contracts';

describe('renderParagraphContent', () => {
  const line = (index: number): Line => ({
    fromRun: 0,
    fromChar: index,
    toRun: 0,
    toChar: index + 1,
    width: 10,
    ascent: 12,
    descent: 4,
    lineHeight: 20,
  });

  describe.each(['measured-table', 'resolved-body'] as const)('SD-5992 %s paragraph geometry', (path) => {
    it.each([false, true])('preserves wrapped and positioned text coordinates (continuation=%s)', (continuation) => {
      const doc = document.implementation.createHTMLDocument('hanging-list-content');
      const frameEl = doc.createElement('div');
      const marker = {
        markerText: '1.2',
        justification: 'left' as const,
        suffix: 'tab' as const,
        run: { fontFamily: 'Arial', fontSize: 16 },
      };
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'hanging-list-content',
        attrs: { indent: { left: 48, hanging: 96 }, wordLayout: { marker } },
        runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 16 }],
      };
      const lines = [line(0), line(1), line(2)];
      lines[0].segments = [{ runIndex: 0, fromChar: 0, toChar: 1, width: 10, x: 48 }];
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines,
        marker: { markerWidth: 96, markerTextWidth: 20, indentLeft: 48 },
        totalHeight: 60,
      };
      const firstLine = continuation ? 1 : 0;
      const resolvedContent: ResolvedParagraphContent | undefined =
        path === 'resolved-body'
          ? {
              continuesFromPrev: continuation,
              lines: lines.slice(firstLine).map((input, index) => ({
                line: input,
                lineIndex: firstLine + index,
                availableWidth: 152,
                skipJustify: true,
                paddingLeftPx: index === 0 && !continuation ? 0 : 48,
                paddingRightPx: 0,
                textIndentPx: 0,
                isListFirstLine: index === 0 && !continuation,
                hasExplicitSegmentPositioning: index === 0 && !continuation,
                resolvedListTextStartPx: index === 0 && !continuation ? 48 : undefined,
                indentOffset: 48,
              })),
              marker: {
                text: '1.2',
                justification: 'left',
                suffix: 'tab',
                markerStartPx: -48,
                firstLinePaddingLeftPx: -48,
                suffixWidthPx: 76,
                run: marker.run,
              },
            }
          : undefined;
      const positionedStarts: Array<number | undefined> = [];

      renderParagraphContent({
        doc,
        frameEl,
        block,
        measure,
        containerKind: path === 'measured-table' ? 'table-cell' : 'body-fragment',
        width: 200,
        localStartLine: firstLine,
        localEndLine: 3,
        wordLayout: { marker },
        continuesFromPrev: continuation,
        resolvedContent,
        applySdtDataset: () => {},
        renderLine: (input) => {
          positionedStarts.push(input.resolvedListTextStartPx);
          const lineEl = doc.createElement('div');
          lineEl.style.position = 'relative';
          if (input.lineIndex === 0) {
            const positionedRun = doc.createElement('span');
            positionedRun.style.position = 'absolute';
            positionedRun.style.left = `${input.line.segments?.[0].x}px`;
            lineEl.appendChild(positionedRun);
          }
          return lineEl;
        },
      });

      const painted = Array.from(frameEl.children) as HTMLElement[];
      expect(painted).toHaveLength(3 - firstLine);
      expect(painted.map((element) => element.style.left)).toEqual(Array(3 - firstLine).fill(''));
      expect(painted.map((element) => parseFloat(element.style.textIndent || '0'))).toEqual(
        Array(3 - firstLine).fill(0),
      );
      if (continuation) {
        expect(frameEl.querySelector('.superdoc-list-marker')).toBeNull();
        expect(painted.map((element) => element.style.paddingLeft)).toEqual(['48px', '48px']);
      } else {
        expect(painted.map((element) => element.style.paddingLeft)).toEqual(['0px', '48px', '48px']);
        expect(frameEl.querySelector<HTMLElement>('.superdoc-list-marker')?.style.marginLeft).toBe('-48px');
        expect(painted[0].querySelector<HTMLElement>('[style*="position: absolute"]')?.style.left).toBe('48px');
        expect(positionedStarts).toEqual([48, undefined, undefined]);
      }
    });
  });

  it('keeps partial body fragments at their rendered line height', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'split-paragraph',
      runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 16 }],
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [line(0), line(1), line(2)],
      totalHeight: 60,
    };

    const result = renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      lineIndexOffset: 0,
      linesOverride: measure.lines.slice(0, 1),
      continuesOnNext: true,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(result.renderedHeight).toBe(20);
    expect(result.totalHeight).toBe(20);
    expect(frameEl.style.height).toBe('20px');
  });

  it('leaves block SDT chrome at full fragment width for multiline paragraphs', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'multiline-block-sdt',
      runs: [{ text: 'first second', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        sdt: {
          type: 'structuredContent',
          scope: 'block',
          id: 'multiline-sdt',
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        { ...line(0), toChar: 5, width: 40 },
        { ...line(6), toChar: 12, width: 48 },
      ],
      totalHeight: 40,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 2,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(frameEl.classList.contains('superdoc-structured-content-block')).toBe(true);
    expect(frameEl.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('');
    expect(frameEl.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
  });

  it('stamps paragraph-mark tracked-change anchors on the paragraph frame and mark glyph', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'paragraph-mark-anchor',
      runs: [{ text: 'Beta', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        paragraphMarkTrackedChange: {
          id: 'tc-7',
          kind: 'insert',
          type: 'structural',
          subtype: 'paragraph-mark-insertion',
          targetKind: 'paragraph-mark',
          semanticColorKey: 'insertion',
          storyKey: 'body',
          author: 'Ada',
          groupedIds: ['tc-7'],
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ ...line(0), toChar: 4, width: 40 }],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => {
        const lineEl = doc.createElement('div');
        const markEl = doc.createElement('span');
        markEl.classList.add('superdoc-formatting-paragraph-mark');
        markEl.textContent = '¶';
        lineEl.appendChild(markEl);
        return lineEl;
      },
    });

    expect(frameEl.dataset.trackChangeId).toBe('tc-7');
    expect(frameEl.dataset.trackChangeIds).toBe('tc-7');
    expect(frameEl.dataset.trackChangeKind).toBe('insert');
    expect(frameEl.dataset.trackChangeAnchor).toBe('paragraph-mark');
    expect(frameEl.dataset.trackChangeStructural).toBe('paragraph-mark');
    expect(frameEl.dataset.trackChangeMarker).toBe('paragraph');
    expect(frameEl.dataset.trackChangeSubtype).toBe('paragraph-mark-insertion');
    expect(frameEl.dataset.trackChangeTargetKind).toBe('paragraph-mark');
    expect(frameEl.dataset.storyKey).toBe('body');
    expect(frameEl.classList.contains('track-insert-dec')).toBe(false);

    const markEl = frameEl.querySelector<HTMLElement>('.superdoc-formatting-paragraph-mark');
    expect(markEl).not.toBeNull();
    expect(markEl?.dataset.trackChangeId).toBe('tc-7');
    expect(markEl?.dataset.trackChangeIds).toBe('tc-7');
    expect(markEl?.dataset.trackChangeKind).toBe('insert');
    expect(markEl?.dataset.trackChangeAnchor).toBe('paragraph-mark');
    expect(markEl?.dataset.trackChangeStructural).toBe('paragraph-mark');
    expect(markEl?.dataset.trackChangeMarker).toBe('paragraph');
    expect(markEl?.dataset.trackChangeSubtype).toBe('paragraph-mark-insertion');
    expect(markEl?.dataset.trackChangeTargetKind).toBe('paragraph-mark');
    expect(markEl?.dataset.storyKey).toBe('body');
    expect(markEl?.classList.contains('superdoc-tracked-paragraph-mark')).toBe(true);
    expect(markEl?.classList.contains('track-insert-dec')).toBe(true);
    expect(markEl?.classList.contains('highlighted')).toBe(true);
    expect(markEl?.classList.contains('insertion')).toBe(true);
    expect(markEl?.style.display).toBe('inline');
    expect(markEl?.style.textDecorationLine).toBe('underline');
  });

  it('decorates paragraph-mark deletions on the mark glyph without striking paragraph text', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'paragraph-mark-delete-anchor',
      runs: [{ text: 'Merged text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        paragraphMarkTrackedChange: {
          id: 'tc-delete-mark',
          kind: 'delete',
          type: 'structural',
          subtype: 'paragraph-mark-deletion',
          targetKind: 'paragraph-mark',
          semanticColorKey: 'deletion',
          storyKey: 'body',
          author: 'Ada',
          groupedIds: ['tc-delete-mark'],
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ ...line(0), toChar: 11, width: 80 }],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => {
        const lineEl = doc.createElement('div');
        const textEl = doc.createElement('span');
        textEl.textContent = 'Merged text';
        const markEl = doc.createElement('span');
        markEl.classList.add('superdoc-formatting-paragraph-mark');
        markEl.textContent = '¶';
        lineEl.append(textEl, markEl);
        return lineEl;
      },
    });

    expect(frameEl.classList.contains('track-delete-dec')).toBe(false);
    expect(frameEl.style.textDecorationLine).toBe('');

    const markEl = frameEl.querySelector<HTMLElement>('.superdoc-formatting-paragraph-mark');
    expect(markEl).not.toBeNull();
    expect(markEl?.dataset.trackChangeId).toBe('tc-delete-mark');
    expect(markEl?.dataset.trackChangeKind).toBe('delete');
    expect(markEl?.dataset.trackChangeAnchor).toBe('paragraph-mark');
    expect(markEl?.dataset.trackChangeSubtype).toBe('paragraph-mark-deletion');
    expect(markEl?.dataset.trackChangeTargetKind).toBe('paragraph-mark');
    expect(markEl?.classList.contains('superdoc-tracked-paragraph-mark')).toBe(true);
    expect(markEl?.classList.contains('track-delete-dec')).toBe(true);
    expect(markEl?.classList.contains('highlighted')).toBe(true);
    expect(markEl?.classList.contains('deletion')).toBe(true);
    expect(markEl?.style.display).toBe('inline');
    expect(markEl?.style.textDecorationLine).toBe('line-through');
  });

  it('renders reviewable section-break tracked-change markers', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'section-break-anchor',
      runs: [],
      attrs: {
        sectPrMarker: true,
        paragraphMarkTrackedChange: {
          id: 'tc-section-12',
          kind: 'insert',
          type: 'structural',
          subtype: 'section-break-insertion',
          targetKind: 'section-break',
          semanticColorKey: 'insertion',
          semanticColor: '#1f6feb',
          storyKey: 'body',
          author: 'Test Reviewer',
          date: '2026-07-08T14:42:00Z',
          groupedIds: ['tc-section-12'],
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ ...line(0), toChar: 0, width: 0 }],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(frameEl.dataset.trackChangeId).toBe('tc-section-12');
    expect(frameEl.dataset.trackChangeAnchor).toBe('paragraph-mark');
    expect(frameEl.dataset.trackChangeSubtype).toBe('section-break-insertion');
    expect(frameEl.dataset.trackChangeTargetKind).toBe('section-break');

    const markerEl = frameEl.querySelector<HTMLElement>('.superdoc-section-break-review-marker');
    expect(markerEl).not.toBeNull();
    expect(markerEl?.textContent).toBe('Section Break');
    expect(markerEl?.dataset.trackChangeId).toBe('tc-section-12');
    expect(markerEl?.dataset.trackChangeIds).toBe('tc-section-12');
    expect(markerEl?.dataset.trackChangeKind).toBe('insert');
    expect(markerEl?.dataset.trackChangeAnchor).toBe('section-break');
    expect(markerEl?.dataset.trackChangeStructural).toBe('section-break');
    expect(markerEl?.dataset.trackChangeMarker).toBe('section-break');
    expect(markerEl?.dataset.trackChangeSubtype).toBe('section-break-insertion');
    expect(markerEl?.dataset.trackChangeTargetKind).toBe('section-break');
    expect(markerEl?.dataset.storyKey).toBe('body');
    expect(markerEl?.classList.contains('track-insert-dec')).toBe(true);
    expect(markerEl?.classList.contains('highlighted')).toBe(true);
    expect(markerEl?.classList.contains('insertion')).toBe(true);
  });

  it('stamps paragraph-property tracked-change anchors without paragraph-mark semantics', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'paragraph-property-anchor',
      runs: [{ text: 'Centered', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        alignment: 'center',
        paragraphPropertyTrackedChange: {
          id: 'tc-format-1',
          kind: 'format',
          type: 'formatting',
          subtype: 'paragraph-formatting',
          targetKind: 'paragraph',
          storyKey: 'body',
          author: 'Ada',
          color: '#6b7280',
          groupedIds: ['tc-format-1'],
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ ...line(0), toChar: 8, width: 70 }],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(frameEl.dataset.trackChangeId).toBe('tc-format-1');
    expect(frameEl.dataset.trackChangeIds).toBe('tc-format-1');
    expect(frameEl.dataset.trackChangeKind).toBe('format');
    expect(frameEl.dataset.trackChangeAnchor).toBe('paragraph-property');
    expect(frameEl.dataset.trackChangeMarkerVisible).toBe('true');
    expect(frameEl.dataset.trackChangeStructural).toBeUndefined();
    expect(frameEl.dataset.trackChangeMarker).toBeUndefined();
    expect(frameEl.dataset.trackChangeSubtype).toBe('paragraph-formatting');
    expect(frameEl.dataset.trackChangeTargetKind).toBe('paragraph');
    expect(frameEl.dataset.storyKey).toBe('body');
    expect(frameEl.classList.contains('track-insert-dec')).toBe(false);
    expect(frameEl.classList.contains('track-format-dec')).toBe(false);
    expect(frameEl.style.getPropertyValue('--sd-tracked-changes-format-border')).toBe('#6b7280');
    expect(frameEl.style.getPropertyValue('--sd-tracked-changes-paragraph-property-marker-left')).toBe('55px');

    const markerEl = frameEl.querySelector<HTMLElement>('.superdoc-paragraph-property-review-marker');
    expect(markerEl).not.toBeNull();
    expect(markerEl?.dataset.trackChangeId).toBe('tc-format-1');
    expect(markerEl?.dataset.trackChangeIds).toBe('tc-format-1');
    expect(markerEl?.dataset.trackChangeKind).toBe('format');
    expect(markerEl?.dataset.trackChangeAnchor).toBe('paragraph-property');
    expect(markerEl?.dataset.trackChangeStructural).toBeUndefined();
    expect(markerEl?.dataset.trackChangeMarker).toBeUndefined();
    expect(markerEl?.dataset.trackChangeSubtype).toBe('paragraph-formatting');
    expect(markerEl?.dataset.trackChangeTargetKind).toBe('paragraph');
    expect(markerEl?.dataset.storyKey).toBe('body');
    expect(markerEl?.classList.contains('track-format-dec')).toBe(true);
    expect(markerEl?.classList.contains('highlighted')).toBe(true);
    expect(markerEl?.style.getPropertyValue('--sd-tracked-changes-format-border')).toBe('#6b7280');
  });

  it('stamps paragraph-property anchors alongside paragraph-mark tracked changes', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'paragraph-property-and-mark-anchor',
      runs: [{ text: 'Inserted centered text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        alignment: 'center',
        paragraphMarkTrackedChange: {
          id: 'tc-insert-1',
          kind: 'insert',
          subtype: 'paragraph-mark',
          targetKind: 'paragraph-mark',
          storyKey: 'body',
          groupedIds: ['tc-insert-1'],
        },
        paragraphPropertyTrackedChange: {
          id: 'tc-format-1',
          kind: 'format',
          type: 'formatting',
          subtype: 'paragraph-formatting',
          targetKind: 'paragraph',
          storyKey: 'body',
          author: 'Ada',
          color: '#6b7280',
          groupedIds: ['tc-format-1'],
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ ...line(0), toChar: 22, width: 110 }],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(frameEl.dataset.trackChangeId).toBe('tc-format-1');
    expect(frameEl.dataset.trackChangeIds?.split(',')).toEqual(['tc-insert-1', 'tc-format-1']);
    expect(frameEl.dataset.trackChangeKind).toBe('format');
    expect(frameEl.dataset.trackChangeAnchor).toBe('paragraph-property');
    expect(frameEl.dataset.trackChangeStructural).toBeUndefined();
    expect(frameEl.dataset.trackChangeMarker).toBeUndefined();

    const markerEl = frameEl.querySelector<HTMLElement>('.superdoc-paragraph-property-review-marker');
    expect(markerEl).not.toBeNull();
    expect(markerEl?.dataset.trackChangeId).toBe('tc-format-1');
    expect(markerEl?.dataset.trackChangeAnchor).toBe('paragraph-property');
  });

  it('omits paragraph-property tracked-change markers outside review highlight mode', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'paragraph-property-final-mode',
      runs: [{ text: 'Centered', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        trackedChangesMode: 'final',
        paragraphPropertyTrackedChange: {
          id: 'tc-format-final',
          kind: 'format',
          type: 'formatting',
          subtype: 'paragraph-formatting',
          targetKind: 'paragraph',
          storyKey: 'body',
          author: 'Ada',
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ ...line(0), toChar: 8, width: 70 }],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(frameEl.dataset.trackChangeId).toBe('tc-format-final');
    expect(frameEl.dataset.trackChangeMarkerVisible).toBeUndefined();
    expect(frameEl.style.getPropertyValue('--sd-tracked-changes-paragraph-property-marker-left')).toBe('');
    expect(frameEl.querySelector('.superdoc-paragraph-property-review-marker')).toBeNull();
  });

  it('omits data-story-key on paragraph-mark anchors when the owning story is unknown (IT-1250)', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'paragraph-mark-anchor-no-story',
      runs: [{ text: 'Beta', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        paragraphMarkTrackedChange: {
          id: 'tc-8',
          kind: 'insert',
          groupedIds: ['tc-8'],
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ ...line(0), toChar: 4, width: 40 }],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(frameEl.dataset.trackChangeId).toBe('tc-8');
    // Fail closed: an unknown owning story must not masquerade as 'body', or a
    // header/footer carrier with missing story metadata could win body-scoped
    // carrier searches.
    expect(frameEl.dataset.storyKey).toBeUndefined();
  });

  it('includes nested inline SDT paint chrome in block SDT bounds', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'nested-inline-block-sdt',
      runs: [
        { text: 'Outer lead ', fontFamily: 'Arial', fontSize: 16 },
        {
          text: 'inner value',
          fontFamily: 'Arial',
          fontSize: 16,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'inline-sdt',
            alias: 'Inner Inline',
          },
        },
        { text: ' outer trail', fontFamily: 'Arial', fontSize: 16 },
      ],
      attrs: {
        sdt: {
          type: 'structuredContent',
          scope: 'block',
          id: 'block-sdt',
          alias: 'Outer Block',
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 12,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    expect(frameEl.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('0px');
    expect(frameEl.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('124px');
  });

  it('marks the final remeasured override line as the paragraph final line', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'remeasured-paragraph',
      runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 16 }],
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [line(0)],
      totalHeight: 20,
    };
    const renderedLines: Array<{ lineIndex: number; isLastLine: boolean; skipJustify?: boolean }> = [];

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 2,
      lineIndexOffset: 0,
      linesOverride: [line(0), line(1)],
      applySdtDataset: () => {},
      renderLine: ({ lineIndex, isLastLine, skipJustify }) => {
        renderedLines.push({ lineIndex, isLastLine, skipJustify });
        return doc.createElement('div');
      },
    });

    expect(renderedLines).toEqual([
      { lineIndex: 0, isLastLine: false, skipJustify: false },
      { lineIndex: 1, isLastLine: true, skipJustify: true },
    ]);
  });

  it('preserves paragraph right indent on list marker lines', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'list-paragraph',
      attrs: {
        indent: { left: 24, hanging: 12, right: 18 },
        wordLayout: {
          marker: {
            markerText: '1.',
            suffix: 'space',
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
      runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 16 }],
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [line(0)],
      marker: {
        markerWidth: 10,
        markerTextWidth: 8,
      },
      totalHeight: 20,
    };
    let lineEl: HTMLElement | undefined;

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure,
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      markerWidth: 10,
      markerTextWidth: 8,
      applySdtDataset: () => {},
      renderLine: () => {
        lineEl = doc.createElement('div');
        return lineEl;
      },
    });

    expect(lineEl?.style.cssText).toContain('padding-right: 18px');
  });

  it('renders resolved RTL list markers on the right side', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'resolved-list-paragraph',
      attrs: { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 16 }],
    };
    const resolvedContent: ResolvedParagraphContent = {
      lines: [
        {
          line: line(0),
          lineIndex: 0,
          availableWidth: 160,
          skipJustify: true,
          paddingLeftPx: 0,
          paddingRightPx: 0,
          textIndentPx: 0,
          isListFirstLine: true,
          hasExplicitSegmentPositioning: false,
          indentOffset: 30,
        },
      ],
      marker: {
        text: '1.',
        justification: 'right',
        suffix: 'space',
        markerStartPx: 6,
        suffixWidthPx: 4,
        firstLinePaddingLeftPx: 30,
        run: { fontFamily: 'Arial', fontSize: 16 },
      },
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure: { kind: 'paragraph', lines: [line(0)], totalHeight: 20 },
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      resolvedContent,
      applySdtDataset: () => {},
      renderLine: () => doc.createElement('div'),
    });

    const lineEl = frameEl.lastElementChild as HTMLElement;
    const markerEl = lineEl.querySelector<HTMLElement>('.superdoc-list-marker');
    expect(lineEl.style.paddingRight).toBe('30px');
    expect(markerEl?.style.right).toBe('6px');
  });

  it('passes the resolved list text start to paragraph marks when it lands before indentOffset', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'resolved-list-paragraph-mark',
      runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 16 }],
    };
    const lineInput = line(0);
    const resolvedContent: ResolvedParagraphContent = {
      lines: [
        {
          line: lineInput,
          lineIndex: 0,
          availableWidth: 158,
          skipJustify: true,
          paddingLeftPx: 0,
          paddingRightPx: 0,
          textIndentPx: 0,
          isListFirstLine: true,
          resolvedListTextStartPx: 42,
          hasExplicitSegmentPositioning: true,
          indentOffset: 90,
        },
      ],
      marker: {
        text: '•',
        justification: 'left',
        suffix: 'tab',
        markerStartPx: -10,
        suffixWidthPx: 46,
        firstLinePaddingLeftPx: -10,
        run: { fontFamily: 'Arial', fontSize: 16 },
      },
    };
    let paragraphMarkLeftOffsetOverride: number | undefined;

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure: { kind: 'paragraph', lines: [lineInput], totalHeight: 20 },
      containerKind: 'body-fragment',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      markerTextWidth: 6,
      resolvedContent,
      applySdtDataset: () => {},
      renderLine: (input) => {
        paragraphMarkLeftOffsetOverride = input.paragraphMarkLeftOffsetOverride;
        return doc.createElement('div');
      },
    });

    expect(paragraphMarkLeftOffsetOverride).toBe(42);
  });

  it('converts the final paragraph mark for resolved content', () => {
    const doc = document.implementation.createHTMLDocument('paragraph-content');
    const frameEl = doc.createElement('div');
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'resolved-cell-paragraph',
      runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 16 }],
    };
    const resolvedContent: ResolvedParagraphContent = {
      lines: [
        {
          line: line(0),
          lineIndex: 0,
          availableWidth: 160,
          skipJustify: true,
          paddingLeftPx: 0,
          paddingRightPx: 0,
          textIndentPx: 0,
          isListFirstLine: false,
          hasExplicitSegmentPositioning: false,
          indentOffset: 0,
        },
      ],
    };

    renderParagraphContent({
      doc,
      frameEl,
      block,
      measure: { kind: 'paragraph', lines: [line(0)], totalHeight: 20 },
      containerKind: 'table-cell',
      width: 200,
      localStartLine: 0,
      localEndLine: 1,
      resolvedContent,
      convertFinalParagraphMark: true,
      applySdtDataset: () => {},
      renderLine: () => {
        const lineEl = doc.createElement('div');
        const mark = doc.createElement('span');
        mark.classList.add('superdoc-formatting-paragraph-mark');
        mark.textContent = '¶';
        lineEl.appendChild(mark);
        return lineEl;
      },
    });

    const mark = frameEl.querySelector<HTMLElement>('.superdoc-formatting-paragraph-mark');
    expect(mark?.classList.contains('superdoc-formatting-cell-mark')).toBe(true);
    expect(mark?.textContent).toBe('¤');
  });
});
