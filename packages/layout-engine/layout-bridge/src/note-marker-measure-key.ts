import { isBodyNoteReferenceRun, isNoteLabelRun, isNumberedNoteMarkerRun, type TextRun } from '@superdoc/contracts';
import type { FontMeasureCapabilities } from '@superdoc/font-system';

const DECIMAL_MARKER = /^\d+$/u;
const DECIMAL_NOTE_LABEL = /^(\d+)\u00A0$/u;

export function noteMarkerMeasureKey(run: TextRun, capabilities?: FontMeasureCapabilities): string {
  const exactKey = run.text;
  if (!isNumberedNoteMarkerRun(run) || !capabilities) return exactKey;

  const digitCount =
    isBodyNoteReferenceRun(run) && DECIMAL_MARKER.test(run.text)
      ? run.text.length
      : isNoteLabelRun(run)
        ? DECIMAL_NOTE_LABEL.exec(run.text)?.[1]?.length
        : undefined;
  if (digitCount == null) return exactKey;

  const hasTabularDigits = capabilities.hasTabularDigits({
    family: run.fontFamily,
    sizePx: run.fontSize,
    weight: run.bold ? '700' : '400',
    style: run.italic ? 'italic' : 'normal',
  });
  const markerKind = isNoteLabelRun(run) ? 'label' : 'body';
  return hasTabularDigits ? `\u0000note-decimal:${markerKind}:${digitCount}\u0000` : exactKey;
}
