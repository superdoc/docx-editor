import { describe, expect, it } from 'vite-plus/test';
import type { WatermarkInfo } from '@superdoc/document-api';
import {
  createWatermarkDraft,
  patchWatermarkDraft,
  toWatermarkInput,
  getWatermarkDraftError,
} from './watermark-draft.js';

const picture: WatermarkInfo = {
  watermarkId: 'picture-1',
  owner: { refId: 'rId1', partPath: '/word/header1.xml' },
  effectiveIn: [],
  watermark: {
    kind: 'picture',
    mediaPartPath: 'word/media/image1.png',
    contentType: 'image/png',
    scalePercent: 'auto',
    widthPt: 195.5,
    heightPt: 216.75,
    lockAspectRatio: true,
    washout: false,
    opacity: 1,
    placement: { widthPt: 195.5, heightPt: 216.75, rotationDegrees: 25 },
  },
};

describe('watermark drafts', () => {
  it('preserves fractional imported opacity when another setting changes', () => {
    const draft = createWatermarkDraft({ ...picture, watermark: { ...picture.watermark, opacity: 0.333 } });
    expect(toWatermarkInput(patchWatermarkDraft(draft, { washout: true })).opacity).toBeCloseTo(0.333, 12);
  });
  it('retains an embedded picture and its imported dimensions during a transparency edit', () => {
    const draft = patchWatermarkDraft(createWatermarkDraft(picture), { transparency: 60 });
    expect(toWatermarkInput(draft)).toMatchObject({
      kind: 'picture',
      source: { kind: 'existing', watermarkId: 'picture-1' },
      opacity: 0.4,
      widthPt: 195.5,
      heightPt: 216.75,
      placement: picture.watermark.placement,
    });
    expect(draft.customSize).toBe(true);
    expect(picture.watermark.opacity).toBe(1);
  });

  it('clears imported size overrides when the user chooses a scale', () => {
    const draft = patchWatermarkDraft(createWatermarkDraft(picture), { scalePercent: 200 });
    expect(toWatermarkInput(draft)).toMatchObject({ scalePercent: 200, placement: { rotationDegrees: 25 } });
    expect(toWatermarkInput(draft)).not.toHaveProperty('widthPt');
    expect(draft.placement).not.toHaveProperty('widthPt');
    expect(draft.customSize).toBe(false);
  });

  it('replaces a custom rotation when orientation is deliberately changed', () => {
    const draft = createWatermarkDraft({
      ...picture,
      watermark: { kind: 'text', text: 'DRAFT', placement: { rotationDegrees: 40 } },
    });
    expect(toWatermarkInput(patchWatermarkDraft(draft, { orientation: 'horizontal' }))).toMatchObject({
      orientation: 'horizontal',
      placement: { rotationDegrees: 0 },
    });
  });

  it('does not carry text dimensions into a new picture', () => {
    const draft = createWatermarkDraft({
      ...picture,
      watermark: { kind: 'text', text: 'DRAFT', placement: { widthPt: 400, heightPt: 60 } },
    });
    const changed = patchWatermarkDraft(draft, { kind: 'picture' });
    expect(changed.placement).toBeUndefined();
    expect(getWatermarkDraftError(changed)).toBe('Choose a picture.');
  });

  it('clears text geometry when changing to a picture through No watermark', () => {
    const text = createWatermarkDraft({
      ...picture,
      watermark: {
        kind: 'text',
        text: 'DRAFT',
        placement: { widthPt: 400, heightPt: 60, rotationDegrees: 315 },
      },
    });
    const hidden = patchWatermarkDraft(text, { kind: 'none' });
    const changed = patchWatermarkDraft(hidden, { kind: 'picture' });
    expect(changed.placement).toBeUndefined();
    expect(changed.orientation).toBe('horizontal');
    expect(changed.customPlacement).toBe(false);
  });

  it('clears picture geometry when changing to text through No watermark', () => {
    const hidden = patchWatermarkDraft(createWatermarkDraft(picture), { kind: 'none' });
    const changed = patchWatermarkDraft(hidden, { kind: 'text' });
    expect(changed.placement).toBeUndefined();
    expect(changed.orientation).toBe('diagonal');
    expect(changed.widthPt).toBeUndefined();
    expect(changed.customSize).toBe(false);
  });

  it.each([
    picture,
    {
      ...picture,
      watermark: { kind: 'text', text: 'DRAFT', placement: { widthPt: 400, heightPt: 60, rotationDegrees: 40 } },
    },
  ] satisfies WatermarkInfo[])(
    'preserves custom geometry when No watermark is switched back to the same kind: $watermark.kind',
    (item) => {
      const original = createWatermarkDraft(item);
      const hidden = patchWatermarkDraft(original, { kind: 'none' });
      expect(patchWatermarkDraft(hidden, { kind: item.watermark.kind })).toEqual(original);
    },
  );

  it('clears the custom rotation indication while preserving unrelated offsets', () => {
    const original = createWatermarkDraft({
      ...picture,
      watermark: {
        kind: 'text',
        text: 'DRAFT',
        placement: {
          rotationDegrees: 40,
          horizontal: { relativeFrom: 'margin', alignment: 'center', offsetPt: 10 },
        },
      },
    });
    expect(original.customOrientation).toBe(true);
    const changed = patchWatermarkDraft(original, { orientation: 'horizontal' });
    expect(changed.customOrientation).toBe(false);
    expect(changed.customPlacement).toBe(true);
    expect(changed.placement?.horizontal?.offsetPt).toBe(10);
  });

  it('reflects a picture’s actual rotation instead of the text default', () => {
    const horizontal = createWatermarkDraft({ ...picture, watermark: { ...picture.watermark, placement: undefined } });
    const diagonal = createWatermarkDraft({
      ...picture,
      watermark: { ...picture.watermark, placement: { rotationDegrees: 315 } },
    });
    expect(horizontal.orientation).toBe('horizontal');
    expect(diagonal.orientation).toBe('diagonal');
    expect(horizontal.customOrientation).toBe(false);
  });

  it.each([
    [{ kind: 'text', text: '  ' }, 'Enter watermark text.'],
    [{ kind: 'text', fontSize: 0 }, 'Enter a positive font size or choose Auto.'],
    [{ kind: 'text', transparency: 101 }, 'Transparency must be between 0 and 100%.'],
    [{ kind: 'text', color: '#xyz' }, 'Enter a six-digit hex color.'],
  ] as const)('rejects invalid draft settings %j', (patch, message) => {
    expect(getWatermarkDraftError(patchWatermarkDraft(createWatermarkDraft(), patch))).toBe(message);
  });
});
