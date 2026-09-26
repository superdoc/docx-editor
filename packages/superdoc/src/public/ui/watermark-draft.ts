import type {
  RetainedPictureWatermarkInput,
  WatermarkInfo,
  WatermarkInput,
  WatermarkPlacement,
} from '@superdoc/document-api';
import type { WatermarkDraft } from './watermark-dialog-state.js';

function placementState(placement?: WatermarkPlacement) {
  const customOrientation = placement?.rotationDegrees != null && ![0, 315].includes(placement.rotationDegrees);
  return {
    customOrientation,
    customPlacement: Boolean(
      customOrientation ||
      placement?.behindText === false ||
      (placement?.horizontal && (placement.horizontal.alignment !== 'center' || placement.horizontal.offsetPt)) ||
      (placement?.vertical && (placement.vertical.alignment !== 'center' || placement.vertical.offsetPt)),
    ),
  };
}

export function createWatermarkDraft(item?: WatermarkInfo): WatermarkDraft {
  const value = item?.watermark;
  const placement = value?.placement ? structuredClone(value.placement) : undefined;
  const picture = value?.kind === 'picture' ? value : undefined;
  const text = value?.kind === 'text' ? value : undefined;
  const rotation = placement?.rotationDegrees ?? (picture ? 0 : text?.orientation === 'horizontal' ? 0 : 315);
  return {
    kind: value?.kind ?? 'none',
    geometryKind: value?.kind ?? null,
    text: text?.text ?? 'DRAFT',
    fontFamily: text?.fontFamily ?? 'Calibri',
    fontSize: text?.fontSizePt ?? 'auto',
    bold: text?.bold ?? false,
    italic: text?.italic ?? false,
    color: text?.color ?? '#C0C0C0',
    transparency: (1 - (value?.opacity ?? 0.5)) * 100,
    orientation: rotation === 0 ? 'horizontal' : 'diagonal',
    scalePercent: picture?.scalePercent ?? 'auto',
    washout: picture?.washout ?? true,
    lockAspectRatio: picture?.lockAspectRatio ?? true,
    pictureName: picture ? 'Image in this document' : '',
    sourceWatermarkId: picture ? item?.watermarkId : undefined,
    widthPt: picture?.widthPt,
    heightPt: picture?.heightPt,
    placement,
    ...placementState(placement),
    customSize: Boolean(picture && (placement?.widthPt != null || picture.widthPt != null)),
  };
}

export function patchWatermarkDraft(draft: WatermarkDraft, patch: Partial<WatermarkDraft>): WatermarkDraft {
  const next = { ...draft, ...patch };
  if (patch.kind && patch.kind !== 'none') {
    if (patch.kind !== draft.geometryKind) {
      next.placement = undefined;
      next.widthPt = undefined;
      next.heightPt = undefined;
      next.customSize = false;
      next.orientation = patch.kind === 'picture' ? 'horizontal' : 'diagonal';
    }
    next.geometryKind = patch.kind;
  }
  if (patch.orientation !== undefined) {
    next.placement = { ...next.placement, rotationDegrees: patch.orientation === 'diagonal' ? 315 : 0 };
  }
  if (patch.scalePercent !== undefined || patch.src !== undefined) {
    const { widthPt: _width, heightPt: _height, ...placement } = next.placement ?? {};
    next.placement = Object.keys(placement).length ? placement : undefined;
    next.widthPt = undefined;
    next.heightPt = undefined;
    next.customSize = false;
  }
  return { ...next, ...placementState(next.placement) };
}

export function getWatermarkDraftError(draft: WatermarkDraft): string | null {
  if (draft.kind === 'none') return null;
  if (!Number.isFinite(draft.transparency) || draft.transparency < 0 || draft.transparency > 100) {
    return 'Transparency must be between 0 and 100%.';
  }
  if (draft.kind === 'picture') return draft.src || draft.sourceWatermarkId ? null : 'Choose a picture.';
  if (!draft.text.trim()) return 'Enter watermark text.';
  if (draft.fontSize !== 'auto' && (!Number.isFinite(draft.fontSize) || draft.fontSize <= 0)) {
    return 'Enter a positive font size or choose Auto.';
  }
  if (!/^#[\da-f]{6}$/i.test(draft.color)) return 'Enter a six-digit hex color.';
  if (!draft.fontFamily.trim()) return 'Choose a font.';
  return null;
}

export function toWatermarkInput(draft: WatermarkDraft): WatermarkInput | RetainedPictureWatermarkInput {
  const shared = { opacity: 1 - draft.transparency / 100, ...(draft.placement ? { placement: draft.placement } : {}) };
  if (draft.kind === 'text')
    return {
      kind: 'text',
      text: draft.text,
      fontFamily: draft.fontFamily,
      fontSizePt: draft.fontSize,
      bold: draft.bold,
      italic: draft.italic,
      color: draft.color,
      orientation: draft.orientation,
      ...shared,
    };
  if (draft.kind !== 'picture') throw new Error('A removal has no watermark input.');
  return {
    kind: 'picture',
    ...(draft.src
      ? { src: draft.src }
      : { source: { kind: 'existing' as const, watermarkId: draft.sourceWatermarkId! } }),
    scalePercent: draft.scalePercent,
    washout: draft.washout,
    lockAspectRatio: draft.lockAspectRatio,
    ...(draft.widthPt != null ? { widthPt: draft.widthPt } : {}),
    ...(draft.heightPt != null ? { heightPt: draft.heightPt } : {}),
    ...shared,
  };
}
