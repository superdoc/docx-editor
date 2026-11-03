import type { Line, Run, TextRun } from '@superdoc/contracts';
import { toCssFontFamily } from '@superdoc/font-utils';
import {
  applySemanticTrackedChangeMetadata,
  applyTrackedChangeColorVariables,
  TRACK_CHANGE_BASE_CLASS,
  TRACK_CHANGE_MODIFIER_CLASS,
} from './tracked-changes.js';

export const setTextContentWithFormattingSpaceMarks = (
  element: HTMLElement,
  text: string,
  doc: Document,
  showFormattingMarks: boolean,
): void => {
  if (!showFormattingMarks || !text.includes(' ')) {
    element.textContent = text;
    return;
  }

  element.textContent = '';
  let chunkStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== ' ') continue;

    if (index > chunkStart) {
      element.appendChild(doc.createTextNode(text.slice(chunkStart, index)));
    }

    const space = doc.createElement('span');
    space.classList.add('superdoc-formatting-space-mark');
    space.textContent = ' ';
    element.appendChild(space);
    chunkStart = index + 1;
  }

  if (chunkStart < text.length) {
    element.appendChild(doc.createTextNode(text.slice(chunkStart)));
  }
};

export const appendFormattingLineBreakMark = (
  lineEl: HTMLElement,
  line: Line,
  runs: Run[],
  lineIndex: number,
  leftOffsetPx: number,
  availableWidth: number,
  hasExplicitPositioning: boolean,
  doc: Document,
  showFormattingMarks: boolean,
): void => {
  if (!showFormattingMarks) return;
  const isManualBreak = (run: Run | undefined): boolean =>
    run?.kind === 'lineBreak' || (run?.kind === 'break' && (!run.breakType || run.breakType === 'line'));
  const endRun = runs[line.toRun];
  const endsRun = endRun && (!('text' in endRun) || line.toChar >= endRun.text.length);
  // Measurement excludes a terminating break from a text line, and keeps
  // its index for an empty line. A trailing placeholder is the next line.
  const endsWithBreak =
    (isManualBreak(endRun) && (line.fromRun !== line.toRun || lineIndex === 0)) ||
    (endsRun && isManualBreak(runs[line.toRun + 1]));
  if (!endsWithBreak) return;
  const mark = doc.createElement('span');
  mark.classList.add('superdoc-formatting-line-break');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '↵';
  const textRun = findLastTextRun(runs, line.toRun)?.run ?? findLastTextRun(runs)?.run;
  mark.style.fontSize = `${textRun?.fontSize ?? 16}px`;
  if (textRun?.fontFamily) mark.style.fontFamily = toCssFontFamily(textRun.fontFamily) ?? textRun.fontFamily;
  if (textRun?.bold) mark.style.fontWeight = 'bold';
  if (textRun?.italic) mark.style.fontStyle = 'italic';
  const lineWidth = line.naturalWidth ?? line.width ?? 0;
  const slack = Math.max(0, availableWidth - lineWidth);
  const alignmentOffset = hasExplicitPositioning
    ? 0
    : lineEl.style.textAlign === 'center'
      ? slack / 2
      : lineEl.style.textAlign === 'right'
        ? slack
        : 0;
  const rtl = lineEl.dir === 'rtl' || lineEl.style.direction === 'rtl';
  mark.style.left = `${Math.max(0, leftOffsetPx + alignmentOffset + (rtl ? 0 : lineWidth))}px`;
  mark.style.lineHeight = `${line.lineHeight}px`;
  lineEl.appendChild(mark);
};

const findLastTextRun = (runs: Run[], fromIndex = runs.length - 1): { run: TextRun; index: number } | null => {
  for (let index = Math.min(fromIndex, runs.length - 1); index >= 0; index -= 1) {
    const run = runs[index];
    if (run && (run.kind === 'text' || run.kind === undefined) && 'text' in run) {
      return { run, index };
    }
  }
  return null;
};

const findDeletedParagraphMarkAnchorRun = (runs: Run[]): TextRun | null => {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (
      run &&
      (run.kind === 'text' || run.kind === undefined) &&
      'text' in run &&
      run.vanish === true &&
      run.dataAttrs?.['data-paragraph-mark-deletion-anchor'] === 'true' &&
      run.trackedChange
    ) {
      return run;
    }
  }
  return null;
};

