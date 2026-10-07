/**
 * Comprehensive tests for table border utility functions
 *
 * Tests cover:
 * - applyBorder: Border application to DOM elements (tests borderStyleToCSS and isValidHexColor indirectly)
 * - applyCellBorders: Multi-side border application
 * - borderValueToSpec: TableBorderValue to BorderSpec conversion
 * - resolveTableBorderValue: Border value resolution with fallbacks
 * - resolveTableCellBorders: Cell-specific border resolution based on position
 * - createTableBorderOverlay: Border overlay element creation
 */

import { describe, it, expect, beforeEach } from 'vite-plus/test';
import type { BorderSpec, CellBorders, TableBorders, TableBorderValue, TableFragment } from '@superdoc/contracts';
import {
  applyBorder,
  applyCellBorders,
  borderValueToSpec,
  resolveTableBorderValue,
  resolveTableCellBorders,
  createTableBorderOverlay,
  hasExplicitCellBorders,
  swapTableBordersLR,
  swapCellBordersLR,
  resolveBorderConflict,
  createThinDoubleBorderOverlay,
  createCellBorderOverlay,
} from './border-utils.js';

describe('applyBorder', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
  });

  it('should apply border with single style (converts to solid)', () => {
    const border: BorderSpec = { style: 'single', width: 2, color: '#FF0000' };
    applyBorder(element, 'Top', border);
    // Browsers may normalize colors to rgb() format
    expect(element.style.borderTop).toMatch(/2px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i);
  });

  it('should apply border with double style', () => {
    const border: BorderSpec = { style: 'double', width: 3, color: '#FF0000' };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/3px double (#FF0000|rgb\(255,\s*0,\s*0\))/i);
  });

  it('keeps the authored thin-double component widths separate from screen-pixel rasterization', () => {
    const border: BorderSpec = { style: 'double', width: 2 / 3, color: '#FF0000' };

    applyBorder(element, 'Top', border);

    expect(element.style.borderTopWidth).toBe('0.666667px');
    expect(element.style.borderTopStyle).toBe('double');
    expect(element.style.borderTopColor).toBe('transparent');
    expect(element.dataset.superdocThinDoubleBorder).toBe('true');
    expect(element.style.getPropertyValue('--sd-table-double-top-color')).toBe('#FF0000');
    expect(element.style.getPropertyValue('--sd-table-double-top-stroke')).toBe('0.222222px');
    expect(element.style.getPropertyValue('--sd-table-double-top-offset')).toBe('0.444444px');
    expect(element.classList.contains('superdoc-thin-double-border')).toBe(true);
  });

  it('keeps authored thin-double geometry independent of display density', () => {
    const previousDevicePixelRatio = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });

    try {
      applyBorder(element, 'Top', { style: 'double', width: 2 / 3, color: '#FF0000' });

      expect(element.style.borderTopWidth).toBe('0.666667px');
      expect(element.style.getPropertyValue('--sd-table-double-top-stroke')).toBe('0.222222px');
      expect(element.style.getPropertyValue('--sd-table-double-top-offset')).toBe('0.444444px');
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: previousDevicePixelRatio,
      });
    }
  });

  it('removes only the replaced side from the thin double raster fallback', () => {
    applyBorder(element, 'Top', { style: 'double', width: 2 / 3, color: '#FF0000' });
    applyBorder(element, 'Right', { style: 'double', width: 2 / 3, color: '#00FF00' });

    applyBorder(element, 'Top', { style: 'single', width: 1, color: '#0000FF' });

    expect(element.style.borderTop).toMatch(/1px solid (#0000FF|rgb\(0,\s*0,\s*255\))/i);
    expect(element.style.getPropertyValue('--sd-table-double-top-color')).toBe('');
    expect(element.style.getPropertyValue('--sd-table-double-right-color')).toBe('#00FF00');
    expect(element.dataset.superdocThinDoubleBorder).toBe('true');
    expect(element.classList.contains('superdoc-thin-double-border')).toBe(true);

    applyBorder(element, 'Right', { style: 'none', width: 0 });

    expect(element.dataset.superdocThinDoubleBorder).toBeUndefined();
    expect(element.classList.contains('superdoc-thin-double-border')).toBe(false);
  });

  it('creates an unclipped two-stroke SVG overlay for each thin double side', () => {
    applyBorder(element, 'Top', { style: 'double', width: 2 / 3, color: '#FF0000' });
    applyBorder(element, 'Right', { style: 'double', width: 2 / 3, color: '#00FF00' });

    const overlay = createThinDoubleBorderOverlay(document, element, {
      left: '10px',
      top: '20px',
      width: '100px',
      height: '40px',
    });

    expect(overlay).not.toBeNull();
    expect(overlay!.dataset.superdocThinDoubleBorderOverlay).toBe('true');
    expect(overlay!.style.left).toBe('10px');
    expect(overlay!.style.top).toBe('20px');
    expect(overlay!.querySelectorAll('rect')).toHaveLength(4);
    expect(overlay!.querySelectorAll('rect[data-side="top"]')).toHaveLength(2);
    expect(overlay!.querySelectorAll('rect[data-side="right"]')).toHaveLength(2);
    expect(overlay!.querySelector('rect[data-side="top"][data-layer="outer"]')?.getAttribute('shape-rendering')).toBe(
      'crispEdges',
    );
    expect((overlay!.querySelector('rect[data-side="top"][data-layer="outer"]') as SVGRectElement).style.height).toBe(
      'var(--sd-table-double-top-paint-stroke)',
    );
    expect((overlay!.querySelector('rect[data-side="top"][data-layer="inner"]') as SVGRectElement).style.y).toBe(
      'var(--sd-table-double-top-paint-offset)',
    );
    expect(overlay!.style.getPropertyValue('--sd-table-double-top-paint-stroke')).toBe(
      'max(var(--sd-table-double-top-stroke), calc(1px * var(--sd-render-zoom-inverse, 1)))',
    );
    expect(overlay!.style.getPropertyValue('--sd-table-double-top-paint-offset')).toBe(
      'max(var(--sd-table-double-top-offset), calc(2px * var(--sd-render-zoom-inverse, 1)))',
    );
    expect(overlay!.style.getPropertyValue('--sd-table-double-top-color')).toBe('#FF0000');
    expect(overlay!.style.getPropertyValue('--sd-table-double-right-color')).toBe('#00FF00');
  });

  it('should apply border with dashed style', () => {
    const border: BorderSpec = { style: 'dashed', width: 1, color: '#00FF00' };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/1px dashed (#00FF00|rgb\(0,\s*255,\s*0\))/i);
  });

  it('paints dashSmallGap as a dashed CSS border', () => {
    applyBorder(element, 'Top', { style: 'dashSmallGap', width: 2 / 3, color: '#000000' });
    expect(element.style.borderTopStyle).toBe('dashed');
  });

  it('should apply border with dotted style', () => {
    const border: BorderSpec = { style: 'dotted', width: 1, color: '#0000FF' };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/1px dotted (#0000FF|rgb\(0,\s*0,\s*255\))/i);
  });

  it('should convert triple to solid CSS', () => {
    const border: BorderSpec = { style: 'triple', width: 2, color: '#FF0000' };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/2px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i);
  });

  it('should handle thick border with width multiplier', () => {
    const border: BorderSpec = { style: 'thick', width: 1, color: '#000000' };
    applyBorder(element, 'Top', border);
    // Thick borders use max(width * 2, 3)
    expect(element.style.borderTop).toMatch(/3px solid (#000000|rgb\(0,\s*0,\s*0\))/i);
  });

  it('should handle thick border with larger width', () => {
    const border: BorderSpec = { style: 'thick', width: 3, color: '#000000' };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/6px solid (#000000|rgb\(0,\s*0,\s*0\))/i);
  });

  it('should set border to none for none style', () => {
    const border: BorderSpec = { style: 'none', width: 2, color: '#FF0000' };
    applyBorder(element, 'Top', border);
    // Setting border to 'none' results in empty string or 'none' depending on browser
    expect(
      ['', 'none', 'medium', '0px'].includes(element.style.borderTop) || /none/i.test(element.style.borderTop),
    ).toBe(true);
  });

  it('should set border to none for zero width', () => {
    const border: BorderSpec = { style: 'single', width: 0, color: '#FF0000' };
    applyBorder(element, 'Top', border);
    // Setting border to 'none' results in empty string or 'none' depending on browser
    expect(
      ['', 'none', 'medium', '0px'].includes(element.style.borderTop) || /none/i.test(element.style.borderTop),
    ).toBe(true);
  });

  it('should sanitize invalid hex color to black', () => {
    const border: BorderSpec = { style: 'single', width: 1, color: 'invalid' };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/1px solid (#000000|rgb\(0,\s*0,\s*0\))/i);
  });

  it('should default width to 1 if missing', () => {
    const border: BorderSpec = { style: 'single', color: '#FF0000' };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/1px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i);
  });

  it('should default color to black if missing', () => {
    const border: BorderSpec = { style: 'single', width: 2 };
    applyBorder(element, 'Top', border);
    expect(element.style.borderTop).toMatch(/2px solid (#000000|rgb\(0,\s*0,\s*0\))/i);
  });

  it('should do nothing if border is undefined', () => {
    applyBorder(element, 'Top', undefined);
    expect(element.style.borderTop).toBe('');
  });

  it('should apply to all four sides', () => {
    const border: BorderSpec = { style: 'single', width: 1, color: '#FF0000' };
    applyBorder(element, 'Top', border);
    applyBorder(element, 'Right', border);
    applyBorder(element, 'Bottom', border);
    applyBorder(element, 'Left', border);
    const pattern = /1px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i;
    expect(element.style.borderTop).toMatch(pattern);
    expect(element.style.borderRight).toMatch(pattern);
    expect(element.style.borderBottom).toMatch(pattern);
    expect(element.style.borderLeft).toMatch(pattern);
  });
});

describe('applyCellBorders', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
  });

  it('should apply borders to all four sides', () => {
    const borders: CellBorders = {
      top: { style: 'single', width: 1, color: '#FF0000' },
      right: { style: 'single', width: 2, color: '#00FF00' },
      bottom: { style: 'single', width: 3, color: '#0000FF' },
      left: { style: 'single', width: 4, color: '#FFFF00' },
    };
    applyCellBorders(element, borders);
    expect(element.style.borderTop).toMatch(/1px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i);
    expect(element.style.borderRight).toMatch(/2px solid (#00FF00|rgb\(0,\s*255,\s*0\))/i);
    expect(element.style.borderBottom).toMatch(/3px solid (#0000FF|rgb\(0,\s*0,\s*255\))/i);
    expect(element.style.borderLeft).toMatch(/4px solid (#FFFF00|rgb\(255,\s*255,\s*0\))/i);
  });

  it('should handle partial border definitions', () => {
    const borders: CellBorders = {
      top: { style: 'single', width: 1, color: '#FF0000' },
      bottom: { style: 'single', width: 1, color: '#0000FF' },
    };
    applyCellBorders(element, borders);
    expect(element.style.borderTop).toMatch(/1px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i);
    expect(element.style.borderBottom).toMatch(/1px solid (#0000FF|rgb\(0,\s*0,\s*255\))/i);
    expect(element.style.borderRight).toBe('');
    expect(element.style.borderLeft).toBe('');
  });

  it('should do nothing if borders is undefined', () => {
    applyCellBorders(element, undefined);
    expect(element.style.borderTop).toBe('');
    expect(element.style.borderRight).toBe('');
    expect(element.style.borderBottom).toBe('');
    expect(element.style.borderLeft).toBe('');
  });

  it('keeps ordinary borders native and reserves advanced sides for SVG paint', () => {
    applyCellBorders(
      element,
      {
        top: { style: 'single', width: 1, color: '#000080' },
        bottom: { style: 'dashDotStroked', width: 2, color: '#000080' },
      },
      true,
    );
    expect(element.style.borderTopColor).not.toBe('transparent');
    expect(element.style.borderBottomWidth).toBe('2px');
    expect(element.style.borderBottomColor).toBe('transparent');
  });

  it('keeps the CSS fallback for callers without a cell SVG overlay', () => {
    applyCellBorders(element, { bottom: { style: 'dashDotStroked', width: 2, color: '#000080' } });
    expect(element.style.borderBottomColor).not.toBe('transparent');
  });
});

describe('createCellBorderOverlay', () => {
  const geometry = { left: '10px', top: '20px', width: 100, height: 40 };

  it('paints both diagonal directions at their authored width and color', () => {
    const overlay = createCellBorderOverlay(
      document,
      {
        tl2br: { style: 'single', width: 4 / 3, color: '#000080' },
        tr2bl: { style: 'single', width: 2 / 3, color: '#FF8000' },
      },
      geometry,
    )!;
    expect(overlay.style.left).toBe('10px');
    expect(overlay.style.top).toBe('20px');
    expect(overlay.querySelector('[data-side="tl2br"]')?.getAttribute('d')).toBe('M 0 0 L 100 40');
    expect(overlay.querySelector('[data-side="tr2bl"]')?.getAttribute('d')).toBe('M 100 0 L 0 40');
    expect(overlay.querySelector('[data-side="tl2br"]')?.getAttribute('stroke')).toBe('#000080');
    expect(overlay.querySelector('[data-side="tr2bl"]')?.getAttribute('stroke-width')).toBe(String(2 / 3));
  });

  it('paints diagonal dash, double, and wave styles distinctly', () => {
    const dashed = createCellBorderOverlay(document, { tl2br: { style: 'dashed', width: 2 } }, geometry)!;
    const doubled = createCellBorderOverlay(document, { tl2br: { style: 'double', width: 3 } }, geometry)!;
    const waved = createCellBorderOverlay(document, { tr2bl: { style: 'wave', width: 2 } }, geometry)!;
    const dotted = createCellBorderOverlay(document, { tl2br: { style: 'dotted', width: 2 } }, geometry)!;
    const tripled = createCellBorderOverlay(document, { tl2br: { style: 'triple', width: 3 } }, geometry)!;
    const doubleWaved = createCellBorderOverlay(document, { tr2bl: { style: 'doubleWave', width: 2 } }, geometry)!;
    expect(dashed.querySelector('[data-side="tl2br"]')?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(doubled.querySelectorAll('[data-side="tl2br"]')).toHaveLength(2);
    expect(
      new Set(Array.from(doubled.querySelectorAll('[data-side="tl2br"]'), (path) => path.getAttribute('d'))).size,
    ).toBe(2);
    expect(waved.querySelector('[data-side="tr2bl"]')?.getAttribute('d')).toContain(' Q ');
    expect(dotted.querySelector('[data-side="tl2br"]')?.getAttribute('stroke-linecap')).toBe('round');
    expect(tripled.querySelectorAll('[data-side="tl2br"]')).toHaveLength(3);
    expect(doubleWaved.querySelectorAll('[data-side="tr2bl"]')).toHaveLength(2);
  });

  it('paints advanced styles on their assigned edges with distinct patterns', () => {
    const overlay = createCellBorderOverlay(
      document,
      {
        top: { style: 'wave', width: 1, color: '#000080' },
        right: { style: 'dotDash', width: 1, color: '#FF8000' },
        bottom: { style: 'dashDotStroked', width: 2, color: '#000080' },
        left: { style: 'triple', width: 2 / 3, color: '#000080' },
      },
      geometry,
    )!;
    expect(overlay.querySelector('[data-side="top"] path')?.getAttribute('d')).toContain(' Q ');
    expect(overlay.querySelector('[data-side="right"] path')?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(overlay.querySelector('[data-side="bottom"] path')?.getAttribute('d')).toContain(' L ');
    expect(overlay.querySelectorAll('[data-side="left"] path')).toHaveLength(3);
    expect(overlay.querySelector('[data-side="right"] path')?.getAttribute('stroke')).toBe('#FF8000');
    expect(overlay.querySelector('[data-side="bottom"]')?.getAttribute('transform')).toContain('translate(0 38)');
    expect(overlay.querySelector('[data-side="bottom"] path')?.getAttribute('fill')).toBe('#000080');
  });

  it('keeps every dashDotStroked stripe within the edge length', () => {
    const overlay = createCellBorderOverlay(
      document,
      { top: { style: 'dashDotStroked', width: 2, color: '#000080' } },
      geometry,
    )!;
    const d = overlay.querySelector('[data-side="top"] path')?.getAttribute('d') ?? '';
    const xCoordinates = Array.from(d.matchAll(/[ML] (-?\d+(?:\.\d+)?) -?\d+(?:\.\d+)?/g), (match) => Number(match[1]));
    expect(xCoordinates.length).toBeGreaterThan(0);
    expect(Math.min(...xCoordinates)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xCoordinates)).toBeLessThanOrEqual(geometry.width);
  });

  it('does not add an overlay for ordinary or nil borders', () => {
    expect(
      createCellBorderOverlay(
        document,
        {
          top: { style: 'single', width: 1 },
          bottom: { style: 'none', width: 0 },
        },
        geometry,
      ),
    ).toBeNull();
  });
});

describe('borderValueToSpec', () => {
  it('should return undefined for null', () => {
    expect(borderValueToSpec(null)).toBeUndefined();
  });

  it('should return undefined for undefined', () => {
    expect(borderValueToSpec(undefined)).toBeUndefined();
  });

  it('should convert {none: true} to none style', () => {
    const result = borderValueToSpec({ none: true });
    expect(result).toEqual({ style: 'none', width: 0 });
  });

  it('should convert complete TableBorderValue', () => {
    const value: TableBorderValue = { style: 'single', width: 2, color: '#FF0000', space: 1 };
    const result = borderValueToSpec(value);
    expect(result).toEqual({ style: 'single', width: 2, color: '#FF0000', space: 1 });
  });

  it('should handle size property (legacy)', () => {
    const value = { size: 4, color: '#00FF00' } as unknown as TableBorderValue;
    const result = borderValueToSpec(value);
    expect(result).toEqual({ style: 'single', width: 4, color: '#00FF00' });
  });

  it('should prefer width over size', () => {
    const value = { width: 3, size: 5, color: '#0000FF' } as unknown as TableBorderValue;
    const result = borderValueToSpec(value);
    expect(result).toEqual({ style: 'single', width: 3, color: '#0000FF' });
  });

  it('should default style to single', () => {
    const value = { width: 2, color: '#FF0000' } as unknown as TableBorderValue;
    const result = borderValueToSpec(value);
    expect(result).toEqual({ style: 'single', width: 2, color: '#FF0000' });
  });
});

describe('resolveTableBorderValue', () => {
  it('should return explicit border if provided', () => {
    const explicit: TableBorderValue = { style: 'double', width: 4, color: '#FF0000' };
    const fallback: TableBorderValue = { style: 'single', width: 1, color: '#000000' };
    const result = resolveTableBorderValue(explicit, fallback);
    expect(result).toEqual({ style: 'double', width: 4, color: '#FF0000' });
  });

  it('should use fallback if explicit is undefined', () => {
    const fallback: TableBorderValue = { style: 'single', width: 1, color: '#000000' };
    const result = resolveTableBorderValue(undefined, fallback);
    expect(result).toEqual({ style: 'single', width: 1, color: '#000000' });
  });

  it('should use fallback if explicit is null', () => {
    const fallback: TableBorderValue = { style: 'single', width: 1, color: '#000000' };
    const result = resolveTableBorderValue(null, fallback);
    expect(result).toEqual({ style: 'single', width: 1, color: '#000000' });
  });

  it('should return undefined if both are undefined', () => {
    expect(resolveTableBorderValue(undefined, undefined)).toBeUndefined();
  });

  it('should handle {none: true} in explicit', () => {
    const explicit: TableBorderValue = { none: true };
    const fallback: TableBorderValue = { style: 'single', width: 1, color: '#000000' };
    const result = resolveTableBorderValue(explicit, fallback);
    expect(result).toEqual({ style: 'none', width: 0 });
  });
});

describe('hasExplicitCellBorders', () => {
  it('returns false for undefined', () => {
    expect(hasExplicitCellBorders(undefined)).toBe(false);
  });

  it('returns false when all sides are undefined', () => {
    expect(hasExplicitCellBorders({})).toBe(false);
  });

  it('returns true when at least one side is defined', () => {
    expect(hasExplicitCellBorders({ top: { style: 'single', width: 1 } })).toBe(true);
    expect(hasExplicitCellBorders({ right: { style: 'none', width: 0 } })).toBe(true);
    expect(hasExplicitCellBorders({ bottom: { style: 'single' } })).toBe(true);
    expect(hasExplicitCellBorders({ left: { style: 'double', width: 2, color: '#FF0000' } })).toBe(true);
  });

  it('returns true when all sides are defined', () => {
    expect(
      hasExplicitCellBorders({
        top: { style: 'single', width: 1 },
        right: { style: 'single', width: 1 },
        bottom: { style: 'single', width: 1 },
        left: { style: 'single', width: 1 },
      }),
    ).toBe(true);
  });
});

describe('resolveTableCellBorders', () => {
  // Tests use single-owner border model: each cell owns TOP and LEFT,
  // only edge cells (last row/col) own BOTTOM and RIGHT
  const tableBorders: TableBorders = {
    top: { style: 'single', width: 2, color: '#FF0000' },
    right: { style: 'single', width: 2, color: '#00FF00' },
    bottom: { style: 'single', width: 2, color: '#0000FF' },
    left: { style: 'single', width: 2, color: '#FFFF00' },
    insideH: { style: 'single', width: 1, color: '#888888' },
    insideV: { style: 'single', width: 1, color: '#CCCCCC' },
  };

  it('should use top/left borders for top-left corner cell (no bottom/right)', () => {
    // Cell (0,0) in 3x3: owns top and left, but NOT bottom/right (those come from adjacent cells)
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 0,
      rowSpan: 1,
      gridColumnStart: 0,
      colSpan: 1,
      totalRows: 3,
      totalCols: 3,
    });
    expect(result.top).toEqual({ style: 'single', width: 2, color: '#FF0000' });
    expect(result.left).toEqual({ style: 'single', width: 2, color: '#FFFF00' });
    expect(result.bottom).toBeUndefined(); // Not last row
    expect(result.right).toBeUndefined(); // Not last col
  });

  it('should use bottom/right borders for bottom-right corner cell', () => {
    // Cell (2,2) in 3x3: is last row AND last col, so owns all four borders
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 2,
      rowSpan: 1,
      gridColumnStart: 2,
      colSpan: 1,
      totalRows: 3,
      totalCols: 3,
    });
    expect(result.bottom).toEqual({ style: 'single', width: 2, color: '#0000FF' });
    expect(result.right).toEqual({ style: 'single', width: 2, color: '#00FF00' });
    expect(result.top).toEqual({ style: 'single', width: 1, color: '#888888' });
    expect(result.left).toEqual({ style: 'single', width: 1, color: '#CCCCCC' });
  });

  it('should use insideH/insideV for middle cells (no bottom/right)', () => {
    // Cell (1,1) in 3x3: interior cell owns only top and left (insideH/insideV)
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 1,
      rowSpan: 1,
      gridColumnStart: 1,
      colSpan: 1,
      totalRows: 3,
      totalCols: 3,
    });
    expect(result.top).toEqual({ style: 'single', width: 1, color: '#888888' });
    expect(result.bottom).toBeUndefined(); // Not last row - bottom comes from cell below
    expect(result.left).toEqual({ style: 'single', width: 1, color: '#CCCCCC' });
    expect(result.right).toBeUndefined(); // Not last col - right comes from cell to the right
  });

  it('should handle single row table (has both top and bottom)', () => {
    // Cell in single row table: is both first AND last row
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 0,
      rowSpan: 1,
      gridColumnStart: 1,
      colSpan: 1,
      totalRows: 1,
      totalCols: 3,
    });
    expect(result.top).toEqual({ style: 'single', width: 2, color: '#FF0000' });
    expect(result.bottom).toEqual({ style: 'single', width: 2, color: '#0000FF' });
    // Middle column - no right border
    expect(result.right).toBeUndefined();
  });

  it('should handle single column table (has both left and right)', () => {
    // Cell in single column table: is both first AND last column
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 1,
      rowSpan: 1,
      gridColumnStart: 0,
      colSpan: 1,
      totalRows: 3,
      totalCols: 1,
    });
    expect(result.left).toEqual({ style: 'single', width: 2, color: '#FFFF00' });
    expect(result.right).toEqual({ style: 'single', width: 2, color: '#00FF00' });
    // Middle row - no bottom border
    expect(result.bottom).toBeUndefined();
  });

  it('should give a spanning header cell the table right border when it reaches the last column', () => {
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 0,
      rowSpan: 1,
      gridColumnStart: 0,
      colSpan: 2,
      totalRows: 3,
      totalCols: 2,
    });

    expect(result.left).toEqual({ style: 'single', width: 2, color: '#FFFF00' });
    expect(result.right).toEqual({ style: 'single', width: 2, color: '#00FF00' });
  });

  it('should not give a spanning cell the right border when it does not reach the table edge', () => {
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 0,
      rowSpan: 1,
      gridColumnStart: 0,
      colSpan: 2,
      totalRows: 3,
      totalCols: 4,
    });

    expect(result.right).toBeUndefined();
  });

  it('should give a rowspan cell the table bottom border when it reaches the last row', () => {
    const result = resolveTableCellBorders(tableBorders, {
      rowIndex: 2,
      rowSpan: 2,
      gridColumnStart: 1,
      colSpan: 1,
      totalRows: 4,
      totalCols: 3,
    });

    expect(result.bottom).toEqual({ style: 'single', width: 2, color: '#0000FF' });
  });
});

