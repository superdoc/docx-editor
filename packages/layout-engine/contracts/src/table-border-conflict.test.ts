import { describe, expect, it } from 'vitest';

import { isExplicitNoneBorder, isPresentBorder, resolveBorderConflict } from './index.js';

describe('table border conflict contract', () => {
  it('selects the present side when the opposing cell explicitly has no border', () => {
    const present = { style: 'single' as const, width: 1, color: '#000000' };

    expect(resolveBorderConflict({ style: 'none', width: 0 }, present)).toEqual(present);
    expect(resolveBorderConflict(present, { style: 'none', width: 0 })).toEqual(present);
    expect(isExplicitNoneBorder({ none: true })).toBe(true);
    expect(isPresentBorder(present)).toBe(true);
  });

  it('uses ECMA-376 weight and color precedence for two visible cell borders', () => {
    const single = { style: 'single' as const, width: 1, color: '#000000' };
    const double = { style: 'double' as const, width: 1, color: '#FFFFFF' };

    expect(resolveBorderConflict(single, double)).toEqual(double);
    expect(
      resolveBorderConflict(
        { style: 'single', width: 1, color: '#FFFFFF' },
        { style: 'single', width: 1, color: '#000000' },
      ),
    ).toEqual({ style: 'single', width: 1, color: '#000000' });
  });

  it('uses authored width and Word border numbers for adjacent DOCX cell edges', () => {
    const blue = '#1F3864';
    const orange = '#E55A2A';
    const double = { style: 'double' as const, width: 1, color: blue }; // w:sz=6
    const dotDash = { style: 'dotDash' as const, width: 1, color: orange }; // w:sz=6
    const wideSingle = { style: 'single' as const, width: 3, color: blue }; // w:sz=18
    const thinSingle = { style: 'single' as const, width: 2 / 3, color: blue }; // w:sz=4
    const triple = { style: 'triple' as const, width: 2 / 3, color: blue }; // w:sz=4

    expect(resolveBorderConflict(double, dotDash)).toEqual(dotDash);
    expect(resolveBorderConflict(wideSingle, thinSingle)).toEqual(wideSingle);
    expect(resolveBorderConflict(triple, dotDash)).toEqual(dotDash);
    expect(resolveBorderConflict({ style: 'dashed', width: 3, color: blue }, thinSingle)).toEqual(thinSingle);
  });

  it('lets dashSmallGap beat a same-width single while ordinary dashed remains lower weight', () => {
    const single = { style: 'single' as const, width: 2 / 3, color: '#000000' };
    const smallGap = { style: 'dashSmallGap', width: 2 / 3, color: '#000000' } as const;
    expect(resolveBorderConflict(single, smallGap)).toEqual(smallGap);
    expect(resolveBorderConflict(single, { style: 'dashed', width: 2 / 3, color: '#000000' })).toEqual(single);
  });
});
