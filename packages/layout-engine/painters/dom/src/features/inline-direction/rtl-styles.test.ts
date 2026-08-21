import { describe, it, expect } from 'vitest';
import { applyRtlStyles, resolveTextAlign } from './rtl-styles.js';

const el = () => document.createElement('p');
const rtlAttrs = { paragraphProperties: { rightToLeft: true } };
const ltrAttrs = { paragraphProperties: { rightToLeft: false } };
const unsetAttrs = { paragraphProperties: {} };

describe('applyRtlStyles direction mapping', () => {
  it('sets dir="rtl" and direction:rtl for explicit RTL', () => {
    const element = el();
    expect(applyRtlStyles(element, rtlAttrs as any)).toBe(true);
    expect(element.getAttribute('dir')).toBe('rtl');
    expect(element.style.direction).toBe('rtl');
  });

  it('sets dir="ltr" for explicit LTR', () => {
    const element = el();
    expect(applyRtlStyles(element, ltrAttrs as any)).toBe(false);
    expect(element.getAttribute('dir')).toBe('ltr');
    expect(element.style.direction).toBe('ltr');
  });

  it('sets dir="auto" for unset paragraphs (wrapper)', () => {
    const element = el();
    expect(applyRtlStyles(element, unsetAttrs as any)).toBe(false);
    expect(element.getAttribute('dir')).toBe('auto');
    expect(element.style.direction).toBe('');
  });

  it('inheritAuto: leaves dir unset for unset paragraphs (line inherits wrapper)', () => {
    const element = el();
    expect(applyRtlStyles(element, unsetAttrs as any, true)).toBe(false);
    expect(element.getAttribute('dir')).toBeNull();
    expect(element.style.direction).toBe('');
  });

  it('inheritAuto: still stamps explicit rtl/ltr on lines', () => {
    const r = el();
    applyRtlStyles(r, rtlAttrs as any, true);
    expect(r.getAttribute('dir')).toBe('rtl');
    const l = el();
    applyRtlStyles(l, ltrAttrs as any, true);
    expect(l.getAttribute('dir')).toBe('ltr');
  });
});

describe('resolveTextAlign with auto', () => {
  it('returns start for default alignment when direction is auto', () => {
    expect(resolveTextAlign(undefined, false, true)).toBe('start');
  });
  it('keeps explicit alignment under auto', () => {
    expect(resolveTextAlign('center', false, true)).toBe('center');
  });
  it('unchanged for explicit directions', () => {
    expect(resolveTextAlign('justify', true)).toBe('right');
    expect(resolveTextAlign('justify', false)).toBe('left');
  });
});
