import type { HeaderFooterSlotAddress } from '../header-footers/header-footers.types.js';
import type { AdapterMutationFailure } from '../types/adapter-result.js';
import type { DiscoveryOutput } from '../types/discovery.js';

export type WatermarkScalePercent = 'auto' | 50 | 100 | 150 | 200 | 500;
export type WatermarkRelativeFrom = 'page' | 'margin';
export type WatermarkHorizontalAlignment = 'left' | 'center' | 'right';
export type WatermarkVerticalAlignment = 'top' | 'center' | 'bottom';

export interface WatermarkPlacement {
  widthPt?: number;
  heightPt?: number;
  rotationDegrees?: number;
  behindText?: boolean;
  horizontal?: {
    relativeFrom: WatermarkRelativeFrom;
    alignment?: WatermarkHorizontalAlignment;
    offsetPt?: number;
  };
  vertical?: {
    relativeFrom: WatermarkRelativeFrom;
    alignment?: WatermarkVerticalAlignment;
    offsetPt?: number;
  };
}

export interface TextWatermark {
  kind: 'text';
  text: string;
  fontFamily?: string;
  fontSizePt?: number | 'auto';
  bold?: boolean;
  italic?: boolean;
  color?: string;
  opacity?: number;
  orientation?: 'horizontal' | 'diagonal';
  placement?: WatermarkPlacement;
}

export interface PictureWatermarkInput {
  kind: 'picture';
  src: string;
  scalePercent?: WatermarkScalePercent;
  widthPt?: number;
  heightPt?: number;
  lockAspectRatio?: boolean;
  washout?: boolean;
  opacity?: number;
  placement?: WatermarkPlacement;
}

export interface RetainedPictureWatermarkInput extends Omit<PictureWatermarkInput, 'src'> {
  source: { kind: 'existing'; watermarkId: string };
}

export interface PictureWatermarkInfo {
  kind: 'picture';
  mediaPartPath: string;
  contentType: string;
  scalePercent: WatermarkScalePercent;
  widthPt: number;
  heightPt: number;
  lockAspectRatio: boolean;
  washout: boolean;
  opacity: number;
  placement: WatermarkPlacement;
}

export type WatermarkInput = TextWatermark | PictureWatermarkInput;
export type WatermarkProperties = TextWatermark | PictureWatermarkInfo;

export interface DocumentWatermarkTarget {
  kind: 'document';
}

export type WatermarkTarget = DocumentWatermarkTarget | HeaderFooterSlotAddress;

export interface WatermarkAddress {
  kind: 'watermark';
  watermarkId: string;
}

export interface WatermarkInfo {
  watermarkId: string;
  owner: {
    refId: string;
    partPath: string;
  };
  effectiveIn: HeaderFooterSlotAddress[];
  watermark: WatermarkProperties;
}

export interface WatermarksListQuery {
  target?: WatermarkTarget;
  limit?: number;
  offset?: number;
}

export type WatermarksListResult = DiscoveryOutput<WatermarkInfo>;

export interface WatermarksInsertInput {
  target: WatermarkTarget;
  watermark: WatermarkInput;
}

export interface WatermarksReplaceInput {
  target: WatermarkAddress;
  watermark: WatermarkInput;
}

export interface WatermarksRemoveInput {
  target: WatermarkAddress;
}

export interface WatermarkMutationSuccess {
  success: true;
  watermark: WatermarkInfo;
  watermarks?: WatermarkInfo[];
}

export type WatermarkMutationResult = WatermarkMutationSuccess | AdapterMutationFailure;

export interface WatermarkRemoveSuccess {
  success: true;
  watermarkId: string;
}

export type WatermarkRemoveResult = WatermarkRemoveSuccess | AdapterMutationFailure;

/** An explicit destination whose surrounding inherited header scopes are preserved. */
export type WatermarksApplyTarget =
  | DocumentWatermarkTarget
  | { kind: 'headerFooterSlots'; slots: HeaderFooterSlotAddress[] };

export type WatermarksApplyInput =
  | { target: WatermarksApplyTarget; action: 'insert'; watermark: WatermarkInput }
  | {
      target: WatermarksApplyTarget;
      action: 'replace';
      watermarkIds: string[];
      watermark: WatermarkInput | RetainedPictureWatermarkInput;
    }
  | { target: WatermarksApplyTarget; action: 'remove'; watermarkIds: string[] };

export interface WatermarksApplySuccess {
  success: true;
  watermarks: WatermarkInfo[];
  affectedSlots: HeaderFooterSlotAddress[];
  preservedSlots: HeaderFooterSlotAddress[];
  evaluatedRevision: string;
  dryRun?: true;
}

export type WatermarksApplyResult = WatermarksApplySuccess | AdapterMutationFailure;
