import { describe, it, expect } from 'vite-plus/test';
import type { Line, TabRun } from '@superdoc/contracts';
import {
  canPaintUnderlineAsBorder,
  canPaintUnderlineOverlay,
  renderInlineTabRun,
  renderPositionedTabRun,
  underlineBorderForRun,
  underlineOffsetFromLineTop,
} from './tab-run.js';

// A line with leading: lineHeight (24) exceeds ascent (12) + descent (4) by 8px.
// Adjacent text draws its `text-decoration` underline near the baseline, which
// sits at ascent + half-leading = 12 + 4 = 16px from the line-box top — well
// above the line-box bottom at 24px. SD-3330: a tab underline drawn at the
// line-box bottom lands ~8px below the text underline and the combined line
// looks broken. The tab underline must land in the baseline region instead.
const LINE: Line = {
  fromRun: 0,
  fromChar: 0,
  toRun: 0,
  toChar: 0,
  width: 200,
  ascent: 12,
  descent: 4,
  lineHeight: 24,
};

const underlinedTab = (fontSize?: number): TabRun =>
  ({
    kind: 'tab',
    text: '\t',
    width: 48,
    fontSize,
    underline: { style: 'single', color: '#000000' },
  }) as TabRun;

const plainTab = (): TabRun => ({ kind: 'tab', text: '\t', width: 48 });

describe('tab underline alignment (SD-3330)', () => {
  it('places underlined tabs near the measured baseline when fast remeasurement omits font metrics', () => {
    const fastLine = { ...LINE, ascent: 0, descent: 0 };
    const reference = underlineOffsetFromLineTop(LINE);
    const fallback = underlineOffsetFromLineTop(fastLine, 16);

    expect(fallback).toBeGreaterThan(LINE.lineHeight * 0.72);
    expect(Math.abs(fallback - reference)).toBeLessThan(1);
    expect(parseFloat(renderInlineTabRun(underlinedTab(16), fastLine, document, 0).style.height)).toBeCloseTo(fallback);
    expect(
      parseFloat(renderPositionedTabRun(underlinedTab(16), fastLine, document, 0, 0, 0).element.style.height),
    ).toBeCloseTo(fallback);
  });

  it('anchors the inline tab underline to the baseline region, not the line-box bottom', () => {
    const el = renderInlineTabRun(underlinedTab(), LINE, document, 0);

    // Border-bottom (not a selectable text-decoration filler) at the box bottom; the box
    // top is pinned to the line-box top and ends at the underline offset, so the border
    // lands near the baseline rather than the line-box bottom.
    expect(el.style.borderBottom).toContain('solid');
    expect(el.style.verticalAlign).toBe('top');
    const offset = parseFloat(el.style.height);
    expect(offset).toBeGreaterThanOrEqual(LINE.ascent);
    expect(offset).toBeLessThan(LINE.lineHeight);
  });

  it('matches the tab underline weight to the text underline (shared font-scaled thickness)', () => {
    const el = renderInlineTabRun(underlinedTab(48), LINE, document, 0);
    // 48 / 14 rounds to 3px — the same value applyRunStyles sets on text-decoration-thickness.
    expect(parseFloat(el.style.borderBottomWidth)).toBe(3);
  });

  it('anchors the positioned tab underline to the baseline region, not the line-box bottom', () => {
    const { element } = renderPositionedTabRun(underlinedTab(), LINE, document, 0, 0, 0);

    expect(element.style.borderBottom).toContain('solid');
    expect(element.style.visibility).not.toBe('hidden');
    const offset = parseFloat(element.style.height);
    expect(offset).toBeGreaterThanOrEqual(LINE.ascent);
    expect(offset).toBeLessThan(LINE.lineHeight);
  });

  it('does not draw a border on a plain (non-underlined) inline tab', () => {
    const el = renderInlineTabRun(plainTab(), LINE, document, 0);
    expect(el.style.borderBottom).toBe('');
    expect(el.style.height).toBe(`${LINE.lineHeight}px`);
    expect(el.style.verticalAlign).toBe('bottom');
  });

  it('keeps a plain positioned tab invisible with no border', () => {
    const { element } = renderPositionedTabRun(plainTab(), LINE, document, 0, 0, 0);
    expect(element.classList.contains('superdoc-tab')).toBe(true);
    expect(element.style.visibility).toBe('hidden');
    expect(element.style.borderBottom).toBe('');
  });
});

describe('vanished tab rendering', () => {
  it('renders hidden tabs as zero-width addressable spans with no underline', () => {
    const tab = {
      ...underlinedTab(),
      vanish: true,
      pmStart: 10,
      pmEnd: 11,
    } as TabRun;

    const el = renderInlineTabRun(tab, LINE, document, 0, undefined, true, 200);

    expect(el.style.width).toBe('0px');
    expect(el.style.height).toBe('0px');
    expect(el.style.borderBottom).toBe('');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.dataset.pmStart).toBe('10');
    expect(el.dataset.pmEnd).toBe('11');
  });

  it('renders positioned hidden tabs without advancing the tab boundary', () => {
    const tab = {
      ...underlinedTab(),
      vanish: true,
      pmStart: 10,
      pmEnd: 11,
    } as TabRun;

    const result = renderPositionedTabRun(tab, LINE, document, 0, 20, 5);

    expect(result.actualTabWidth).toBe(0);
    expect(result.tabEndX).toBe(20);
    expect(result.element.style.left).toBe('25px');
    expect(result.element.style.width).toBe('0px');
    expect(result.element.style.borderBottom).toBe('');
    expect(result.element.getAttribute('aria-hidden')).toBe('true');
    expect(result.element.dataset.pmStart).toBe('10');
    expect(result.element.dataset.pmEnd).toBe('11');
  });
});

