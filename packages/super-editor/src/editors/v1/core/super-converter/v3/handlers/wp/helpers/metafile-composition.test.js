import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { convertMetafileToSvg } from './metafile-converter.js';

const original = readFileSync(new URL('../../../../../../tests/data/sd-5380-dual-header.emf', import.meta.url));
const anisotropic = readFileSync(
  new URL('../../../../../../tests/data/sd-5380-anisotropic-header.emf', import.meta.url),
);
const convert = (bytes = original) => convertMetafileToSvg(bytes.toString('base64'), 'emf', { width: 300, height: 80 });
const svgDocument = (result) =>
  new JSDOM(Buffer.from(result.dataUri.split(',')[1], 'base64').toString(), { contentType: 'image/svg+xml' }).window
    .document;

const findRecord = (bytes, type) => {
  for (let offset = 88; offset + 8 <= bytes.length; offset += bytes.readUInt32LE(offset + 4)) {
    if (bytes.readUInt32LE(offset) === type) return offset;
  }
  throw new Error(`Missing fixture record ${type}`);
};
const mappedTextX = (text) => {
  const scale = Number(text.getAttribute('transform')?.match(/scale\(([^,]+),\s*1\)/)?.[1] ?? 1);
  return text
    .getAttribute('x')
    .split(' ')
    .map((x) => Number(x) * scale);
};

