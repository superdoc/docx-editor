import { describe, expect, it } from 'vite-plus/test';
import type { Layout, ParagraphBlock, ParagraphMeasure, SdtMetadata } from '@superdoc/contracts';
import { createTestPainter } from '../_test-utils.js';
import {
  applySdtContainerChrome,
  getSdtContainerKey,
  getSdtContainerKeyForBlock,
  getSdtSiblingBoundaries,
  shouldRenderSdtContainerChrome,
  shouldRebuildForSdtBoundary,
} from './container.js';

describe('SDT container chrome', () => {
  it('renders block structuredContent chrome', () => {
    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');
    const sdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      id: 'block-sdt',
      alias: 'Signer',
    };

    applySdtContainerChrome(doc, el, sdt);

    expect(el.classList.contains('superdoc-structured-content-block')).toBe(true);
    expect(el.dataset.sdtContainerStart).toBe('true');
    expect(el.dataset.sdtContainerEnd).toBe('true');
    expect(el.querySelector('.superdoc-structured-content__label')?.textContent).toBe('Signer');
  });

  it('renders a block Word checkbox as an interactive control without generic SDT chrome', () => {
    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');
    const sdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      id: 'checkbox-sdt',
      alias: 'Approved',
      checkbox: {
        checked: true,
        checkedSymbol: { font: 'MS Gothic', char: '2612' },
        uncheckedSymbol: { font: 'MS Gothic', char: '2610' },
      },
    };

    const boundary = { isStart: true, isEnd: false, showLabel: false };
    applySdtContainerChrome(doc, el, sdt, undefined, boundary);

    expect(el.classList.contains('superdoc-word-checkbox-container')).toBe(true);
    expect(el.classList.contains('superdoc-structured-content-block')).toBe(false);
    expect(el.getAttribute('role')).toBe('checkbox');
    expect(el.getAttribute('aria-checked')).toBe('true');
    expect(el.getAttribute('aria-label')).toBe('Approved');
    expect(el.dataset.lockMode).toBe('unlocked');
    expect(el.tabIndex).toBe(0);
    expect(el.querySelector('.superdoc-structured-content__label')).toBeNull();
    expect(el.dataset.sdtContainerStart).toBe('true');
    expect(el.dataset.sdtContainerEnd).toBe('false');
    expect(el.dataset.sdtContainerLabel).toBe('false');
    expect(shouldRebuildForSdtBoundary(el, boundary)).toBe(false);
  });

  it('exposes inter-fragment SDT chrome extension', () => {
    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');
    const sdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      id: 'block-sdt',
      alias: 'Signer',
    };

    applySdtContainerChrome(doc, el, sdt, null, { isStart: true, isEnd: false, paddingBottomOverride: 12 });

    expect(el.style.paddingBottom).toBe('12px');
    expect(el.style.getPropertyValue('--sd-sdt-chrome-bottom-extension')).toBe('12px');
  });

  it('does not render block chrome for inline structuredContent', () => {
    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');

    applySdtContainerChrome(doc, el, {
      type: 'structuredContent',
      scope: 'inline',
      id: 'inline-sdt',
      alias: 'Inline',
    });

    expect(el.classList.contains('superdoc-structured-content-block')).toBe(false);
    expect(el.dataset.sdtContainerStart).toBeUndefined();
  });

  it('renders documentSection chrome', () => {
    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');

    applySdtContainerChrome(doc, el, {
      type: 'documentSection',
      id: 'section-1',
      title: 'Locked Section',
    });

    expect(el.classList.contains('superdoc-document-section')).toBe(true);
    expect(el.querySelector('.superdoc-document-section__tooltip')?.textContent).toBe('Locked Section');
  });

  it('uses containerSdt as a fallback', () => {
    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');

    applySdtContainerChrome(doc, el, null, {
      type: 'structuredContent',
      scope: 'block',
      id: 'container-sdt',
      alias: 'Container',
      lockMode: 'contentLocked',
    });

    expect(el.classList.contains('superdoc-structured-content-block')).toBe(true);
    expect(el.querySelector('.superdoc-structured-content__label')?.textContent).toBe('Container');
    expect(el.dataset.lockMode).toBe('contentLocked');
  });

  it('uses the rendered container metadata for lock mode', () => {
    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');

    applySdtContainerChrome(
      doc,
      el,
      {
        type: 'structuredContent',
        scope: 'inline',
        id: 'inline-sdt',
        alias: 'Inline',
        lockMode: 'contentLocked',
      },
      {
        type: 'structuredContent',
        scope: 'block',
        id: 'container-sdt',
        alias: 'Container',
        lockMode: 'sdtLocked',
      },
    );

    expect(el.classList.contains('superdoc-structured-content-block')).toBe(true);
    expect(el.dataset.lockMode).toBe('sdtLocked');
  });

  it('suppresses same-key ancestor chrome', () => {
    const childSdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      id: 'shared-sdt',
      alias: 'Child',
    };
    const ancestorSdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      id: 'shared-sdt',
      alias: 'Ancestor',
    };

    expect(
      shouldRenderSdtContainerChrome(childSdt, null, {
        ancestorContainerKey: getSdtContainerKey(ancestorSdt),
      }),
    ).toBe(false);

    const doc = document.implementation.createHTMLDocument('sdt-container');
    const el = doc.createElement('div');
    applySdtContainerChrome(doc, el, childSdt, null, undefined, {
      ancestorContainerKey: getSdtContainerKey(ancestorSdt),
    });
    expect(el.classList.contains('superdoc-structured-content-block')).toBe(false);
  });

  it('does not suppress distinct primary chrome when fallback container metadata matches ancestor', () => {
    const ancestorSdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      alias: 'Ancestor',
    };
    const childSdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      alias: 'Child',
    };

    expect(
      shouldRenderSdtContainerChrome(childSdt, ancestorSdt, {
        ancestorContainerSdt: ancestorSdt,
      }),
    ).toBe(true);
  });

  it('suppresses pure id-less container metadata by reference', () => {
    const sharedSdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      alias: 'Shared',
    };

    expect(
      shouldRenderSdtContainerChrome(null, sharedSdt, {
        ancestorContainerSdt: sharedSdt,
      }),
    ).toBe(false);
  });

  it('computes stable sibling start and end boundaries', () => {
    expect(getSdtSiblingBoundaries(['a', 'a', 'b', null, 'b'])).toEqual([
      { isStart: true, isEnd: false },
      { isStart: false, isEnd: true },
      { isStart: true, isEnd: true },
      undefined,
      { isStart: true, isEnd: true },
    ]);
  });

  it('computes merged boundaries for shared id-less sibling metadata', () => {
    const sharedSdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      alias: 'Shared',
    };

    expect(getSdtSiblingBoundaries([getSdtContainerKey(sharedSdt), getSdtContainerKey(sharedSdt)])).toEqual([
      { isStart: true, isEnd: false },
      { isStart: false, isEnd: true },
    ]);
  });

  it('gets container keys for image and drawing blocks', () => {
    const sdt: SdtMetadata = {
      type: 'structuredContent',
      scope: 'block',
      id: 'media-sdt',
      alias: 'Media',
    };

    expect(getSdtContainerKeyForBlock({ kind: 'image', attrs: { sdt } })).toBe('structuredContent:media-sdt');
    expect(getSdtContainerKeyForBlock({ kind: 'drawing', attrs: { containerSdt: sdt } })).toBe(
      'structuredContent:media-sdt',
    );
  });
});