describe('createTableBorderOverlay', () => {
  let doc: Document;
  let fragment: TableFragment;

  beforeEach(() => {
    doc = document;
    fragment = {
      kind: 'table',
      blockId: 'test-block',
      x: 0,
      y: 0,
      width: 500,
      height: 300,
      fromRow: 0,
      toRow: 3,
    };
  });

  it('should create overlay with table borders', () => {
    const tableBorders: TableBorders = {
      top: { style: 'single', width: 2, color: '#FF0000' },
      right: { style: 'single', width: 2, color: '#00FF00' },
      bottom: { style: 'single', width: 2, color: '#0000FF' },
      left: { style: 'single', width: 2, color: '#FFFF00' },
    };

    const overlay = createTableBorderOverlay(doc, fragment, tableBorders);
    expect(overlay).toBeTruthy();
    expect(overlay?.classList.contains('superdoc-table-border')).toBe(true);
    expect(overlay?.style.width).toBe('500px');
    expect(overlay?.style.height).toBe('300px');
    expect(overlay?.style.position).toBe('absolute');
    expect(overlay?.style.borderTop).toMatch(/2px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i);
    expect(overlay?.style.borderRight).toMatch(/2px solid (#00FF00|rgb\(0,\s*255,\s*0\))/i);
    expect(overlay?.style.borderBottom).toMatch(/2px solid (#0000FF|rgb\(0,\s*0,\s*255\))/i);
    expect(overlay?.style.borderLeft).toMatch(/2px solid (#FFFF00|rgb\(255,\s*255,\s*0\))/i);
  });

  it('should return null when no borders are defined', () => {
    const tableBorders: TableBorders = {};
    const overlay = createTableBorderOverlay(doc, fragment, tableBorders);
    expect(overlay).toBeNull();
  });

  it('should handle partial border definitions', () => {
    const tableBorders: TableBorders = {
      top: { style: 'single', width: 2, color: '#FF0000' },
      bottom: { style: 'single', width: 2, color: '#0000FF' },
    };

    const overlay = createTableBorderOverlay(doc, fragment, tableBorders);
    expect(overlay).toBeTruthy();
    expect(overlay?.style.borderTop).toMatch(/2px solid (#FF0000|rgb\(255,\s*0,\s*0\))/i);
    expect(overlay?.style.borderBottom).toMatch(/2px solid (#0000FF|rgb\(0,\s*0,\s*255\))/i);
  });

  it('should handle {none: true} borders', () => {
    const tableBorders: TableBorders = {
      top: { none: true },
      bottom: { style: 'single', width: 2, color: '#0000FF' },
    };

    const overlay = createTableBorderOverlay(doc, fragment, tableBorders);
    expect(overlay).toBeTruthy();
    expect(overlay?.style.borderBottom).toMatch(/2px solid (#0000FF|rgb\(0,\s*0,\s*255\))/i);
  });
});

describe('swapTableBordersLR', () => {
  it('swaps left and right borders', () => {
    const borders: TableBorders = {
      top: { style: 'single', width: 1, color: '#000000' },
      bottom: { style: 'single', width: 1, color: '#000000' },
      left: { style: 'thick', width: 3, color: '#0000FF' },
      right: { style: 'single', width: 0.5, color: '#FF0000' },
      insideH: { style: 'single', width: 1, color: '#111111' },
      insideV: { style: 'single', width: 1, color: '#222222' },
    };
    const swapped = swapTableBordersLR(borders)!;
    expect(swapped.left).toEqual(borders.right);
    expect(swapped.right).toEqual(borders.left);
    expect(swapped.top).toEqual(borders.top);
    expect(swapped.bottom).toEqual(borders.bottom);
    expect(swapped.insideH).toEqual(borders.insideH);
    expect(swapped.insideV).toEqual(borders.insideV);
  });

  it('returns undefined for undefined input', () => {
    expect(swapTableBordersLR(undefined)).toBeUndefined();
  });

  it('handles missing left or right', () => {
    const borders: TableBorders = { top: { style: 'single', width: 1, color: '#000' } };
    const swapped = swapTableBordersLR(borders)!;
    expect(swapped.left).toBeUndefined();
    expect(swapped.right).toBeUndefined();
  });
});

describe('swapCellBordersLR', () => {
  it('swaps left and right borders', () => {
    const borders: CellBorders = {
      top: { style: 'single', width: 1, color: '#000000' },
      bottom: { style: 'single', width: 1, color: '#000000' },
      left: { style: 'thick', width: 3, color: '#0000FF' },
      right: { style: 'single', width: 0.5, color: '#FF0000' },
    };
    const swapped = swapCellBordersLR(borders)!;
    expect(swapped.left).toEqual(borders.right);
    expect(swapped.right).toEqual(borders.left);
    expect(swapped.top).toEqual(borders.top);
    expect(swapped.bottom).toEqual(borders.bottom);
  });

  it('returns undefined for undefined input', () => {
    expect(swapCellBordersLR(undefined)).toBeUndefined();
  });
});

describe('resolveBorderConflict (ECMA-376 §17.4.66)', () => {
  const D9 = { style: 'single' as const, width: 1.333, color: '#BDD7EE' };

  it('collapses two identical borders to one (symmetric → no doubling)', () => {
    // The M&A checklist case: adjacent cells both specify the same border.
    const winner = resolveBorderConflict(D9, { ...D9 });
    expect(winner).toMatchObject({ style: 'single', color: '#BDD7EE' });
  });

  it('keeps the present border when the opposing side is none (asymmetric → no dropped border)', () => {
    // The it1007 case: header has a bottom border, the body cell below has no top.
    const headerBottom = { style: 'single' as const, width: 1, color: '#000000' };
    expect(resolveBorderConflict(undefined, headerBottom)).toEqual(headerBottom);
    expect(resolveBorderConflict({ style: 'none' }, headerBottom)).toEqual(headerBottom);
    expect(resolveBorderConflict(headerBottom, undefined)).toEqual(headerBottom);
  });

  it('returns undefined when neither side has a border', () => {
    expect(resolveBorderConflict(undefined, undefined)).toBeUndefined();
    expect(resolveBorderConflict({ style: 'none' }, { style: 'none' })).toBeUndefined();
    expect(resolveBorderConflict({ style: 'single', width: 0, color: '#000' }, undefined)).toBeUndefined();
  });

  it('the heavier-weight border wins (double over single)', () => {
    const single = { style: 'single' as const, width: 1, color: '#000000' };
    const dbl = { style: 'double' as const, width: 1, color: '#000000' };
    // weight: single = 1×1 = 1, double = 2×3 = 6 → double wins
    expect(resolveBorderConflict(single, dbl)).toEqual(dbl);
    expect(resolveBorderConflict(dbl, single)).toEqual(dbl);
  });

  it('on equal weight + identical style, the darker color wins', () => {
    const dark = { style: 'single' as const, width: 1, color: '#000000' };
    const light = { style: 'single' as const, width: 1, color: '#FFFFFF' };
    // brightness(R+B+2G): dark=0 < light=1020 → dark wins
    expect(resolveBorderConflict(light, dark)).toEqual(dark);
  });
});
