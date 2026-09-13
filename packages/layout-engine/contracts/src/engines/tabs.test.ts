import { describe, expect, it } from 'vite-plus/test';
import { calculateTabWidth, computeTabStops, layoutWithTabs } from './tabs.js';

describe('engines-tabs computeTabStops', () => {
  it('merges explicit and default stops and filters by indent', () => {
    const stops = computeTabStops({
      explicitStops: [
        { val: 'start', pos: 720, leader: 'none' }, // 720 twips = 0.5"
        { val: 'end', pos: 1440, leader: 'dot' }, // 1440 twips = 1"
      ],
      defaultTabInterval: 720, // 0.5 inch in twips
      paragraphIndent: { left: 360 }, // 0.25 inch in twips
    });

    expect(stops[0].pos).toBeGreaterThanOrEqual(360);
    expect(stops.find((stop) => stop.pos === 1440)?.val).toBe('end');
    expect(stops.find((stop) => stop.pos === 1440)?.source).toBe('explicit');
  });

  it('filters out clear tabs', () => {
    const stops = computeTabStops({
      explicitStops: [
        { val: 'start', pos: 720, leader: 'none' },
        { val: 'clear', pos: 1440, leader: 'none' }, // Should be filtered
        { val: 'decimal', pos: 2160, leader: 'dot' },
      ],
      defaultTabInterval: 720,
      paragraphIndent: { left: 0 },
    });

    expect(stops.find((stop) => stop.val === 'clear')).toBeUndefined();
    expect(stops.find((stop) => stop.pos === 720)).toBeDefined();
    expect(stops.find((stop) => stop.pos === 2160)).toBeDefined();
  });

  it('clear tabs suppress default stops within 20 twips tolerance', () => {
    // OOXML spec: clear tab at 1440 should prevent default stop from being generated there
    const stops = computeTabStops({
      explicitStops: [
        { val: 'clear', pos: 1440, leader: 'none' }, // Clear at 1440 (1.0")
      ],
      defaultTabInterval: 720, // Default every 720 twips (0.5")
      paragraphIndent: { left: 0 },
    });

    // Should have default stops at 720, 2160, 2880, etc. but NOT at 1440
    expect(stops.find((stop) => Math.abs(stop.pos - 720) < 20)).toBeDefined(); // 0.5"
    expect(stops.find((stop) => Math.abs(stop.pos - 1440) < 20)).toBeUndefined(); // 1.0" CLEARED
    expect(stops.find((stop) => Math.abs(stop.pos - 2160) < 20)).toBeDefined(); // 1.5"
  });

  it('clear tabs suppress stops within tolerance even with slight offset', () => {
    // Clear at 1438 should suppress default at 1440 (within 20 twips tolerance)
    const stops = computeTabStops({
      explicitStops: [
        { val: 'clear', pos: 1438, leader: 'none' }, // 2 twips off
      ],
      defaultTabInterval: 720,
      paragraphIndent: { left: 0 },
    });

    // Default at 1440 should be suppressed due to clear at 1438 (within 20 twips)
    expect(stops.find((stop) => Math.abs(stop.pos - 1440) < 20)).toBeUndefined();
  });

  it('adds default tabs with start alignment', () => {
    const stops = computeTabStops({
      explicitStops: [],
      defaultTabInterval: 720,
      paragraphIndent: { left: 0 },
    });

    const firstDefault = stops.find((stop) => stop.pos === 720);
    expect(firstDefault?.val).toBe('start');
    expect(firstDefault?.leader).toBe('none');
    expect(firstDefault?.source).toBe('default');
  });

  it.each([
    { label: 'positive', defaultTabInterval: 720 },
    { label: 'zero', defaultTabInterval: 0 },
    { label: 'negative', defaultTabInterval: -720 },
    { label: 'NaN', defaultTabInterval: Number.NaN },
    { label: 'infinite', defaultTabInterval: Number.POSITIVE_INFINITY },
  ])('uses the 720-twip grid for a $label interval', ({ defaultTabInterval }) => {
    const stops = computeTabStops({
      explicitStops: [
        { val: 'start', pos: 720, leader: 'none' },
        { val: 'clear', pos: 1440, leader: 'none' },
      ],
      defaultTabInterval,
      paragraphIndent: { left: 0 },
    });

    expect(stops.find((stop) => stop.pos === 720)).toEqual({
      val: 'start',
      pos: 720,
      leader: 'none',
      source: 'explicit',
    });
    expect(stops.find((stop) => stop.pos === 1440)).toBeUndefined();
    expect(stops.find((stop) => stop.pos === 2160)).toEqual({
      val: 'start',
      pos: 2160,
      leader: 'none',
      source: 'default',
    });
  });

  it('adds an implicit left-margin stop when hanging indent starts before the margin', () => {
    const stops = computeTabStops({
      explicitStops: [{ val: 'start', pos: -1440, leader: 'none' }],
      defaultTabInterval: 720,
      paragraphIndent: { left: 0, hanging: 567 },
    });

    expect(stops[0]).toEqual({ val: 'start', pos: 0, leader: 'none', source: 'default' });
    expect(stops.find((stop) => stop.pos === 720)).toBeDefined();
  });

  it.each([
    {
      label: 'with explicit negative tab stop',
      explicitStops: [{ val: 'start' as const, pos: -1440, leader: 'none' as const }],
    },
    { label: 'without explicit tab stops', explicitStops: [] },
  ])('adds an implicit left-indent stop for hanging indent paragraphs $label', ({ explicitStops }) => {
    const stops = computeTabStops({
      explicitStops,
      defaultTabInterval: 720,
      paragraphIndent: { left: -600, hanging: 141 },
    });

    expect(stops[0]).toEqual({ val: 'start', pos: 0, leader: 'none', source: 'default' });
    expect(stops[1]).toEqual({ val: 'start', pos: 600, leader: 'none', source: 'default' });
    expect(stops.find((stop) => stop.pos === 720)).toBeDefined();
  });

  it('adds the implicit zero stop without adding a left-indent stop for negative left indent paragraphs', () => {
    const stops = computeTabStops({
      explicitStops: [{ val: 'start', pos: -1440, leader: 'none' }],
      defaultTabInterval: 720,
      paragraphIndent: { left: -567, hanging: 0 },
    });

    expect(stops[0]).toEqual({ val: 'start', pos: 0, leader: 'none', source: 'default' });
    expect(stops.find((stop) => stop.pos === 567)).toBeUndefined();
    expect(stops.find((stop) => stop.pos === 720)).toBeDefined();
  });

  it('uses raw negative indent for implicit stops while keeping normalized indent for defaults', () => {
    const stops = computeTabStops({
      explicitStops: [{ val: 'start', pos: -1440, leader: 'none' }],
      defaultTabInterval: 720,
      paragraphIndent: { left: 0, hanging: 0 },
      rawParagraphIndent: { left: -567, hanging: 0 },
    });

    expect(stops[0]).toEqual({ val: 'start', pos: 0, leader: 'none', source: 'default' });
    expect(stops.find((stop) => stop.pos === 567)).toBeUndefined();
    expect(stops.find((stop) => stop.pos === 720)).toBeDefined();
  });

  it('preserves tab stops between (left - hanging) and left when hanging indent exists', () => {
    // SD-1472 regression: When left=709 and hanging=709, the first line starts at 0.
    // Tab stops at 340 (between 0 and 709) should be preserved for first-line use.
    const stops = computeTabStops({
      explicitStops: [
        { val: 'start', pos: 340, leader: 'none' },
        { val: 'start', pos: 709, leader: 'none' },
      ],
      defaultTabInterval: 720,
      paragraphIndent: { left: 709, hanging: 709 },
    });

    // Tab at 340 should NOT be filtered out (it's valid for first line starting at 0)
    expect(stops.find((stop) => stop.pos === 340)).toBeDefined();
    expect(stops.find((stop) => stop.pos === 709)).toBeDefined();
  });

  it('filters tab stops before effective first-line indent with partial hanging', () => {
    // With left=500 and hanging=200, first line starts at 300.
    // Tab stops at 200 (before 300) should be filtered out.
    const stops = computeTabStops({
      explicitStops: [
        { val: 'start', pos: 200, leader: 'none' }, // Before effective indent, should be filtered
        { val: 'start', pos: 400, leader: 'none' }, // After effective indent, should be kept
      ],
      defaultTabInterval: 720,
      paragraphIndent: { left: 500, hanging: 200 },
    });

    // Tab at 200 should be filtered (200 < 300 effective indent)
    expect(stops.find((stop) => stop.pos === 200)).toBeUndefined();
    // Tab at 400 should be kept (400 >= 300 effective indent)
    expect(stops.find((stop) => stop.pos === 400)).toBeDefined();
  });

  it('handles hanging indent larger than left indent gracefully', () => {
    // Edge case: hanging > left, effective indent would be negative, clamped to 0
    const stops = computeTabStops({
      explicitStops: [
        { val: 'start', pos: 100, leader: 'none' },
        { val: 'start', pos: 500, leader: 'none' },
      ],
      defaultTabInterval: 720,
      paragraphIndent: { left: 200, hanging: 400 }, // effective = max(0, 200-400) = 0
    });

    // Both stops should be preserved since effective min indent is 0
    expect(stops.find((stop) => stop.pos === 100)).toBeDefined();
    expect(stops.find((stop) => stop.pos === 500)).toBeDefined();
  });

  it('default tabs respect leftIndent even with hanging indent (no explicit stops)', () => {
    // Regression test: When there are no explicit stops, default tabs should be filtered
    // by leftIndent, not effectiveMinIndent (0).
    // This ensures "$100" in "Purchase Price Per Share <tab> $100..." aligns correctly.
    const stops = computeTabStops({
      explicitStops: [], // No explicit stops - relies on defaults
      defaultTabInterval: 720,
      paragraphIndent: { left: 3600, hanging: 3600 }, // effective = 0, but defaults respect leftIndent
    });

    // Default stops are generated at 720, 1440, ..., 3600, 4320, ...
    // But filtered to only include those >= leftIndent (3600)
    // So first default is at 3600 (which happens to be a multiple of 720)
    const firstStop = stops[0];
    expect(firstStop.pos).toBe(3600); // First multiple of 720 >= leftIndent
    expect(stops.find((stop) => stop.pos === 720)).toBeUndefined(); // No stop at 720
    expect(stops.find((stop) => stop.pos === 1440)).toBeUndefined(); // No stop at 1440
    expect(stops.find((stop) => stop.pos === 4320)).toBeDefined(); // Second default at 4320
  });

  it('adds an implicit stop at the hanging-indent body text start', () => {
    const stops = computeTabStops({
      explicitStops: [],
      defaultTabInterval: 720,
      paragraphIndent: { left: 1000, hanging: 500 },
    });

    const implicitBodyStop = stops.find((stop) => stop.pos === 1000);
    expect(implicitBodyStop).toMatchObject({
      val: 'start',
      leader: 'none',
      source: 'default',
    });
    expect(stops[0]?.pos).toBe(1000);
    expect(stops.find((stop) => stop.pos === 720)).toBeUndefined();
    expect(stops.find((stop) => stop.pos === 1440)).toBeDefined();
  });

  it('does not duplicate the implicit hanging stop when it lands on the default grid', () => {
    const stops = computeTabStops({
      explicitStops: [],
      defaultTabInterval: 720,
      paragraphIndent: { left: 3600, hanging: 3600 },
    });

    expect(stops.filter((stop) => stop.pos === 3600)).toHaveLength(1);
  });

  it('does not synthesize the implicit hanging stop when it was explicitly cleared', () => {
    const stops = computeTabStops({
      explicitStops: [{ val: 'clear', pos: 1000 }],
      defaultTabInterval: 720,
      paragraphIndent: { left: 1000, hanging: 500 },
    });

    expect(stops.find((stop) => stop.pos === 1000)).toBeUndefined();
    expect(stops.find((stop) => stop.pos === 1440)).toBeDefined();
  });

  it('combines explicit stops in hanging range with defaults starting at leftIndent', () => {
    // When explicit stops exist in the hanging indent range AND there's a gap before leftIndent,
    // explicit stops should be preserved, but defaults should start from leftIndent.
    const stops = computeTabStops({
      explicitStops: [
        { val: 'start', pos: 340, leader: 'none' }, // In hanging range (0-709)
        { val: 'start', pos: 709, leader: 'none' }, // At leftIndent
      ],
      defaultTabInterval: 720,
      paragraphIndent: { left: 709, hanging: 709 },
    });

    // Explicit stop at 340 should be preserved (for first line)
    expect(stops.find((stop) => stop.pos === 340)).toBeDefined();
    // Explicit stop at 709 should be preserved
    expect(stops.find((stop) => stop.pos === 709)).toBeDefined();
    // First default should align with Word's 0.5" grid offset from leftIndent (709 + 720 = 1429).
    expect(stops.find((stop) => stop.pos === 1429)).toBeDefined();
    // No duplicate default at 720 because explicit stop at 709 occupies that slot
    expect(stops.filter((stop) => stop.pos === 720).length).toBe(0);
  });

  it('adds the implicit left-indent stop before explicit right tabs (TOC regression)', () => {
    const stops = computeTabStops({
      explicitStops: [{ val: 'end', pos: 10593, leader: 'dot' }], // TOC1 style tab
      defaultTabInterval: 720,
      paragraphIndent: { left: 454, hanging: 454 }, // first line begins near 0"
    });

    const startStops = stops.filter((stop) => stop.val === 'start' && stop.leader === 'none');
    expect(startStops[0]?.pos).toBe(454); // Word implicit stop at left indent
    expect(startStops.find((stop) => stop.pos === 720)).toBeDefined(); // Word default 0.5" tab stop
    expect(startStops[0]!.pos).toBeLessThan(10593);
    expect(stops.find((stop) => stop.val === 'end' && stop.pos === 10593)).toBeDefined();
  });

  it('does not duplicate default stops when an implicit left-indent stop lands on the default grid', () => {
    const stops = computeTabStops({
      explicitStops: [],
      defaultTabInterval: 720,
      paragraphIndent: { left: 720, hanging: 720 },
    });

    expect(stops.filter((stop) => stop.pos === 720)).toHaveLength(1);
    expect(stops[0]).toEqual({ val: 'start', pos: 720, leader: 'none', source: 'default' });
    expect(stops.find((stop) => stop.pos === 1440)).toBeDefined();
  });

  it('preserves legacy defaults-after-rightmost behavior when a start stop is present', () => {
    // Paragraphs with a start-aligned explicit stop (e.g. signature lines, invoice
    // headers) must keep the pre-fix behavior: defaults begin after the rightmost
    // explicit stop, not from zero. Regression guard for the hasStartAlignedExplicit
    // branch added alongside the TOC fix.
    const explicitStops = [
      { val: 'start' as const, pos: 500, leader: 'none' as const },
      { val: 'end' as const, pos: 5000, leader: 'dot' as const },
    ];
    const stops = computeTabStops({
      explicitStops,
      defaultTabInterval: 720,
      paragraphIndent: { left: 0 },
    });

    const explicitPositions = new Set(explicitStops.map((s) => s.pos));
    // No *default* (non-explicit) stop should appear between 0 and the rightmost
    // explicit stop (5000). Explicit stops themselves are allowed.
    const generatedBelowEnd = stops.filter((stop) => stop.pos < 5000 && !explicitPositions.has(stop.pos));
    expect(generatedBelowEnd).toHaveLength(0);
    // Defaults should resume at 5720 (5000 + 720 interval).
    expect(stops.find((stop) => stop.val === 'start' && stop.pos === 5720)).toBeDefined();
  });
});

