import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { convertMetafileToSvg } from './metafile-converter.js';
it('valid Dual TA_TOP retains bitmap artwork', () => {
  const dom = new JSDOM('');
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
  const bytes = readFileSync(new URL('../../../../../../tests/data/sd-5380-dual-header.emf', import.meta.url));
  let o = 88;
  while (bytes.readUInt32LE(o) !== 22) o += bytes.readUInt32LE(o + 4);
  bytes.writeUInt32LE(0, o + 8);
  const result = convertMetafileToSvg(bytes.toString('base64'), 'emf', { width: 300, height: 80 });
  expect(result).not.toBeNull();
  vi.unstubAllGlobals();
});

for (const [name, mutate] of [
  [
    'invalid alignment',
    (bytes) => {
      let offset = 88;
      while (bytes.readUInt32LE(offset) !== 22) offset += bytes.readUInt32LE(offset + 4);
      bytes.writeUInt32LE(255, offset + 8);
    },
  ],
  [
    'invalid mapping with unsupported alignment',
    (bytes) => {
      let offset = 88;
      while (bytes.readUInt32LE(offset) !== 22) offset += bytes.readUInt32LE(offset + 4);
      bytes.writeUInt32LE(0, offset + 8);
      const mapping = Buffer.alloc(16);
      mapping.writeUInt32LE(9, 0);
      mapping.writeUInt32LE(16, 4);
      mapping.writeInt32LE(0, 8);
      mapping.writeInt32LE(1, 12);
      const result = Buffer.concat([bytes.subarray(0, offset), mapping, bytes.subarray(offset)]);
      result.writeUInt32LE(result.length, 48);
      result.writeUInt32LE(bytes.readUInt32LE(52) + 1, 52);
      return result;
    },
  ],
]) {
  it(`Dual bitmap fallback does not mask ${name}`, () => {
    const dom = new JSDOM('');
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
    try {
      const bytes = readFileSync(new URL('../../../../../../tests/data/sd-5380-dual-header.emf', import.meta.url));
      const changed = mutate(bytes) ?? bytes;
      expect(convertMetafileToSvg(changed.toString('base64'), 'emf', { width: 300, height: 80 })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
}

for (const mode of ['invalid later alignment', 'invalid later mapping', 'invalid later text offset']) {
  it(mode + ' rejects even after earlier valid unsupported TA_TOP', () => {
    const dom = new JSDOM('');
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
    const fixture = readFileSync(new URL('../../../../../../tests/data/sd-5380-dual-header.emf', import.meta.url));
    const bytes = Buffer.from(fixture);
    bytes.writeUInt32LE(0, 764);
    const secondText = Buffer.from(bytes.subarray(768, 900));
    let extra;
    if (mode === 'invalid later alignment') {
      extra = Buffer.alloc(12);
      extra.writeUInt32LE(22, 0);
      extra.writeUInt32LE(12, 4);
      extra.writeUInt32LE(255, 8);
    } else if (mode === 'invalid later mapping') {
      extra = Buffer.alloc(16);
      extra.writeUInt32LE(9, 0);
      extra.writeUInt32LE(16, 4);
      extra.writeInt32LE(0, 8);
      extra.writeInt32LE(1, 12);
    } else {
      extra = Buffer.alloc(0);
      secondText.writeUInt32LE(0xfffffff0, 48);
    }
    const changed = Buffer.concat([bytes.subarray(0, 900), extra, secondText, bytes.subarray(900)]);
    changed.writeUInt32LE(changed.length, 48);
    changed.writeUInt32LE(bytes.readUInt32LE(52) + 1 + (extra.length ? 1 : 0), 52);
    expect(convertMetafileToSvg(changed.toString('base64'), 'emf')).toBeNull();
    vi.unstubAllGlobals();
  });
}

it('SD-5646 genuine WMF rectangle retains its WMF renderer', () => {
  const dom = new JSDOM('');
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
  try {
    const bytes = readFileSync(new URL('../../../../../../tests/data/sd-5646-rectangle.wmf', import.meta.url));
    const converted = convertMetafileToSvg(bytes.toString('base64'), 'wmf');
    expect(converted?.format).toBe('svg');
    expect(Buffer.from(converted.dataUri.split(',')[1], 'base64').toString()).toContain('<rect');
  } finally {
    vi.unstubAllGlobals();
  }
});
