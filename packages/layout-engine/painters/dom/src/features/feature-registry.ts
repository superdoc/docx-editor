/**
 * Rendering Feature Registry
 *
 * Maps OOXML elements to their rendering feature modules.
 * This is the primary lookup table for agents and developers.
 *
 * To find where an OOXML element renders: search this file.
 * To add a new rendering feature: add an entry here first.
 *
 * Each entry specifies:
 * - feature: human-readable feature name (matches folder name)
 * - module: import path relative to this file
 * - handles: list of OOXML element paths this feature renders
 * - spec: ECMA-376 section reference
 */
export const RENDERING_FEATURES = {
  // ─── Paragraph Borders ───────────────────────────────────────────
  // @spec ECMA-376 §17.3.1.24 (pBdr)
  'w:pBdr': {
    feature: 'paragraph/borders',
    module: '../paragraph/borders',
    handles: ['w:pBdr/w:top', 'w:pBdr/w:bottom', 'w:pBdr/w:left', 'w:pBdr/w:right', 'w:pBdr/w:between', 'w:pBdr/w:bar'],
    spec: '§17.3.1.24',
  },

  // ─── Paragraph Shading ───────────────────────────────────────────
  // @spec ECMA-376 §17.3.1.31 (shd)
  'w:shd': {
    feature: 'paragraph/borders', // shading shares the border layer module
    module: '../paragraph/borders',
    handles: ['w:shd/@w:fill', 'w:shd/@w:val', 'w:shd/@w:color'],
    spec: '§17.3.1.31',
  },

  // ─── Inline Direction ──────────────────────────────────────────
  // Paragraph/run inline bidi handling. NOT table visual direction
  // (w:bidiVisual, §17.4.1), NOT writing mode (w:textDirection,
  // §17.3.1.41 paragraph / §17.4.72 cell; values in §17.18.93).
  // @spec ECMA-376 §17.3.1.1 (bidi), §17.3.2.30 (rtl)
  'w:bidi': {
    feature: 'inline-direction',
    module: './inline-direction',
    handles: ['w:pPr/w:bidi', 'w:rPr/w:rtl'],
    spec: '§17.3.1.1',
  },

  // ─── Math ─────────────────────────────────────────────────────
  // @spec ECMA-376 §22.1 (Math)
  'm:oMath': {
    feature: 'math',
    module: './math',
    handles: [
      'm:oMath',
      'm:oMathPara',
      'm:r',
      'm:t',
      'm:f',
      'm:rad',
      'm:sSup',
      'm:sSub',
      'm:sSubSup',
      'm:sPre',
      'm:d',
      'm:nary',
      'm:acc',
      'm:bar',
      'm:groupChr',
      'm:limLow',
      'm:limUpp',
      'm:func',
      'm:m',
      'm:eqArr',
      'm:borderBox',
      'm:box',
      'm:phant',
    ],
    spec: '§22.1',
  },

  // ─── Charts ───────────────────────────────────────────────────
  // @spec ECMA-376 §21.2 (DrawingML Charts)
  'c:chart': {
    feature: 'chart',
    module: './chart',
    handles: [
      'c:barChart',
      'c:lineChart',
      'c:stockChart',
      'c:areaChart',
      'c:scatterChart',
      'c:bubbleChart',
      'c:radarChart',
      'c:pieChart',
      'c:doughnutChart',
      'c:ofPieChart',
    ],
    spec: '§21.2',
  },
} as const;
