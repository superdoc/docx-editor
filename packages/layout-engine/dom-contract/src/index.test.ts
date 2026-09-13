import { describe, expect, it } from 'vite-plus/test';

import {
  DOM_CLASS_NAMES,
  STRUCTURED_CONTENT_CHROME_LABEL_CLASS_NAMES,
  DATA_ATTRS,
  DATASET_KEYS,
  buildImagePmSelector,
  buildInlineImagePmSelector,
  buildSdtBlockSelector,
  buildSdtInlineSelector,
  buildAnnotationSelector,
  buildAnnotationTypeSelector,
  buildAnnotationPmSelector,
  SDT_BLOCK_WITH_ID_SELECTOR,
  DRAGGABLE_SELECTOR,
  encodeLayoutStoryDataset,
  decodeLayoutStoryDataset,
} from './index.js';

describe('@superdoc/dom-contract', () => {
  it('exports the stable DOM class names used by the painter and DOM observers', () => {
    expect(DOM_CLASS_NAMES).toEqual({
      PAGE: 'superdoc-page',
      FRAGMENT: 'superdoc-fragment',
      FLOATING_FRAGMENT: 'superdoc-floating-fragment',
      LINE: 'superdoc-line',
      INLINE_SDT_WRAPPER: 'superdoc-structured-content-inline',
      INLINE_SDT_LABEL: 'superdoc-structured-content-inline__label',
      BLOCK_SDT: 'superdoc-structured-content-block',
      BLOCK_SDT_LABEL: 'superdoc-structured-content__label',
      TABLE_FRAGMENT: 'superdoc-table-fragment',
      DOCUMENT_SECTION: 'superdoc-document-section',
      SDT_GROUP_HOVER: 'sdt-group-hover',
      IMAGE_FRAGMENT: 'superdoc-image-fragment',
      INLINE_IMAGE: 'superdoc-inline-image',
      LIST_MARKER: 'superdoc-list-marker',
      TOC_ENTRY: 'superdoc-toc-entry',
      TOC_GROUP_HOVER: 'toc-group-hover',
      INLINE_IMAGE_CLIP_WRAPPER: 'superdoc-inline-image-clip-wrapper',
      ANNOTATION: 'annotation',
      ANNOTATION_CONTENT: 'annotation-content',
      ANNOTATION_CARET_ANCHOR: 'annotation-caret-anchor',
    });
  });

  it('exports the structured content chrome label class set', () => {
    expect(STRUCTURED_CONTENT_CHROME_LABEL_CLASS_NAMES).toEqual([
      DOM_CLASS_NAMES.INLINE_SDT_LABEL,
      DOM_CLASS_NAMES.BLOCK_SDT_LABEL,
    ]);
  });

  it('exports the stable data attribute names and dataset keys', () => {
    expect(DATA_ATTRS).toEqual({
      PM_START: 'data-pm-start',
      PM_END: 'data-pm-end',
      LAYOUT_EPOCH: 'data-layout-epoch',
      TABLE_BOUNDARIES: 'data-table-boundaries',
      SDT_ID: 'data-sdt-id',
      SDT_TYPE: 'data-sdt-type',
      FIELD_ID: 'data-field-id',
      FIELD_TYPE: 'data-field-type',
      DRAGGABLE: 'data-draggable',
      DISPLAY_LABEL: 'data-display-label',
      VARIANT: 'data-variant',
      TYPE: 'data-type',
      LAYOUT_BOUNDARY_SCHEMA: 'data-layout-boundary-schema',
      LAYOUT_FRAGMENT_ID: 'data-layout-fragment-id',
      LAYOUT_STORY: 'data-layout-story',
      LAYOUT_BLOCK_REF: 'data-layout-block-ref',
      LAYOUT_COLUMN_INDEX: 'data-layout-column-index',
    });

    expect(DATASET_KEYS).toEqual({
      PM_START: 'pmStart',
      PM_END: 'pmEnd',
      LAYOUT_EPOCH: 'layoutEpoch',
      TABLE_BOUNDARIES: 'tableBoundaries',
      SDT_ID: 'sdtId',
      SDT_TYPE: 'sdtType',
      FIELD_ID: 'fieldId',
      FIELD_TYPE: 'fieldType',
      DRAGGABLE: 'draggable',
      DISPLAY_LABEL: 'displayLabel',
      VARIANT: 'variant',
      TYPE: 'type',
      LAYOUT_BOUNDARY_SCHEMA: 'layoutBoundarySchema',
      LAYOUT_FRAGMENT_ID: 'layoutFragmentId',
      LAYOUT_STORY: 'layoutStory',
      LAYOUT_BLOCK_REF: 'layoutBlockRef',
      LAYOUT_COLUMN_INDEX: 'layoutColumnIndex',
    });
  });

  it('encodes and decodes the editor-neutral story locator dataset', () => {
    expect(encodeLayoutStoryDataset({ kind: 'body' })).toBe('body');
    expect(encodeLayoutStoryDataset({ kind: 'header', id: 'rId4' })).toBe('header:rId4');
    expect(encodeLayoutStoryDataset({ kind: 'footer' })).toBe('footer');
    expect(encodeLayoutStoryDataset({ kind: 'textbox', id: 'tb0' })).toBe('textbox:tb0');

    expect(decodeLayoutStoryDataset('body')).toEqual({ kind: 'body' });
    expect(decodeLayoutStoryDataset('header:rId4')).toEqual({ kind: 'header', id: 'rId4' });
    expect(decodeLayoutStoryDataset('footnote:1')).toEqual({ kind: 'footnote', id: '1' });
    expect(decodeLayoutStoryDataset('textbox:tb0')).toEqual({ kind: 'textbox', id: 'tb0' });
    expect(decodeLayoutStoryDataset(undefined)).toEqual({ kind: 'unknown' });
    expect(decodeLayoutStoryDataset('garbage:xyz')).toEqual({ kind: 'unknown' });
  });

  it('builds the full image selector for a rendered pm-start value', () => {
    expect(buildImagePmSelector(42)).toBe(
      '.superdoc-image-fragment[data-pm-start="42"], .superdoc-inline-image-clip-wrapper[data-pm-start="42"], .superdoc-inline-image[data-pm-start="42"]',
    );
  });

  it('builds the inline image selector in clip-wrapper-first order', () => {
    expect(buildInlineImagePmSelector('99')).toBe(
      '.superdoc-inline-image-clip-wrapper[data-pm-start="99"], .superdoc-inline-image[data-pm-start="99"]',
    );
  });

  it('builds a block SDT selector by escaped id', () => {
    expect(buildSdtBlockSelector('abc')).toBe('.superdoc-structured-content-block[data-sdt-id="abc"]');
  });

  it('builds an inline SDT selector by escaped id', () => {
    expect(buildSdtInlineSelector('abc')).toBe('.superdoc-structured-content-inline[data-sdt-id="abc"]');
  });

  it('builds the annotation selector with pm-start', () => {
    expect(buildAnnotationSelector()).toBe('.annotation[data-pm-start]');
  });

  it('builds an annotation type selector', () => {
    expect(buildAnnotationTypeSelector('html')).toBe('.annotation[data-type="html"]');
  });

  it('builds an annotation pm selector', () => {
    expect(buildAnnotationPmSelector(42)).toBe('.annotation[data-pm-start="42"]');
  });

  it('exports SDT_BLOCK_WITH_ID_SELECTOR constant', () => {
    expect(SDT_BLOCK_WITH_ID_SELECTOR).toBe('.superdoc-structured-content-block[data-sdt-id]');
  });

  it('exports DRAGGABLE_SELECTOR constant', () => {
    expect(DRAGGABLE_SELECTOR).toBe('[data-draggable="true"]');
  });
});
