import { describe, expect, it } from 'vite-plus/test';
import type { SdtMetadata } from './index.js';
import {
  getSdtContainerKey,
  getSdtContainerKeyForBlock,
  getSdtContainerMetadata,
  hasExplicitSdtContainerKey,
} from './sdt-container.js';

describe('SDT container key helpers', () => {
  it('uses the first renderable container metadata', () => {
    const containerSdt: SdtMetadata = { type: 'documentSection', id: 'section-1' };

    expect(getSdtContainerMetadata({ type: 'structuredContent', scope: 'inline', id: 'inline-1' }, containerSdt)).toBe(
      containerSdt,
    );
  });

  it('derives explicit keys for block content controls and document sections', () => {
    expect(getSdtContainerKey({ type: 'structuredContent', scope: 'block', id: 'sdt-1' })).toBe(
      'structuredContent:sdt-1',
    );
    expect(getSdtContainerKey({ type: 'documentSection', sdBlockId: 'section-block-1' })).toBe(
      'documentSection:section-block-1',
    );
  });

  it('derives stable object keys for id-less containers', () => {
    const sharedSdt: SdtMetadata = { type: 'structuredContent', scope: 'block', alias: 'Shared' };
    const firstKey = getSdtContainerKey(sharedSdt);

    expect(firstKey).toMatch(/^idlessSdt:/);
    expect(getSdtContainerKey(sharedSdt)).toBe(firstKey);
    expect(hasExplicitSdtContainerKey(sharedSdt)).toBe(false);
  });

  it('keeps separate id-less containers apart when they share display text', () => {
    const first: SdtMetadata = { type: 'structuredContent', scope: 'block', alias: 'Shared', tag: 'Shared' };
    const second: SdtMetadata = { type: 'structuredContent', scope: 'block', alias: 'Shared', tag: 'Shared' };

    expect(getSdtContainerKey(first)).not.toBe(getSdtContainerKey(second));
  });

  it('derives keys from any block-like object with SDT attrs', () => {
    const sdt: SdtMetadata = { type: 'structuredContent', scope: 'block', id: 'media-sdt' };

    expect(getSdtContainerKeyForBlock({ attrs: { sdt } })).toBe('structuredContent:media-sdt');
  });
});
