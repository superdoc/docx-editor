export interface UnicodeRange {
  start: number;
  end: number;
}

export interface UnicodeCoverage {
  ranges: readonly UnicodeRange[];
  cssUnicodeRange: string;
}

const SFNT_HEADER_LENGTH = 12;
const SFNT_TABLE_RECORD_LENGTH = 16;
const MAX_UNICODE_CODE_POINT = 0x10ffff;

function dataViewOf(bytes: ArrayBuffer | ArrayBufferView): DataView {
  return bytes instanceof ArrayBuffer
    ? new DataView(bytes)
    : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function rangeIsReadable(view: DataView, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset <= view.byteLength - length;
}

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

class RangeCollector {
  readonly #ranges: UnicodeRange[] = [];

  add(start: number, end: number): void {
    const boundedStart = Math.max(0, start);
    const boundedEnd = Math.min(MAX_UNICODE_CODE_POINT, end);
    if (boundedStart > boundedEnd) return;
    this.#ranges.push({ start: boundedStart, end: boundedEnd });
  }

  finish(): UnicodeRange[] {
    const sorted = this.#ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: UnicodeRange[] = [];
    for (const range of sorted) {
      const previous = merged.at(-1);
      if (!previous || range.start > previous.end + 1) {
        merged.push({ ...range });
      } else if (range.end > previous.end) {
        previous.end = range.end;
      }
    }
    return merged;
  }
}

function addFormat0(view: DataView, offset: number, collector: RangeCollector): boolean {
  if (!rangeIsReadable(view, offset, 6)) return false;
  const length = view.getUint16(offset + 2);
  if (length < 262 || !rangeIsReadable(view, offset, length)) return false;
  for (let codePoint = 0; codePoint < 256; codePoint += 1) {
    if (view.getUint8(offset + 6 + codePoint) !== 0) collector.add(codePoint, codePoint);
  }
  return true;
}

function addFormat4(view: DataView, offset: number, collector: RangeCollector): boolean {
  if (!rangeIsReadable(view, offset, 16)) return false;
  const length = view.getUint16(offset + 2);
  const segCount = view.getUint16(offset + 6) / 2;
  if (length < 16 || !Number.isInteger(segCount) || segCount <= 0 || !rangeIsReadable(view, offset, length)) {
    return false;
  }
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const deltas = startCodes + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  if (rangeOffsets < offset || rangeOffsets + segCount * 2 > offset + length) return false;

  for (let index = 0; index < segCount; index += 1) {
    const start = view.getUint16(startCodes + index * 2);
    const end = view.getUint16(endCodes + index * 2);
    if (start > end || start === 0xffff) continue;
    const delta = view.getInt16(deltas + index * 2);
    const rangeOffsetAddress = rangeOffsets + index * 2;
    const rangeOffset = view.getUint16(rangeOffsetAddress);
    if (rangeOffset === 0) {
      const missing = -delta & 0xffff;
      if (missing < start || missing > end) collector.add(start, end);
      else {
        collector.add(start, missing - 1);
        collector.add(missing + 1, end);
      }
      continue;
    }
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      const glyphAddress = rangeOffsetAddress + rangeOffset + (codePoint - start) * 2;
      if (glyphAddress < offset || glyphAddress + 2 > offset + length) return false;
      const glyph = view.getUint16(glyphAddress);
      if (glyph !== 0 && ((glyph + delta) & 0xffff) !== 0) collector.add(codePoint, codePoint);
    }
  }
  return true;
}

function addFormat6(view: DataView, offset: number, collector: RangeCollector): boolean {
  if (!rangeIsReadable(view, offset, 10)) return false;
  const length = view.getUint16(offset + 2);
  const firstCode = view.getUint16(offset + 6);
  const count = view.getUint16(offset + 8);
  if (length < 10 + count * 2 || !rangeIsReadable(view, offset, length)) return false;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint16(offset + 10 + index * 2) !== 0) collector.add(firstCode + index, firstCode + index);
  }
  return true;
}

function addFormat10(view: DataView, offset: number, collector: RangeCollector): boolean {
  if (!rangeIsReadable(view, offset, 20)) return false;
  const length = view.getUint32(offset + 4);
  const firstCode = view.getUint32(offset + 12);
  const count = view.getUint32(offset + 16);
  if (count > MAX_UNICODE_CODE_POINT + 1 || length < 20 + count * 2 || !rangeIsReadable(view, offset, length)) {
    return false;
  }
  for (let index = 0; index < count; index += 1) {
    if (view.getUint16(offset + 20 + index * 2) !== 0) collector.add(firstCode + index, firstCode + index);
  }
  return true;
}

