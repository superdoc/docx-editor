import type {
  DocumentApi,
  PictureWatermarkInput,
  TextWatermark,
  WatermarkInfo,
  WatermarkTarget,
  WatermarksApplyInput,
  WatermarksApplyResult,
  RetainedPictureWatermarkInput,
} from 'superdoc/ui';

declare const doc: DocumentApi;
declare const target: WatermarkTarget;

const text: TextWatermark = {
  kind: 'text',
  text: 'CONFIDENTIAL',
  fontFamily: 'Aptos Display',
  fontSizePt: 42,
  bold: true,
  italic: true,
  color: '#4F81BD',
  opacity: 0.4,
  orientation: 'diagonal',
  placement: {
    widthPt: 360,
    heightPt: 72,
    rotationDegrees: 315,
    behindText: true,
    horizontal: { relativeFrom: 'margin', alignment: 'center', offsetPt: 18 },
    vertical: { relativeFrom: 'page', alignment: 'center', offsetPt: -12 },
  },
};

const picture: PictureWatermarkInput = {
  kind: 'picture',
  src: 'data:image/png;base64,AA==',
  scalePercent: 150,
  widthPt: 96,
  heightPt: 48,
  lockAspectRatio: true,
  washout: true,
  opacity: 0.35,
};

const listed: WatermarkInfo[] = doc.watermarks.list({ target }).items;
const inserted = doc.watermarks.insert({ target, watermark: picture });
if (inserted.success) {
  doc.watermarks.replace({
    target: { kind: 'watermark', watermarkId: inserted.watermark.watermarkId },
    watermark: text,
  });
  doc.watermarks.remove({
    target: { kind: 'watermark', watermarkId: inserted.watermark.watermarkId },
  });
}

void listed;

const retained: RetainedPictureWatermarkInput = {
  kind: 'picture',
  source: { kind: 'existing', watermarkId: 'retained' },
  washout: true,
};
const applyInput: WatermarksApplyInput = {
  action: 'replace',
  target: { kind: 'document' },
  watermarkIds: ['retained'],
  watermark: retained,
};
const applied: WatermarksApplyResult = doc.watermarks.apply(applyInput, { expectedRevision: '1', dryRun: true });
if (applied.success) {
  const revision: string = applied.evaluatedRevision;
  const resulting: WatermarkInfo[] = applied.watermarks;
  void revision;
  void resulting;
  applied.affectedSlots.forEach((slot) => slot.section.sectionId);
  applied.preservedSlots.forEach((slot) => slot.variant);
}
// @ts-expect-error Replacement requires explicit watermark identities.
doc.watermarks.apply({ action: 'replace', target: { kind: 'document' }, watermark: text });
