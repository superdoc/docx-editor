import { describe, expect, it, beforeEach } from 'bun:test';
import { resolveSdtMetadata, clearSdtMetadataCache } from './index.js';

describe('resolveSdtMetadata', () => {
  beforeEach(() => {
    clearSdtMetadataCache();
  });

  it('normalizes field annotation metadata', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'fieldAnnotation',
      attrs: {
        type: 'text',
        fieldId: 'field-123',
        displayLabel: 'Customer',
        defaultDisplayLabel: 'Customer',
        alias: 'Customer Name',
        fieldColor: '#ff00ff',
        borderColor: 'None',
        highlighted: 'false',
        fontFamily: 'Calibri',
        fontSize: '12pt',
        textColor: '#333333',
        textHighlight: '#ffff00',
        linkUrl: 'https://example.com',
        imageSrc: null,
        rawHtml: { html: '<p>hello</p>' },
        size: { width: '120', height: 32 },
        extras: { foo: 'bar' },
        multipleImage: 'true',
        hash: 'abc123',
        generatorIndex: '2',
        sdtId: '456',
        hidden: 'false',
        visibility: 'Hidden',
        isLocked: 'true',
        bold: 'true',
        italic: false,
        underline: 'true',
      },
    });

    expect(metadata).toEqual({
      type: 'fieldAnnotation',
      fieldId: 'field-123',
      variant: 'text',
      fieldType: undefined,
      displayLabel: 'Customer',
      defaultDisplayLabel: 'Customer',
      alias: 'Customer Name',
      fieldColor: '#ff00ff',
      borderColor: undefined,
      highlighted: false,
      fontFamily: 'Calibri',
      fontSize: '12pt',
      textColor: '#333333',
      textHighlight: '#ffff00',
      linkUrl: 'https://example.com',
      imageSrc: null,
      rawHtml: { html: '<p>hello</p>' },
      size: { width: 120, height: 32 },
      extras: { foo: 'bar' },
      multipleImage: true,
      hash: 'abc123',
      generatorIndex: 2,
      sdtId: '456',
      hidden: false,
      visibility: 'hidden',
      isLocked: true,
      formatting: { bold: true, underline: true },
      marks: undefined,
    });
  });

  it('supports structured content blocks', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'structuredContentBlock',
      attrs: { id: '42', tag: 'block', alias: 'Block Alias', sdtPr: { foo: 'bar' } },
    });
    expect(metadata).toEqual({
      type: 'structuredContent',
      scope: 'block',
      id: '42',
      tag: 'block',
      alias: 'Block Alias',
      sdtPr: { foo: 'bar' },
    });
  });

  it('carries appearance through for inline structured content (SD-3110)', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'structuredContent',
      attrs: { id: '7', tag: 'citation', alias: 'Harvey citation', appearance: 'hidden' },
    });
    expect(metadata).toMatchObject({
      type: 'structuredContent',
      scope: 'inline',
      appearance: 'hidden',
    });
  });

  it('carries Word checkbox state and symbols through structured content metadata', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'structuredContent',
      attrs: {
        id: 'checkbox-1',
        checkbox: {
          checked: true,
          checkedSymbol: { font: 'Wingdings', char: 'F0FE' },
          uncheckedSymbol: { font: 'MS Gothic', char: '2610' },
          fontSize: 24,
        },
      },
    });
    expect(metadata).toMatchObject({
      type: 'structuredContent',
      checkbox: {
        checked: true,
        checkedSymbol: { font: 'Wingdings', char: 'F0FE' },
        uncheckedSymbol: { font: 'MS Gothic', char: '2610' },
        fontSize: 24,
      },
    });
  });

  it('drops unknown appearance values rather than letting them flow to the renderer', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'structuredContent',
      attrs: { id: '8', tag: 'x', appearance: 'malformed' },
    });
    expect(metadata).toMatchObject({ type: 'structuredContent', scope: 'inline' });
    expect((metadata as { appearance?: string }).appearance).toBeUndefined();
  });

  it('omits appearance when the source attr is missing', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'structuredContent',
      attrs: { id: '9', tag: 'x' },
    });
    expect((metadata as { appearance?: string }).appearance).toBeUndefined();
  });

  it('normalizes document section metadata', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'documentSection',
      attrs: { id: 's1', title: 'Section', description: 'Desc', sectionType: 'legal', isLocked: 'true' },
    });
    expect(metadata).toEqual({
      type: 'documentSection',
      id: 's1',
      title: 'Section',
      description: 'Desc',
      sectionType: 'legal',
      isLocked: true,
      sdBlockId: null,
    });
  });

  it('returns undefined for unsupported node types', () => {
    expect(resolveSdtMetadata({ nodeType: 'unknown', attrs: {} })).toBeUndefined();
  });

  it('uses cache when cache key is provided', () => {
    const attrs: Record<string, unknown> = {
      type: 'text',
      fieldId: 'cache-field',
      displayLabel: 'Cached label',
      hash: 'cache-hash',
    };
    const first = resolveSdtMetadata({ nodeType: 'fieldAnnotation', attrs });
    attrs.displayLabel = 'Mutated label';
    const second = resolveSdtMetadata({ nodeType: 'fieldAnnotation', attrs });
    expect(second).toBe(first);
    expect(second?.displayLabel).toBe('Cached label');
  });

  it('handles field annotation with minimal attrs (only fieldId)', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'fieldAnnotation',
      attrs: { fieldId: 'MINIMAL_FIELD' },
    });

    expect(metadata).toEqual({
      type: 'fieldAnnotation',
      fieldId: 'MINIMAL_FIELD',
      variant: undefined,
      fieldType: undefined,
      displayLabel: undefined,
      defaultDisplayLabel: undefined,
      alias: undefined,
      fieldColor: undefined,
      borderColor: undefined,
      highlighted: true,
      fontFamily: null,
      fontSize: null,
      textColor: null,
      textHighlight: null,
      linkUrl: null,
      imageSrc: null,
      rawHtml: undefined,
      size: null,
      extras: null,
      multipleImage: false,
      hash: null,
      generatorIndex: null,
      sdtId: null,
      hidden: false,
      visibility: undefined,
      isLocked: false,
      formatting: undefined,
      marks: undefined,
    });
  });

  it('handles field annotation with missing fieldId (defaults to empty string)', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'fieldAnnotation',
      attrs: {},
    });

    expect(metadata?.fieldId).toBe('');
    expect(metadata?.type).toBe('fieldAnnotation');
  });

  it('supports all field annotation variants', () => {
    const variants = ['text', 'image', 'signature', 'checkbox', 'html', 'link'] as const;

    variants.forEach((variant) => {
      const metadata = resolveSdtMetadata({
        nodeType: 'fieldAnnotation',
        attrs: { type: variant, fieldId: `field-${variant}` },
      });
      expect(metadata?.variant).toBe(variant);
    });
  });

  it('handles docPartObject metadata', () => {
    const metadata = resolveSdtMetadata({
      nodeType: 'docPartObject',
      attrs: {
        docPartGallery: 'Table of Contents',
        id: 'toc-unique-1',
        alias: 'TOC',
        instruction: 'TOC \\o "1-3"',
      },
    });
    expect(metadata).toEqual({
      type: 'docPartObject',
      gallery: 'Table of Contents',
      uniqueId: 'toc-unique-1',
      alias: 'TOC',
      instruction: 'TOC \\o "1-3"',
    });
  });
});