function addFormat12Or13(view: DataView, offset: number, collector: RangeCollector, format: 12 | 13): boolean {
  if (!rangeIsReadable(view, offset, 16)) return false;
  const length = view.getUint32(offset + 4);
  const count = view.getUint32(offset + 12);
  if (count > Math.floor((view.byteLength - offset - 16) / 12) || length < 16 + count * 12) return false;
  if (!rangeIsReadable(view, offset, length)) return false;
  for (let index = 0; index < count; index += 1) {
    const group = offset + 16 + index * 12;
    const start = view.getUint32(group);
    const end = view.getUint32(group + 4);
    const glyph = view.getUint32(group + 8);
    if (start > end || start > MAX_UNICODE_CODE_POINT) continue;
    if (format === 13) {
      if (glyph !== 0) collector.add(start, end);
    } else {
      collector.add(glyph === 0 ? start + 1 : start, end);
    }
  }
  return true;
}

function isUnicodeCmap(platform: number, encoding: number): boolean {
  return platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
}

function addSubtable(view: DataView, offset: number, collector: RangeCollector): boolean {
  if (!rangeIsReadable(view, offset, 2)) return false;
  const format = view.getUint16(offset);
  switch (format) {
    case 0:
      return addFormat0(view, offset, collector);
    case 4:
      return addFormat4(view, offset, collector);
    case 6:
      return addFormat6(view, offset, collector);
    case 10:
      return addFormat10(view, offset, collector);
    case 12:
    case 13:
      return addFormat12Or13(view, offset, collector, format);
    default:
      return false;
  }
}

function cssUnicodeRange(ranges: readonly UnicodeRange[]): string {
  return ranges
    .map((range) => {
      const start = range.start.toString(16).toUpperCase();
      const end = range.end.toString(16).toUpperCase();
      return range.start === range.end ? `U+${start}` : `U+${start}-${end}`;
    })
    .join(', ');
}

export function unicodeCoverageFromCss(value: string): UnicodeCoverage {
  const collector = new RangeCollector();
  for (const part of value.split(',')) {
    const match = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim());
    const from = match?.[1];
    if (!from) continue;
    collector.add(
      Number.parseInt(from.replace(/\?/g, '0'), 16),
      Number.parseInt(match?.[2] ?? from.replace(/\?/g, 'F'), 16),
    );
  }
  const ranges = collector.finish();
  return { ranges, cssUnicodeRange: cssUnicodeRange(ranges) };
}

export function parseUnicodeCoverage(bytes: ArrayBuffer | ArrayBufferView): UnicodeCoverage | null {
  const view = dataViewOf(bytes);
  if (!rangeIsReadable(view, 0, SFNT_HEADER_LENGTH)) return null;
  const tableCount = view.getUint16(4);
  let cmapOffset = -1;
  let cmapLength = 0;
  for (let index = 0; index < tableCount; index += 1) {
    const record = SFNT_HEADER_LENGTH + index * SFNT_TABLE_RECORD_LENGTH;
    if (!rangeIsReadable(view, record, SFNT_TABLE_RECORD_LENGTH)) return null;
    if (tagAt(view, record) !== 'cmap') continue;
    cmapOffset = view.getUint32(record + 8);
    cmapLength = view.getUint32(record + 12);
    break;
  }
  if (cmapOffset < 0 || !rangeIsReadable(view, cmapOffset, cmapLength) || cmapLength < 4) return null;
  const cmap = new DataView(view.buffer, view.byteOffset + cmapOffset, cmapLength);
  const subtableCount = cmap.getUint16(2);
  if (!rangeIsReadable(cmap, 4, subtableCount * 8)) return null;

  const collector = new RangeCollector();
  let parsed = false;
  const seenOffsets = new Set<number>();
  for (let index = 0; index < subtableCount; index += 1) {
    const record = 4 + index * 8;
    const platform = cmap.getUint16(record);
    const encoding = cmap.getUint16(record + 2);
    if (!isUnicodeCmap(platform, encoding)) continue;
    const subtableOffset = cmap.getUint32(record + 4);
    if (subtableOffset >= cmap.byteLength || seenOffsets.has(subtableOffset)) continue;
    seenOffsets.add(subtableOffset);
    const subtableCollector = new RangeCollector();
    if (!addSubtable(cmap, subtableOffset, subtableCollector)) continue;
    for (const range of subtableCollector.finish()) collector.add(range.start, range.end);
    parsed = true;
  }
  if (!parsed) return null;
  const ranges = collector.finish();
  if (ranges.length === 0) return null;
  return { ranges, cssUnicodeRange: cssUnicodeRange(ranges) };
}

export function unicodeCoverageIncludes(coverage: UnicodeCoverage | null | undefined, codePoint: number): boolean {
  if (!coverage || !Number.isInteger(codePoint) || codePoint < 0 || codePoint > MAX_UNICODE_CODE_POINT) return false;
  let low = 0;
  let high = coverage.ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = coverage.ranges[middle];
    if (codePoint < range.start) high = middle - 1;
    else if (codePoint > range.end) low = middle + 1;
    else return true;
  }
  return false;
}

export function textForUnicodeCoverage(text: string, coverage: UnicodeCoverage): string {
  let matched = '';
  const seen = new Set<number>();
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint == null || seen.has(codePoint) || !unicodeCoverageIncludes(coverage, codePoint)) continue;
    seen.add(codePoint);
    matched += character;
  }
  return matched;
}
