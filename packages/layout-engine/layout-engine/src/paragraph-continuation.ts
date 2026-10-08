import type { Line, ParagraphBlock } from '@superdoc/contracts';
import { isBodyNoteReferenceRun, isEmptySdtPlaceholderRun } from '@superdoc/contracts';

/** Build a measurement-only suffix while keeping line coordinates in the original paragraph. */
export function paragraphContinuation(block: ParagraphBlock, first: Line) {
  const runOffset = first.fromRun;
  const runs = block.runs.slice(runOffset);
  const firstRun = runs[0];
  const isSliceableText = firstRun && (firstRun.kind == null || firstRun.kind === 'text');
  const charOffset = isSliceableText ? first.fromChar : 0;
  if (isSliceableText) {
    runs[0] = {
      ...firstRun,
      text: firstRun.text.slice(charOffset),
      // Note labels and SDT placeholders can have several paint characters
      // while occupying one source position. Slice their paint text without
      // shifting that atomic source range.
      ...(firstRun.pmStart != null && !isBodyNoteReferenceRun(firstRun) && !isEmptySdtPlaceholderRun(firstRun)
        ? { pmStart: firstRun.pmStart + charOffset }
        : {}),
    };
  }
  const attrs = block.attrs;
  const suffix: ParagraphBlock = {
    ...block,
    runs,
    attrs: {
      ...attrs,
      indent: { ...attrs?.indent, firstLine: 0, hanging: 0 },
      suppressFirstLineIndent: true,
      wordLayout: attrs?.wordLayout
        ? { ...attrs.wordLayout, marker: undefined, textStartPx: undefined, firstLineIndentMode: false }
        : undefined,
    },
  };
  const mapLine = (line: Line): Line => ({
    ...line,
    fromRun: line.fromRun + runOffset,
    toRun: line.toRun + runOffset,
    fromChar: line.fromChar + (line.fromRun === 0 ? charOffset : 0),
    toChar: line.toChar + (line.toRun === 0 ? charOffset : 0),
    ...(line.segments
      ? {
          segments: line.segments.map((segment) => ({
            ...segment,
            runIndex: segment.runIndex + runOffset,
            fromChar: segment.fromChar + (segment.runIndex === 0 ? charOffset : 0),
            toChar: segment.toChar + (segment.runIndex === 0 ? charOffset : 0),
          })),
        }
      : {}),
    ...(line.tabWidths
      ? {
          tabWidths: Object.fromEntries(
            Object.entries(line.tabWidths).map(([index, width]) => [Number(index) + runOffset, width]),
          ),
        }
      : {}),
    ...(line.inlineImageAlignments
      ? {
          inlineImageAlignments: line.inlineImageAlignments.map((image) => ({
            ...image,
            runIndex: image.runIndex + runOffset,
          })),
        }
      : {}),
  });
  return { block: suffix, mapLine };
}