describe('SD-5380 complete EMF+ Dual composition', () => {
  beforeEach(() => {
    const dom = new JSDOM('');
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the placed logo and address instead of stretching an embedded bitmap', () => {
    const result = convert();
    expect(result?.format).toBe('svg');
    const svg = svgDocument(result);
    expect(svg.querySelector('text')?.textContent).toBe('TEST ROAD');
    expect(svg.querySelector('image')?.getAttribute('width')).toBe('50');
    expect(svg.querySelector('image')?.getAttribute('x')).toBe('10');
    expect(svg.querySelector('text')?.getAttribute('font-family')).toBe('Arial');
    expect(svg.querySelector('text')?.getAttribute('font-weight')).toBe('700');
  });

  it('uses the recorded character advances so the address remains legible', () => {
    const result = convert();
    expect(result?.format).toBe('svg');
    const text = svgDocument(result).querySelector('text');
    expect(text?.getAttribute('x')).toBe('90 110 130 150 170 190 210 230 250');
    expect(text?.getAttribute('y')).toBe('68');
  });

  it('fills the bitmap destination without SVG aspect-ratio padding', () => {
    const result = convert(anisotropic);
    expect(result?.format).toBe('svg');
    const image = svgDocument(result).querySelector('image');
    expect(image?.getAttribute('width')).toBe('37');
    expect(image?.getAttribute('height')).toBe('50');
    expect(image?.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('keeps character origins when horizontal glyph mapping changes', () => {
    const text = svgDocument(convert(anisotropic)).querySelector('text');
    mappedTextX(text).forEach((x, index) => expect(x).toBeCloseTo(Math.floor((90 + 18 * index) * 0.75), 8));
  });

  it('maps a no-advance string from its recorded origin', () => {
    const bytes = Buffer.from(anisotropic);
    bytes.writeUInt32LE(0, findRecord(bytes, 84) + 72);
    const text = svgDocument(convert(bytes)).querySelector('text');
    expect(mappedTextX(text)).toHaveLength(1);
    expect(mappedTextX(text)[0]).toBeCloseTo(67, 8);
    expect(text.getAttribute('y')).toBe('68');
  });

  it('preserves nonzero window and viewport origins', () => {
    const bytes = Buffer.from(anisotropic);
    const offset = findRecord(bytes, 84);
    const origins = Buffer.alloc(32);
    origins.writeUInt32LE(10, 0);
    origins.writeUInt32LE(16, 4);
    origins.writeInt32LE(10, 8);
    origins.writeInt32LE(10, 12);
    origins.writeUInt32LE(12, 16);
    origins.writeUInt32LE(16, 20);
    origins.writeInt32LE(5, 24);
    origins.writeInt32LE(7, 28);
    const mapped = Buffer.concat([bytes.subarray(0, offset), origins, bytes.subarray(offset)]);
    mapped.writeUInt32LE(mapped.length, 48);
    mapped.writeUInt32LE(mapped.readUInt32LE(52) + 2, 52);
    const text = svgDocument(convert(mapped)).querySelector('text');
    mappedTextX(text).forEach((x, index) => expect(x).toBeCloseTo(Math.floor((80 + 18 * index) * 0.75) + 5, 8));
    expect(text.getAttribute('y')).toBe('65');
  });

  it('fills classic bitmap destinations without opting into Unicode text', () => {
    const bytes = Buffer.from(anisotropic);
    for (let offset = 88; offset + 8 <= bytes.length; offset += bytes.readUInt32LE(offset + 4)) {
      if (bytes.readUInt32LE(offset) === 70) bytes.writeUInt32LE(0, offset + 12);
    }
    const svg = svgDocument(convert(bytes));
    expect(svg.querySelector('text')).toBeNull();
    expect(svg.querySelector('image').getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('keeps opaque background and clipping in device coordinates', () => {
    const bytes = Buffer.from(anisotropic);
    const offset = findRecord(bytes, 84);
    bytes.writeUInt32LE(6, offset + 52);
    bytes.writeInt32LE(80, offset + 56);
    bytes.writeInt32LE(40, offset + 60);
    bytes.writeInt32LE(280, offset + 64);
    bytes.writeInt32LE(75, offset + 68);
    const svg = svgDocument(convert(bytes));
    const background = svg.querySelector('svg > rect');
    expect(background.getAttribute('x')).toBe('60');
    expect(background.getAttribute('width')).toBe('150');
    expect(background.getAttribute('height')).toBe('35');
    const text = svg.querySelector('text');
    const scale = Number(text.getAttribute('transform')?.match(/scale\(([^,]+),\s*1\)/)?.[1] ?? 1);
    const clip = svg.querySelector('clipPath rect');
    expect(Number(clip.getAttribute('x')) * scale).toBeCloseTo(60, 8);
    expect(Number(clip.getAttribute('width')) * scale).toBeCloseTo(150, 8);
    expect(clip.getAttribute('y')).toBe('40');
  });

  it('rejects degenerate text mapping rather than emitting non-finite geometry', () => {
    const bytes = Buffer.from(anisotropic);
    bytes.writeInt32LE(0, findRecord(bytes, 9) + 8);
    expect(convert(bytes)).toBeNull();
  });

  it('preserves the existing bitmap path for EMF+ Only', () => {
    const bytes = Buffer.from(original);
    bytes.writeUInt16LE(0, 106); // EmfPlusHeader.Flags: clear Dual.
    expect(convert(bytes)?.format).toBe('png');
  });

  it('preserves classic EMF artwork outside the qualified Dual text path', () => {
    const bytes = Buffer.from(original);
    for (let record = 88; record + 8 <= bytes.length; record += bytes.readUInt32LE(record + 4)) {
      if (bytes.readUInt32LE(record) === 70) bytes.writeUInt32LE(0, record + 12);
    }
    let offset = 88;
    while (bytes.readUInt32LE(offset) !== 22) offset += bytes.readUInt32LE(offset + 4);
    bytes.writeUInt32LE(0, offset + 8); // TA_LEFT | TA_TOP, outside the new text scope.
    const result = convert(bytes);
    expect(result?.format).toBe('svg');
    expect(svgDocument(result).querySelector('image')?.getAttribute('width')).toBe('50');
  });

  it('rejects a dual stream with a text offset outside its own record', () => {
    const bytes = Buffer.from(original);
    let offset = 88;
    while (bytes.readUInt32LE(offset) !== 84) offset += bytes.readUInt32LE(offset + 4);
    bytes.writeUInt32LE(0xfffffff0, offset + 48);
    expect(convert(bytes)).toBeNull();
  });
});
