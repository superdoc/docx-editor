import { describe, it, expect } from 'vitest';
import { clampMenuPositionToBounds, resolveMenuBounds } from '../menu-position.js';

const viewport = { left: 0, top: 0, right: 1000, bottom: 800 };

describe('clampMenuPositionToBounds', () => {
  it('shifts left when the menu overflows the right edge', () => {
    const rect = { left: 900, top: 100, right: 1100, bottom: 300 };
    expect(clampMenuPositionToBounds({ left: '900px', top: '100px' }, rect, viewport)).toEqual({
      left: '792px',
      top: '100px',
    });
  });

  it('shifts up when the menu overflows the bottom edge', () => {
    const rect = { left: 100, top: 700, right: 300, bottom: 900 };
    expect(clampMenuPositionToBounds({ left: '100px', top: '700px' }, rect, viewport)).toEqual({
      left: '100px',
      top: '592px',
    });
  });

  it('shifts back when the menu is off the left/top edge', () => {
    const rect = { left: -20, top: -10, right: 180, bottom: 190 };
    expect(clampMenuPositionToBounds({ left: '-20px', top: '-10px' }, rect, viewport)).toEqual({
      left: '8px',
      top: '8px',
    });
  });

  it('leaves a fully in-bounds menu unchanged', () => {
    const rect = { left: 100, top: 100, right: 300, bottom: 300 };
    expect(clampMenuPositionToBounds({ left: '100px', top: '100px' }, rect, viewport)).toEqual({
      left: '100px',
      top: '100px',
    });
  });

  it('clears the scroll container scrollbar (bounds narrower than viewport)', () => {
    // Bounds right 985 (15px scrollbar): a menu at right 990 shifts to bounds.right - gutter = 977.
    const bounds = { left: 0, top: 0, right: 985, bottom: 760 };
    const rect = { left: 810, top: 100, right: 990, bottom: 300 };
    expect(clampMenuPositionToBounds({ left: '810px', top: '100px' }, rect, bounds)).toEqual({
      left: '797px',
      top: '100px',
    });
  });

  it('renders as-is on an axis where the menu is larger than the bounds', () => {
    // 200x320 menu cannot fit in 180x240 bounds; shifting would only trade edges, so leave it.
    const bounds = { left: 0, top: 0, right: 180, bottom: 240 };
    const rect = { left: 40, top: 30, right: 240, bottom: 350 };
    expect(clampMenuPositionToBounds({ left: '40px', top: '30px' }, rect, bounds)).toEqual({
      left: '40px',
      top: '30px',
    });
  });

  it('uses a smaller gutter when the menu only fits within the full bounds', () => {
    const bounds = { left: 0, top: 0, right: 200, bottom: 300 };
    const rect = { left: 20, top: 20, right: 205, bottom: 120 };
    expect(clampMenuPositionToBounds({ left: '20px', top: '20px' }, rect, bounds)).toEqual({
      left: '7.5px',
      top: '20px',
    });
  });
});

describe('resolveMenuBounds', () => {
  const makeView = (clientW, clientH, computed) => ({
    document: { documentElement: { clientWidth: clientW, clientHeight: clientH } },
    getComputedStyle: (el) => computed.get(el) ?? { overflowX: 'visible', overflowY: 'visible' },
  });

  it('returns the viewport when there is no clipping ancestor', () => {
    const el = { parentElement: null };
    const view = makeView(1000, 800, new Map());
    expect(resolveMenuBounds(el, view)).toEqual({ left: 0, top: 0, right: 1000, bottom: 800 });
  });

  it('intersects with the scroll container content box (excludes its scrollbar)', () => {
    const scroller = {
      parentElement: null,
      clientWidth: 985, // 15px vertical scrollbar
      clientHeight: 445,
      clientLeft: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ left: 0, top: 315 }),
    };
    const anchor = { parentElement: scroller };
    const computed = new Map([
      [anchor, { overflowX: 'visible', overflowY: 'visible' }],
      [scroller, { overflowX: 'hidden', overflowY: 'auto' }],
    ]);
    const view = makeView(1000, 760, computed);
    expect(resolveMenuBounds(anchor, view)).toEqual({ left: 0, top: 315, right: 985, bottom: 760 });
  });

  it('intersects every clipping ancestor', () => {
    const outer = {
      parentElement: null,
      clientWidth: 580,
      clientHeight: 500,
      clientLeft: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ left: 20, top: 100 }),
    };
    const inner = {
      parentElement: outer,
      clientWidth: 700,
      clientHeight: 430,
      clientLeft: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ left: 80, top: 150 }),
    };
    const anchor = { parentElement: inner };
    const computed = new Map([
      [anchor, { overflowX: 'visible', overflowY: 'visible' }],
      [inner, { overflowX: 'auto', overflowY: 'auto' }],
      [outer, { overflowX: 'hidden', overflowY: 'hidden' }],
    ]);
    const view = makeView(1000, 760, computed);

    expect(resolveMenuBounds(anchor, view)).toEqual({ left: 80, top: 150, right: 600, bottom: 580 });
  });

  it('clips each axis independently', () => {
    const clipX = {
      parentElement: null,
      clientWidth: 500,
      clientHeight: 300,
      clientLeft: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ left: 20, top: 100 }),
    };
    const anchor = { parentElement: clipX };
    const computed = new Map([
      [anchor, { overflowX: 'visible', overflowY: 'visible' }],
      [clipX, { overflowX: 'hidden', overflowY: 'visible' }],
    ]);
    const view = makeView(1000, 760, computed);

    expect(resolveMenuBounds(anchor, view)).toEqual({ left: 20, top: 0, right: 520, bottom: 760 });
  });

  it('uses the clipping ancestor content box inside its border', () => {
    const clipper = {
      parentElement: null,
      clientWidth: 500,
      clientHeight: 300,
      clientLeft: 4,
      clientTop: 6,
      getBoundingClientRect: () => ({ left: 20, top: 100 }),
    };
    const anchor = { parentElement: clipper };
    const computed = new Map([
      [anchor, { overflowX: 'visible', overflowY: 'visible' }],
      [clipper, { overflowX: 'clip', overflowY: 'clip' }],
    ]);
    const view = makeView(1000, 760, computed);

    expect(resolveMenuBounds(anchor, view)).toEqual({ left: 24, top: 106, right: 524, bottom: 406 });
  });
});