describe('engines-tabs layoutWithTabs', () => {
  it('advances to the next tab stop', () => {
    const stops = [
      { val: 'start', pos: 720, leader: 'none' },
      { val: 'decimal', pos: 1440, leader: 'dot' },
    ];

    const runs = [
      { run: 'First', width: 20 },
      { run: '\t', width: 0, isTab: true },
      { run: 'Second', width: 25 },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000);
    const tabRun = positioned.find((entry) => entry.tabStop);
    expect(tabRun?.tabStop?.pos).toBe(720);
    const secondRun = positioned.find((entry) => entry.run === 'Second');
    expect(secondRun?.x).toBe(720);
  });

  it('aligns decimal text so the separator sits on the tab stop', () => {
    const stops = [{ val: 'decimal', pos: 1000, leader: 'none' }];

    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'Price', width: 40, text: '12.99' },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000, {
      measureTextWidth: (_run, text) => text.length * 5,
    });

    const priceRun = positioned.find((entry) => entry.run === 'Price');
    // Decimal at index 2: "12" = 10px, so x = 1000 - 10 = 990
    expect(priceRun?.x).toBe(990);
  });

  it('aligns decimal text using a comma separator', () => {
    const stops = [{ val: 'decimal', pos: 1000, leader: 'none' }];

    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'PriceComma', width: 40, text: '12,99' },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000, {
      measureTextWidth: (_run, text) => text.length * 5,
      decimalSeparator: ',',
    });

    const priceRun = positioned.find((entry) => entry.run === 'PriceComma');
    // Decimal comma at index 2: "12" = 10px, so x = 1000 - 10 = 990
    expect(priceRun?.x).toBe(990);
  });

  it('falls back to stop position when decimal separator missing', () => {
    const stops = [{ val: 'decimal', pos: 1600, leader: 'none' }];
    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'Label', width: 30, text: 'Total' },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000);
    const labelRun = positioned.find((entry) => entry.run === 'Label');
    expect(labelRun?.x).toBe(1600);
  });

  it('centers text at center tab stop', () => {
    const stops = [{ val: 'center', pos: 1000, leader: 'none' }];
    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'Centered', width: 60 },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000);
    const centeredRun = positioned.find((entry) => entry.run === 'Centered');
    // Text width = 60, so x = 1000 - (60/2) = 970
    expect(centeredRun?.x).toBe(970);
  });

  it('centers text with measureTextWidth callback', () => {
    const stops = [{ val: 'center', pos: 800, leader: 'none' }];
    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'Title', width: 40, text: 'Title' },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000, {
      measureTextWidth: (_run, text) => text.length * 8,
    });

    const titleRun = positioned.find((entry) => entry.run === 'Title');
    // measureTextWidth returns 40 (5 chars * 8), so x = 800 - 20 = 780
    expect(titleRun?.x).toBe(780);
  });

  it('right-aligns text at end tab stop', () => {
    const stops = [{ val: 'end', pos: 1200, leader: 'none' }];
    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'RightAlign', width: 80 },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000);
    const rightRun = positioned.find((entry) => entry.run === 'RightAlign');
    // Text width = 80, so x = 1200 - 80 = 1120
    expect(rightRun?.x).toBe(1120);
  });

  it('right-aligns text with measureTextWidth callback', () => {
    const stops = [{ val: 'end', pos: 1500, leader: 'none' }];
    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'Amount', width: 50, text: 'Amount' },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000, {
      measureTextWidth: (_run, text) => text.length * 10,
    });

    const amountRun = positioned.find((entry) => entry.run === 'Amount');
    // measureTextWidth returns 60 (6 chars * 10), but we use run width = 50
    // x = 1500 - 50 = 1450
    expect(amountRun?.x).toBe(1450);
  });

  it('handles mixed alignment types on same line', () => {
    const stops = [
      { val: 'start', pos: 400, leader: 'none' },
      { val: 'center', pos: 1000, leader: 'none' },
      { val: 'end', pos: 1800, leader: 'none' },
    ];

    const runs = [
      { run: '\t', width: 0, isTab: true }, // Tab to 400 (start)
      { run: 'Left', width: 30 }, // Start at 400
      { run: '\t', width: 0, isTab: true }, // Tab to 1000 (center)
      { run: 'Center', width: 40 }, // Center at 1000
      { run: '\t', width: 0, isTab: true }, // Tab to 1800 (end)
      { run: 'Right', width: 50 }, // End at 1800
    ];

    const positioned = layoutWithTabs(runs, stops, 2000);

    const leftRun = positioned.find((entry) => entry.run === 'Left');
    expect(leftRun?.x).toBe(400); // Start alignment

    const centerRun = positioned.find((entry) => entry.run === 'Center');
    expect(centerRun?.x).toBe(980); // 1000 - 40/2 = 980

    const rightRun = positioned.find((entry) => entry.run === 'Right');
    expect(rightRun?.x).toBe(1750); // 1800 - 50 = 1750
  });

  it('handles center and end with decimal alignment', () => {
    const stops = [
      { val: 'center', pos: 500, leader: 'none' },
      { val: 'decimal', pos: 1000, leader: 'none' },
      { val: 'end', pos: 1500, leader: 'none' },
    ];

    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'Header', width: 60 },
      { run: '\t', width: 0, isTab: true },
      { run: 'Price', width: 40, text: '99.99' },
      { run: '\t', width: 0, isTab: true },
      { run: 'Total', width: 50 },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000, {
      measureTextWidth: (_run, text) => text.length * 5,
    });

    const headerRun = positioned.find((entry) => entry.run === 'Header');
    expect(headerRun?.x).toBe(470); // 500 - 60/2 = 470

    const priceRun = positioned.find((entry) => entry.run === 'Price');
    // Decimal at index 2: "99" = 10px, so x = 1000 - 10 = 990
    expect(priceRun?.x).toBe(990);

    const totalRun = positioned.find((entry) => entry.run === 'Total');
    expect(totalRun?.x).toBe(1450); // 1500 - 50 = 1450
  });

  it('clamps center alignment to prevent negative x position', () => {
    const stops = [{ val: 'center', pos: 20, leader: 'none' }];
    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'Wide', width: 100 },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000);
    const wideRun = positioned.find((entry) => entry.run === 'Wide');
    // Would be 20 - 50 = -30, but clamped to 0
    expect(wideRun?.x).toBe(0);
  });

  it('clamps end alignment to prevent negative x position', () => {
    const stops = [{ val: 'end', pos: 30, leader: 'none' }];
    const runs = [
      { run: '\t', width: 0, isTab: true },
      { run: 'VeryWide', width: 100 },
    ];

    const positioned = layoutWithTabs(runs, stops, 2000);
    const veryWideRun = positioned.find((entry) => entry.run === 'VeryWide');
    // Would be 30 - 100 = -70, but clamped to 0
    expect(veryWideRun?.x).toBe(0);
  });
});

