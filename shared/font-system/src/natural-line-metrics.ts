export interface SfntNaturalLineMetrics {
  unitsPerEm: number;
  lineHeightUnits: number;
  lineHeightMultiplier: number;
  source: 'os2-typo' | 'legacy-win-hhea';
}

type TableRecord = { offset: number; length: number };

const SFNT_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const HEAD_UNITS_PER_EM_OFFSET = 18;
const HHEA_ASCENDER_OFFSET = 4;
const HHEA_DESCENDER_OFFSET = 6;
const HHEA_LINE_GAP_OFFSET = 8;
const OS2_FS_SELECTION_OFFSET = 62;
const OS2_TYPO_ASCENDER_OFFSET = 68;
const OS2_TYPO_DESCENDER_OFFSET = 70;
const OS2_TYPO_LINE_GAP_OFFSET = 72;
const OS2_WIN_ASCENT_OFFSET = 74;
const OS2_WIN_DESCENT_OFFSET = 76;
const USE_TYPO_METRICS = 1 << 7;

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readTableDirectory(view: DataView): Map<string, TableRecord> | null {
  if (view.byteLength < SFNT_HEADER_SIZE) return null;
  const signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f && signature !== 0x74727565) return null;

  const numTables = view.getUint16(4);
  if (SFNT_HEADER_SIZE + numTables * TABLE_RECORD_SIZE > view.byteLength) return null;
  const tables = new Map<string, TableRecord>();
  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = SFNT_HEADER_SIZE + index * TABLE_RECORD_SIZE;
    const offset = view.getUint32(recordOffset + 8);
    const length = view.getUint32(recordOffset + 12);
    if (offset > view.byteLength || length > view.byteLength - offset) return null;
    tables.set(tagAt(view, recordOffset), { offset, length });
  }
  return tables;
}

function contains(record: TableRecord | undefined, relativeOffset: number, byteLength: number): record is TableRecord {
  return Boolean(
    record &&
    relativeOffset >= 0 &&
    byteLength >= 0 &&
    relativeOffset <= record.length &&
    byteLength <= record.length - relativeOffset,
  );
}

/**
 * Read a static SFNT face's design-unit baseline pitch without consulting browser font state.
 * Variable fonts fail closed until their MVAR/axis instance can be applied to these metrics.
 */
export function parseSfntNaturalLineMetrics(bytes: ArrayBuffer | ArrayBufferView): SfntNaturalLineMetrics | null {
  const view =
    bytes instanceof ArrayBuffer ? new DataView(bytes) : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = readTableDirectory(view);
  if (!tables || tables.has('fvar') || tables.has('MVAR')) return null;

  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const os2 = tables.get('OS/2');
  if (
    !contains(head, HEAD_UNITS_PER_EM_OFFSET, 2) ||
    !contains(hhea, HHEA_LINE_GAP_OFFSET, 2) ||
    !contains(os2, OS2_WIN_DESCENT_OFFSET, 2)
  ) {
    return null;
  }

  const unitsPerEm = view.getUint16(head.offset + HEAD_UNITS_PER_EM_OFFSET);
  if (unitsPerEm < 16 || unitsPerEm > 16_384) return null;

  const os2Version = view.getUint16(os2.offset);
  const fsSelection = view.getUint16(os2.offset + OS2_FS_SELECTION_OFFSET);
  let lineHeightUnits: number;
  let source: SfntNaturalLineMetrics['source'];
  // AIDEV-NOTE: USE_TYPO_METRICS is the OpenType opt-in for typo metrics. Legacy faces instead
  // need the larger hhea/Windows pitch so text is not clipped on a platform choosing either set.
  if (os2Version >= 4 && (fsSelection & USE_TYPO_METRICS) !== 0) {
    const ascender = view.getInt16(os2.offset + OS2_TYPO_ASCENDER_OFFSET);
    const descender = view.getInt16(os2.offset + OS2_TYPO_DESCENDER_OFFSET);
    const lineGap = view.getInt16(os2.offset + OS2_TYPO_LINE_GAP_OFFSET);
    lineHeightUnits = ascender - descender + Math.max(0, lineGap);
    source = 'os2-typo';
  } else {
    const hheaAscender = view.getInt16(hhea.offset + HHEA_ASCENDER_OFFSET);
    const hheaDescender = view.getInt16(hhea.offset + HHEA_DESCENDER_OFFSET);
    const hheaLineGap = view.getInt16(hhea.offset + HHEA_LINE_GAP_OFFSET);
    const hheaHeight = hheaAscender - hheaDescender + Math.max(0, hheaLineGap);
    const winHeight =
      view.getUint16(os2.offset + OS2_WIN_ASCENT_OFFSET) + view.getUint16(os2.offset + OS2_WIN_DESCENT_OFFSET);
    lineHeightUnits = Math.max(hheaHeight, winHeight);
    source = 'legacy-win-hhea';
  }
  if (!Number.isFinite(lineHeightUnits) || lineHeightUnits <= 0) return null;

  return {
    unitsPerEm,
    lineHeightUnits,
    lineHeightMultiplier: lineHeightUnits / unitsPerEm,
    source,
  };
}
