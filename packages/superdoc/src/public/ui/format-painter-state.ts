import type { SDRunProps } from '@superdoc/document-api';
import type { ParagraphPaintOperation } from './format-painter-paragraph.js';

export type FormatPainterMode = 'idle' | 'armed' | 'persistent';

export interface FormatPainterParagraphSnapshot {
  styleId: string | null;
  inheritedFontKeys?: Array<'fontFamily' | 'fontSize'>;
  operations: ParagraphPaintOperation[];
  markRunProps: SDRunProps | null;
  numbering: { numId: number; level?: number } | null;
  listStyle: unknown | null;
}

export interface FormatPainterSnapshot {
  story: unknown | null;
  inline: Record<string, unknown>;
  mixedInlineKeys: string[];
  paragraph: FormatPainterParagraphSnapshot | null;
}

export const FORMAT_PAINTER_BOOLEAN_KEYS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'dstrike',
  'smallCaps',
  'caps',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'rtl',
  'cs',
  'bCs',
  'iCs',
  'vanish',
  'webHidden',
  'specVanish',
]);

export interface FormatPainterState {
  mode: FormatPainterMode;
  snapshot: FormatPainterSnapshot | null;
  sourceSelectionKey: string | null;
  lastClickAt: number;
  pointerSelecting: boolean;
  keyboardSelecting: boolean;
}