const applyDeletedParagraphMarkReview = (mark: HTMLElement, run: TextRun): void => {
  const trackedChange = run.trackedChange;
  if (!trackedChange) return;

  const baseClass = TRACK_CHANGE_BASE_CLASS[trackedChange.kind];
  if (baseClass) mark.classList.add(baseClass);
  const modifier = TRACK_CHANGE_MODIFIER_CLASS[trackedChange.kind]?.review;
  if (modifier) mark.classList.add(modifier);
  mark.classList.add('superdoc-tracked-paragraph-mark');
  applyTrackedChangeColorVariables(mark, trackedChange);
  applySemanticTrackedChangeMetadata(mark, trackedChange);

  mark.dataset.trackChangeId = trackedChange.id;
  mark.dataset.trackChangeIds = trackedChange.id;
  mark.dataset.trackChangeKind = trackedChange.kind;
  mark.dataset.trackChangeAnchor = 'paragraph-mark';
  mark.dataset.trackChangeStructural = 'paragraph-mark';
  mark.dataset.trackChangeMarker = 'paragraph';
  if (trackedChange.storyKey) mark.dataset.storyKey = trackedChange.storyKey;
  if (trackedChange.author) mark.dataset.trackChangeAuthor = trackedChange.author;
  if (trackedChange.authorEmail) mark.dataset.trackChangeAuthorEmail = trackedChange.authorEmail;
  if (trackedChange.color) mark.dataset.trackChangeAuthorColor = trackedChange.color;
  if (trackedChange.date) mark.dataset.trackChangeDate = trackedChange.date;

  mark.style.display = 'inline';
  mark.style.textDecorationColor = 'currentColor';
  mark.style.textDecorationLine = trackedChange.kind === 'delete' ? 'line-through' : 'underline';
};

export const appendFormattingParagraphMark = (
  lineEl: HTMLElement,
  line: Line,
  runs: Run[],
  leftOffsetPx: number,
  availableWidth: number,
  hasExplicitPositioning: boolean,
  doc: Document,
  showFormattingMarks: boolean,
): void => {
  if (!showFormattingMarks) return;
  const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
  if (lastRun) {
    const lastRunIndex = runs.length - 1;
    if (line.toRun < lastRunIndex) return;
    if (
      line.toRun === lastRunIndex &&
      (lastRun.kind === 'text' || lastRun.kind === undefined) &&
      'text' in lastRun &&
      line.toChar < lastRun.text.length
    ) {
      return;
    }
  }

  const lastTextRun = findLastTextRun(runs);
  const deletedParagraphMarkAnchor = findDeletedParagraphMarkAnchorRun(runs);

  const mark = doc.createElement('span');
  mark.classList.add('superdoc-formatting-paragraph-mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '¶';

  const run = lastTextRun?.run;
  if (run) {
    if (run.fontFamily) {
      mark.style.fontFamily = toCssFontFamily(run.fontFamily) ?? run.fontFamily;
    }
    if (typeof run.fontSize === 'number') {
      mark.style.fontSize = `${run.fontSize}px`;
    }
    if (run.bold) {
      mark.style.fontWeight = 'bold';
    }
    if (run.italic) {
      mark.style.fontStyle = 'italic';
    }
    if (run.letterSpacing != null) {
      mark.style.letterSpacing = `${run.letterSpacing}px`;
    }
  }
  mark.style.lineHeight = `${line.lineHeight}px`;

  const lineWidth = line.naturalWidth ?? line.width ?? 0;
  const alignmentSlack = Math.max(0, availableWidth - lineWidth);
  const textAlign = lineEl.style.textAlign;
  const alignmentOffset =
    !hasExplicitPositioning && textAlign === 'center'
      ? alignmentSlack / 2
      : !hasExplicitPositioning && textAlign === 'right'
        ? alignmentSlack
        : 0;
  const isRtl = lineEl.dir === 'rtl' || lineEl.style.direction === 'rtl';
  const visualTextEndOffset = isRtl ? alignmentOffset : alignmentOffset + lineWidth;
  mark.style.left = `${Math.max(0, leftOffsetPx + visualTextEndOffset)}px`;
  if (deletedParagraphMarkAnchor) {
    applyDeletedParagraphMarkReview(mark, deletedParagraphMarkAnchor);
  }
  lineEl.appendChild(mark);
};
