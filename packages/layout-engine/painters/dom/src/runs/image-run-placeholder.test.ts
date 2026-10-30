import { describe, expect, it } from 'vite-plus/test';
import type { ImageRun } from '@superdoc/contracts';
import { renderImageRun } from './image-run.js';
import type { RunRenderContext } from './types.js';

const createContext = (doc: Document): RunRenderContext => ({
  doc,
  layoutEpoch: 7,
  showFormattingMarks: false,
  contentControlsChrome: 'default',
  pendingTooltips: new WeakMap(),
  getNextLinkId: () => 'link-1',
  applySdtDataset: () => undefined,
  buildImageHyperlinkAnchor: (child) => child,
  resolveTrackedChangesConfig: () => ({ mode: 'review', enabled: false }),
  applyTrackedChangeDecorations: () => undefined,
  resolveRunSdtId: () => null,
  createInlineSdtWrapper: () => doc.createElement('span'),
  syncInlineSdtWrapperTypography: () => undefined,
  expandSdtWrapperPmRange: () => undefined,
});

describe('renderImageRun fail-closed placeholder', () => {
  it('retains a canonical editable atom for a drawing slot without bitmap metadata', () => {
    const doc = document.implementation.createHTMLDocument('inline-drawing');
    const element = renderImageRun(
      {
        kind: 'image',
        src: '',
        inlineDrawingId: 'shape',
        width: 100,
        height: 30,
        verticalAlign: 'baseline',
        pmStart: 7,
        pmEnd: 8,
      },
      createContext(doc),
    )!;
    expect(element.getAttribute('data-v2-unpainted-inline-object')).toBe('true');
    expect(element.dataset.inlineDrawingId).toBe('shape');
    expect(element.dataset.pmStart).toBe('7');
    expect(element.dataset.pmEnd).toBe('8');
    expect(element.classList.contains('superdoc-inline-image')).toBe(false);
    expect(element.dataset.sdImageId).toBeUndefined();
    expect(element.textContent).toBe('');
  });
  it('preserves authored geometry and exposes the owning diagnostic', () => {
    const doc = document.implementation.createHTMLDocument('inline-image-placeholder');
    const run: ImageRun = {
      kind: 'image',
      src: '',
      width: 120,
      height: 48,
      imageId: '7',
      imageMutationId: 'img:7:word_document.xml:rId2',
      pmStart: 4,
      pmEnd: 5,
      placeholder: {
        diagnosticIds: ['render.media.unsupported-mime'],
        accessibleName: 'Legacy divider image',
      },
    };

    const element = renderImageRun(run, createContext(doc));

    expect(element).not.toBeNull();
    expect(element?.classList.contains('superdoc-placeholder-block')).toBe(true);
    expect(element?.dataset.placeholderDiagnosticIds).toBe('render.media.unsupported-mime');
    expect(element?.getAttribute('role')).toBe('img');
    expect(element?.getAttribute('aria-label')).toBe('Legacy divider image');
    expect(element?.style.width).toBe('120px');
    expect(element?.style.height).toBe('48px');
    expect(element?.dataset.pmStart).toBe('4');
    expect(element?.dataset.pmEnd).toBe('5');
    expect(element?.dataset.sdImageId).toBe('7');
    expect(element?.dataset.sdImageMutationId).toBe('img:7:word_document.xml:rId2');
  });
});

describe('renderImageRun picture outline', () => {
  it('paints the frame without adding a CSS border to the layout box', () => {
    const doc = document.implementation.createHTMLDocument('inline-image-outline');
    const run: ImageRun = {
      kind: 'image',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 120,
      height: 48,
      outline: { color: '#4472C4', width: 1 },
    };

    const element = renderImageRun(run, createContext(doc)) as HTMLImageElement;

    expect(element.style.outlineWidth).toBe('1px');
    expect(element.style.outlineStyle).toBe('solid');
    expect(element.style.outlineColor).toBe('#4472C4');
    expect(element.style.outlineOffset).toBe('-0.5px');
    expect(element.style.borderWidth).toBe('');
    expect(element.width).toBe(120);
    expect(element.height).toBe(48);
  });
});
