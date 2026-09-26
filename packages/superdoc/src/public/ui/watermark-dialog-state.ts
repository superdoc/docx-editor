import type { WatermarkPlacement, WatermarkScalePercent } from '@superdoc/document-api';
import type { FontFamilyOption } from './types.js';

export interface WatermarkDraft {
  kind: 'none' | 'text' | 'picture';
  geometryKind: 'text' | 'picture' | null;
  text: string;
  fontFamily: string;
  fontSize: 'auto' | number;
  bold: boolean;
  italic: boolean;
  color: string;
  transparency: number;
  orientation: 'horizontal' | 'diagonal';
  scalePercent: WatermarkScalePercent;
  washout: boolean;
  lockAspectRatio: boolean;
  pictureName: string;
  src?: string;
  sourceWatermarkId?: string;
  placement?: WatermarkPlacement;
  widthPt?: number;
  heightPt?: number;
  customPlacement: boolean;
  customOrientation: boolean;
  customSize: boolean;
}

export type WatermarkPageVariant = 'all' | 'default' | 'first' | 'even';

export interface WatermarkPreview {
  url: string;
  width: number;
  height: number;
}

export interface WatermarkDialogSnapshot {
  phase: 'loading' | 'editing' | 'previewing' | 'applying';
  draft: WatermarkDraft;
  sections: { id: string; label: string }[];
  sectionId: string | null;
  variant: WatermarkPageVariant;
  items: { id: string; label: string; locations: string }[];
  selectedIds: string[];
  fonts: FontFamilyOption[];
  dirty: boolean;
  canApply: boolean;
  error: string | null;
  stale: boolean;
  readonlyReason: string | null;
  impact: string;
  impactDetails: string[];
  preview: WatermarkPreview | null;
}

export interface WatermarkDialogModel {
  getSnapshot(): WatermarkDialogSnapshot;
  subscribe(listener: (snapshot: WatermarkDialogSnapshot) => void): () => void;
  patchDraft(patch: Partial<WatermarkDraft>): void;
  setScope(sectionId: string | null, variant: WatermarkPageVariant): void;
  selectWatermarks(ids: string[]): void;
  apply(): Promise<void>;
  reload(): Promise<void>;
}
