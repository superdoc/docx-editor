import { describe, expect, it } from 'vite-plus/test';
import { parseSfntNaturalLineMetrics } from './natural-line-metrics';

type MetricFontOptions = {
  os2Version?: number;
  fsSelection?: number;
  unitsPerEm?: number;
  variableTable?: 'fvar' | 'MVAR';
};

function metricFont(options: MetricFontOptions = {}): Uint8Array {
  const tags = ['head', 'hhea', 'OS/2', ...(options.variableTable ? [options.variableTable] : [])];
  const tableLengths: Record<string, number> = { head: 54, hhea: 36, 'OS/2': 96, fvar: 4, MVAR: 4 };
  const directoryLength = 12 + tags.length * 16;
  const totalLength = directoryLength + tags.reduce((sum, tag) => sum + tableLengths[tag], 0);
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tags.length);
  let tableOffset = directoryLength;
  tags.forEach((tag, index) => {
    const record = 12 + index * 16;
    for (let char = 0; char < 4; char += 1) bytes[record + char] = tag.charCodeAt(char) || 0x20;
    view.setUint32(record + 8, tableOffset);
    view.setUint32(record + 12, tableLengths[tag]);
    if (tag === 'head') view.setUint16(tableOffset + 18, options.unitsPerEm ?? 2048);
    if (tag === 'hhea') {
      view.setInt16(tableOffset + 4, 1993);
      view.setInt16(tableOffset + 6, -588);
      view.setInt16(tableOffset + 8, 0);
    }
    if (tag === 'OS/2') {
      view.setUint16(tableOffset, options.os2Version ?? 3);
      view.setUint16(tableOffset + 62, options.fsSelection ?? 0);
      view.setInt16(tableOffset + 68, 1462);
      view.setInt16(tableOffset + 70, -586);
      view.setInt16(tableOffset + 72, 410);
      view.setUint16(tableOffset + 74, 1993);
      view.setUint16(tableOffset + 76, 588);
    }
    tableOffset += tableLengths[tag];
  });
  return bytes;
}

describe('parseSfntNaturalLineMetrics', () => {
  it('uses the legacy Windows/hhea pitch when USE_TYPO_METRICS is absent', () => {
    expect(parseSfntNaturalLineMetrics(metricFont())).toEqual({
      unitsPerEm: 2048,
      lineHeightUnits: 2581,
      lineHeightMultiplier: 2581 / 2048,
      source: 'legacy-win-hhea',
    });
  });

  it('uses OS/2 typographic metrics when a version that defines USE_TYPO_METRICS sets it', () => {
    expect(parseSfntNaturalLineMetrics(metricFont({ os2Version: 4, fsSelection: 1 << 7 }))).toEqual({
      unitsPerEm: 2048,
      lineHeightUnits: 2458,
      lineHeightMultiplier: 2458 / 2048,
      source: 'os2-typo',
    });
  });

  it('honors ArrayBufferView bounds and rejects malformed or unsupported fonts', () => {
    const font = metricFont();
    const padded = new Uint8Array(font.length + 12);
    padded.set(font, 8);
    expect(parseSfntNaturalLineMetrics(padded.subarray(8, 8 + font.length))?.lineHeightUnits).toBe(2581);
    expect(parseSfntNaturalLineMetrics(font.subarray(0, 40))).toBeNull();
    expect(parseSfntNaturalLineMetrics(new Uint8Array(12))).toBeNull();
    expect(parseSfntNaturalLineMetrics(metricFont({ variableTable: 'fvar' }))).toBeNull();
    expect(parseSfntNaturalLineMetrics(metricFont({ variableTable: 'MVAR' }))).toBeNull();
  });

  it('rejects non-SFNT containers and invalid units-per-em values', () => {
    for (const signature of [0x74746366, 0x774f4646, 0x774f4632]) {
      const bytes = new Uint8Array(12);
      new DataView(bytes.buffer).setUint32(0, signature);
      expect(parseSfntNaturalLineMetrics(bytes)).toBeNull();
    }
    expect(parseSfntNaturalLineMetrics(metricFont({ unitsPerEm: 0 }))).toBeNull();
    expect(parseSfntNaturalLineMetrics(metricFont({ unitsPerEm: 15 }))).toBeNull();
    expect(parseSfntNaturalLineMetrics(metricFont({ unitsPerEm: 16_385 }))).toBeNull();
  });
});