describe('calculateTabWidth', () => {
  const baseParams = {
    paragraphWidth: 200,
    defaultTabDistance: 48,
    defaultLineLength: 816,
    tabStops: [{ val: 'start', pos: 100, leader: 'none' } as const],
  };

  it('uses next tab stop for start alignment', () => {
    const result = calculateTabWidth({
      ...baseParams,
      currentX: 40,
      followingText: 'after',
    });
    expect(result.width).toBe(60);
    expect(result.alignment).toBe('start');
    expect(result.tabStopPosUsed).toBe(100);
  });

  it('falls back to default grid when no stop', () => {
    const result = calculateTabWidth({
      ...baseParams,
      tabStops: [],
      currentX: 50,
    });
    expect(result.alignment).toBe('default');
    expect(result.tabStopPosUsed).toBe('default');
    expect(result.width).toBeGreaterThan(0);
  });

  it('applies center alignment offset', () => {
    const result = calculateTabWidth({
      ...baseParams,
      tabStops: [{ val: 'center', pos: 150, leader: 'dot' }],
      currentX: 50,
      followingText: 'abcd',
      measureText: (text) => text.length * 5,
    });
    // base width = 100, adjust by half of followingText (4*5/2 = 10)
    expect(Math.round(result.width)).toBe(90);
    expect(result.alignment).toBe('center');
    expect(result.leader).toBe('dot');
  });

  it('applies decimal alignment with custom separator', () => {
    const result = calculateTabWidth({
      ...baseParams,
      tabStops: [{ val: 'decimal', pos: 160 }],
      currentX: 40,
      followingText: '12,34',
      decimalSeparator: ',',
      measureText: (text) => text.length * 4,
    });
    // base width = 120; before decimal "12" = 8px; width should subtract 8
    expect(result.width).toBe(112);
    expect(result.alignment).toBe('decimal');
  });

  it('returns zero width for bar tabs', () => {
    const result = calculateTabWidth({
      ...baseParams,
      tabStops: [{ val: 'bar', pos: 120 }],
      currentX: 60,
    });
    expect(result.width).toBe(0);
    expect(result.alignment).toBe('bar');
  });
});