const withStyle = (style: string) => ({ underline: { style } });

// SD-3330: the line-level underline overlay is intentionally scoped to the styles a single CSS
// border-top reproduces. These guards stop a future change from quietly widening the allowlist
// (which would flatten a wavy/heavy style to solid inside a "continuous" line) or narrowing it.
describe('canPaintUnderlineOverlay - overlay scope', () => {
  it('accepts the styles a border-top reproduces', () => {
    for (const style of ['single', 'double', 'dotted', 'dashed']) {
      expect(canPaintUnderlineOverlay(withStyle(style))).toBe(true);
    }
  });

  it('defaults a missing style to single and accepts it', () => {
    expect(canPaintUnderlineOverlay({ underline: {} })).toBe(true);
  });

  it('rejects styles a border-top cannot draw, leaving them on the per-run path', () => {
    for (const style of [
      'words',
      'none',
      'wave',
      'thick',
      'dotDash',
      'dotDotDash',
      'dashLong',
      'dashLongHeavy',
      'wavyDouble',
    ]) {
      expect(canPaintUnderlineOverlay(withStyle(style))).toBe(false);
    }
  });

  it('rejects a run with no underline', () => {
    expect(canPaintUnderlineOverlay({ underline: undefined })).toBe(false);
    expect(canPaintUnderlineOverlay({})).toBe(false);
  });

  // wave/heavy still get a (degraded, solid-ish) border on the legacy per-run path - the overlay
  // simply does not own them. words/none paint no border on either path.
  it('keeps wave on the border path while excluding it from the overlay', () => {
    expect(canPaintUnderlineAsBorder(withStyle('wave'))).toBe(true);
    expect(canPaintUnderlineOverlay(withStyle('wave'))).toBe(false);
    expect(canPaintUnderlineAsBorder(withStyle('words'))).toBe(false);
    expect(canPaintUnderlineAsBorder(withStyle('none'))).toBe(false);
  });
});

// SD-3347: tab width must be reliable on initial render, before any re-render triggered by
// editing. run.width is set as a side-effect mutation during measuring, but when FlowBlock
// re-projection creates fresh run objects and the measuring cache returns a hit, run.width is
// never re-set. The caller pre-resolves the width from Line.tabWidths (keyed by block.runs
// index, which is stable across pmStart shifts) and passes it as tabWidthFromCache.
describe('tab width source priority (SD-3347)', () => {
  it('uses the measured width for a frozen trailing positioned tab', () => {
    const tab = Object.freeze({ kind: 'tab', text: '\t' }) as TabRun;
    const result = renderPositionedTabRun(tab, LINE, document, 0, 8, 0, undefined, undefined, true, 37);
    expect(result.element.style.width).toBe('37px');
    expect(result.tabEndX).toBe(45);
  });

  it('prefers the measured width over a previous positioned tab stamp', () => {
    const tab = { kind: 'tab', text: '\t', width: 48 } as TabRun;
    const result = renderPositionedTabRun(tab, LINE, document, 0, 8, 0, undefined, undefined, true, 37);
    expect(result.actualTabWidth).toBe(37);
  });

  it('uses tabWidthFromCache when run.width is absent (cache-hit scenario)', () => {
    const tab = { kind: 'tab', text: '\t' } as TabRun;
    const el = renderInlineTabRun(tab, LINE, document, 0, undefined, true, 200);
    expect(el.style.width).toBe('200px');
  });

  it('prefers tabWidthFromCache over run.width when both are present', () => {
    const tab = { kind: 'tab', text: '\t', width: 48 } as TabRun;
    const el = renderInlineTabRun(tab, LINE, document, 0, undefined, true, 200);
    expect(el.style.width).toBe('200px');
  });

  it('falls back to run.width when tabWidthFromCache is absent', () => {
    const tab = { kind: 'tab', text: '\t', width: 150 } as TabRun;
    const el = renderInlineTabRun(tab, LINE, document, 0);
    expect(el.style.width).toBe('150px');
  });

  it('falls back to 48px when neither tabWidthFromCache nor run.width is set', () => {
    const tab = { kind: 'tab', text: '\t' } as TabRun;
    const el = renderInlineTabRun(tab, LINE, document, 0);
    expect(el.style.width).toBe('48px');
  });

  it('renders an underlined tab with correct width and border when tabWidthFromCache is supplied', () => {
    const tab = { kind: 'tab', text: '\t', underline: { style: 'single' } } as TabRun;
    const el = renderInlineTabRun(tab, LINE, document, 0, undefined, true, 300);
    expect(el.style.width).toBe('300px');
    expect(el.style.borderBottom).toContain('solid');
  });
});

describe('underlineBorderForRun - style and color', () => {
  it('paints no border for none/words', () => {
    expect(underlineBorderForRun(withStyle('none'))).toBeUndefined();
    expect(underlineBorderForRun(withStyle('words'))).toBeUndefined();
  });

  it('maps each overlay style to the matching border style', () => {
    expect(underlineBorderForRun(withStyle('single'))).toContain('solid');
    expect(underlineBorderForRun(withStyle('double'))).toContain('double');
    expect(underlineBorderForRun(withStyle('dotted'))).toContain('dotted');
    expect(underlineBorderForRun(withStyle('dashed'))).toContain('dashed');
  });

  it('uses the literal underline color without resolving theme tokens', () => {
    expect(underlineBorderForRun({ underline: { style: 'single', color: '#FF0000' } })).toContain('#FF0000');
  });
});