describe('SD-3055 block checkbox reconciliation', () => {
  const metadata: SdtMetadata = {
    type: 'structuredContent',
    scope: 'block',
    id: 'checkbox-sdt',
    alias: 'Approved',
    checkbox: {
      checked: false,
      checkedSymbol: { font: 'MS Gothic', char: '2612' },
      uncheckedSymbol: { font: 'MS Gothic', char: '2610' },
    },
  };

  const checkboxBlock = (checked = false): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'checkbox-block',
    runs: [{ text: checked ? '☒' : '☐', fontFamily: 'MS Gothic', fontSize: 16, pmStart: 0, pmEnd: 1 }],
    attrs: { sdt: { ...metadata, checkbox: { ...metadata.checkbox!, checked } } },
  });

  const paragraphMeasure = (length: number): ParagraphMeasure => ({
    kind: 'paragraph',
    lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: length, width: 100, ascent: 12, descent: 4, lineHeight: 20 }],
    totalHeight: 20,
  });

  const layout = (includeOrdinaryParagraph = false): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          { kind: 'para', blockId: 'checkbox-block', fromLine: 0, toLine: 1, x: 20, y: 20, width: 320 },
          ...(includeOrdinaryParagraph
            ? [{ kind: 'para' as const, blockId: 'ordinary-block', fromLine: 0, toLine: 1, x: 20, y: 40, width: 320 }]
            : []),
        ],
      },
    ],
  });

  it('retains the actual checkbox fragment when ordinary content appends on the same page', () => {
    const block = checkboxBlock();
    const ordinaryBlock: ParagraphBlock = {
      kind: 'paragraph',
      id: 'ordinary-block',
      runs: [{ text: 'After', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 6 }],
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    const painter = createTestPainter({ blocks: [block], measures: [paragraphMeasure(1)] });

    try {
      painter.paint(layout(), mount);
      const before = mount.querySelector('[data-block-id="checkbox-block"]');
      expect(before).not.toBeNull();
      expect(before?.getAttribute('aria-checked')).toBe('false');

      painter.setData([block, ordinaryBlock], [paragraphMeasure(1), paragraphMeasure(5)]);
      painter.paint(layout(true), mount);

      expect(mount.querySelector('[data-block-id="ordinary-block"]')?.textContent).toBe('After');
      expect(mount.querySelector('[data-block-id="checkbox-block"]')).toBe(before);
    } finally {
      painter.dispose();
      mount.remove();
    }
  });

  it('repaints a changed checkbox state rather than retaining its old glyph and accessibility state', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const painter = createTestPainter({ blocks: [checkboxBlock()], measures: [paragraphMeasure(1)] });

    try {
      painter.paint(layout(), mount);
      expect(mount.querySelector('[data-block-id="checkbox-block"]')?.textContent).toBe('☐');
      expect(mount.querySelector('[data-block-id="checkbox-block"]')?.getAttribute('aria-checked')).toBe('false');

      painter.setData([checkboxBlock(true)], [paragraphMeasure(1)]);
      painter.paint(layout(), mount);

      expect(mount.querySelector('[data-block-id="checkbox-block"]')?.textContent).toBe('☒');
      expect(mount.querySelector('[data-block-id="checkbox-block"]')?.getAttribute('aria-checked')).toBe('true');
    } finally {
      painter.dispose();
      mount.remove();
    }
  });

  it.each([
    ['start', { isStart: false, isEnd: true, showLabel: true }],
    ['end', { isStart: true, isEnd: false, showLabel: true }],
    ['label placement', { isStart: true, isEnd: true, showLabel: false }],
  ])('still requests a rebuild when the %s boundary changes', (_name, changedBoundary) => {
    const el = document.createElement('div');
    applySdtContainerChrome(document, el, metadata, null, { isStart: true, isEnd: true, showLabel: true });

    expect(shouldRebuildForSdtBoundary(el, changedBoundary)).toBe(true);
  });
});
