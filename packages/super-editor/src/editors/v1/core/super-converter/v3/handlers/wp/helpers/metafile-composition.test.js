import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { convertMetafileToSvg } from './metafile-converter.js';

const original = readFileSync(new URL('../../../../../../tests/data/sd-5380-dual-header.emf', import.meta.url));
const convert = (bytes = original) => convertMetafileToSvg(bytes.toString('base64'), 'emf', { width: 300, height: 80 });
const svgDocument = (result) =>
  new JSDOM(Buffer.from(result.dataUri.split(',')[1], 'base64').toString(), { contentType: 'image/svg+xml' }).window
    .document;

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
