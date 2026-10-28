import { describe, it, expect } from 'bun:test';
import {
  resolveListMarkerGeometry,
  resolveListTextStartPx,
  type MinimalWordLayout,
  type MinimalMarker,
} from './list-marker-utils.js';
import { LIST_MARKER_GAP, SPACE_SUFFIX_GAP_PX, DEFAULT_TAB_INTERVAL_PX } from './layout-constants.js';

describe('historical prefixes at the current paragraph text start', () => {
  for (const suffix of ['nothing', 'space', 'tab'] as const) {
    for (const textStart of [-14, 0, 82, 144]) {
      it(`preserves ${textStart}px text start for a ${suffix} prefix of either measured width`, () => {
        for (const glyphWidth of [10, 60]) {
          const reference: MinimalWordLayout = {
            indentLeftPx: 96,
            hangingPx: 24,
            firstLinePx: 0,
            tabsPx: [144],
            marker: { markerText: 'LONG.', justification: 'left', suffix },
          };
          const original = resolveListMarkerGeometry(reference, 96, 0, 24, () => glyphWidth)!;
          const current = { ...reference, textStartMode: 'paragraph' as const };
          const geometry = resolveListMarkerGeometry(
            current,
            96,
            Math.max(textStart - 96, 0),
            Math.max(96 - textStart, 0),
            () => glyphWidth,
          )!;
          expect(geometry.textStartPx).toBe(textStart);
          expect(geometry.markerTextWidthPx).toBe(glyphWidth);
          expect(geometry.suffixWidthPx).toBe(original.suffixWidthPx);
          expect(geometry.markerStartPx - original.markerStartPx).toBe(textStart - original.textStartPx);
        }
      });
    }
  }
});

describe('resolveListTextStartPx', () => {
  const mockMeasureMarkerText = (text: string): number => text.length * 8; // 8px per character
  const twipsToPx = (twips: number): number => twips / 15;

  describe('edge cases and validation', () => {
    it('returns undefined when no marker present', () => {
      const wordLayout: MinimalWordLayout = {};
      const result = resolveListTextStartPx(wordLayout, 36, 0, 18, mockMeasureMarkerText);
      expect(result).toBeUndefined();
    });

    it('returns undefined when wordLayout is undefined', () => {
      const result = resolveListTextStartPx(undefined, 36, 0, 18, mockMeasureMarkerText);
      expect(result).toBeUndefined();
    });

    it('handles NaN markerBoxWidthPx by using 0', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          markerBoxWidthPx: NaN,
          suffix: 'nothing',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(0); // markerStartPos(0) + markerTextWidth(0)
    });

    it('handles negative markerBoxWidthPx by using 0', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          markerBoxWidthPx: -10,
          suffix: 'nothing',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(0); // markerStartPos(0) + markerTextWidth(0)
    });

    it('handles NaN markerX in firstLineIndentMode by falling back to standard calculation', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        marker: {
          markerX: NaN,
          glyphWidthPx: 20,
          suffix: 'nothing',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 36, 0, 18, mockMeasureMarkerText);
      // When markerX is NaN, falls back to: indentLeft - hanging + firstLine = 36 - 18 + 0 = 18
      // markerStartPos(18) + glyphWidth(20) = 38
      expect(result).toBe(38);
    });
  });

  describe('suffix handling', () => {
    describe('space suffix', () => {
      it('adds SPACE_SUFFIX_GAP_PX (4px) after marker', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 15,
            markerX: 0,
            suffix: 'space',
          },
          firstLineIndentMode: true,
        };
        const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
        expect(result).toBe(15 + SPACE_SUFFIX_GAP_PX); // 15 + 4 = 19
      });

      it('uses measured width when glyphWidthPx not provided', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            markerText: 'ABC', // 3 chars * 8px = 24px
            markerX: 0,
            suffix: 'space',
          },
          firstLineIndentMode: true,
        };
        const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
        expect(result).toBe(24 + SPACE_SUFFIX_GAP_PX); // 24 + 4 = 28
      });
    });

    describe('nothing suffix', () => {
      it('returns position immediately after marker', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 20,
            markerX: 10,
            suffix: 'nothing',
          },
          firstLineIndentMode: true,
        };
        const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
        expect(result).toBe(30); // markerX(10) + glyphWidth(20)
      });
    });

    describe('tab suffix (default)', () => {
      it('uses tab suffix when not specified', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 20,
            markerX: 0,
          },
          firstLineIndentMode: true,
          textStartPx: 48,
        };
        const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
        expect(result).toBe(48); // Advances to textStartPx
      });
    });
  });

  describe('justification modes', () => {
    describe('left justification (default)', () => {
      it('uses tab-based spacing in standard mode', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 20,
            justification: 'left',
            suffix: 'tab',
            gutterWidthPx: 8,
          },
        };
        const indentLeft = 36;
        const firstLine = 0;
        const hanging = 18;
        // markerStartPos = 36 - 18 + 0 = 18
        // currentPos = 18 + 20 = 38
        // textStart = 36, tabWidth = 36 - 38 = -2 → overflow
        // nextDefaultTab = 38 + 48 - (38 % 48) = 48
        // result = 48
        const result = resolveListTextStartPx(wordLayout, indentLeft, firstLine, hanging, mockMeasureMarkerText);
        expect(result).toBe(48);
      });

      it('uses textStartPx when provided even in standard mode', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 20,
            justification: 'left',
            suffix: 'tab',
            gutterWidthPx: 8,
          },
          textStartPx: 50,
        };
        const indentLeft = 36;
        const firstLine = 0;
        const hanging = 18;
        // markerStartPos = 18, currentPos = 38, textStartPx=50 => gap = max(50-38=12, gutter 8) = 12
        // result = 38 + 12 = 50
        const result = resolveListTextStartPx(wordLayout, indentLeft, firstLine, hanging, mockMeasureMarkerText);
        expect(result).toBe(50);
      });
    });

    describe('center/right justification', () => {
      it('uses the rendered tab stop for center justification in first-line mode', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 20,
            markerX: 0,
            justification: 'center',
            gutterWidthPx: 12,
            suffix: 'tab',
          },
          firstLineIndentMode: true,
        };
        const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
        expect(result).toBe(48);
      });

      it('uses the rendered tab stop for right justification in first-line mode', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 20,
            markerX: 28,
            justification: 'right',
            gutterWidthPx: 4,
            suffix: 'tab',
          },
          textStartPx: 120,
          firstLineIndentMode: true,
        };
        const result = resolveListTextStartPx(wordLayout, 48, 0, 0, mockMeasureMarkerText);
        expect(result).toBe(48);
      });

      it('uses the hanging width for right justification without a positive first-line indent', () => {
        const wordLayout: MinimalWordLayout = {
          marker: {
            glyphWidthPx: 20,
            markerX: 0,
            justification: 'right',
            suffix: 'tab',
          },
          firstLineIndentMode: true,
        };
        const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
        expect(result).toBe(20);
      });
    });
  });

  describe('first-line indent mode', () => {
    it('uses markerX for marker start position and tab-stop text start', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        marker: {
          markerX: 10,
          glyphWidthPx: 20,
          textStartX: 48,
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 36, 0, 18, mockMeasureMarkerText);
      expect(result).toBe(36);
    });

    it('uses explicit tab stop when available and after marker', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        tabsPx: [24, 48, 72],
        marker: {
          markerX: 0,
          glyphWidthPx: 18, // currentPos = 0 + 18 = 18
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(24);
    });

    it('prefers the next explicit tab stop over a stale first-line text start target', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        textStartPx: 48,
        tabsPx: [144],
        marker: {
          markerX: 0,
          glyphWidthPx: 20,
          suffix: 'tab',
        },
      };

      const geometry = resolveListMarkerGeometry(wordLayout, 0, 0, 0, mockMeasureMarkerText);

      expect(geometry).toEqual({
        markerStartPx: 0,
        markerTextWidthPx: 20,
        textStartPx: 144,
        suffixWidthPx: 124,
      });
      expect(resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText)).toBe(144);
    });

    it('uses the next default tab stop when no explicit tab stop is found', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        tabsPx: [12, 24], // All tabs before marker end
        marker: {
          markerX: 0,
          glyphWidthPx: 30, // currentPos = 30
          textStartX: 56,
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(48);
    });

    it('uses rendered tab stops instead of stale first-line text start targets', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        textStartPx: 100,
        marker: {
          markerX: 0,
          glyphWidthPx: 20,
          textStartX: 56,
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(48);
    });

    it('uses the rendered default tab stop when textStartX is not provided', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        textStartPx: 48,
        marker: {
          markerX: 0,
          glyphWidthPx: 20,
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(48);
    });

    it('uses default tab stops instead of flooring to LIST_MARKER_GAP', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        marker: {
          markerX: 0,
          glyphWidthPx: 20, // currentPos = 20
          textStartX: 22, // Would give tabWidth = 2, less than LIST_MARKER_GAP (8)
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(48);
    });

    it('uses the next default tab stop when no explicit tab or text start is available', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        marker: {
          markerX: 0,
          glyphWidthPx: 20,
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(48);
    });

    it('measures the SD-3426 first-line tab start used for justified list text', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        marker: {
          markerX: 48,
          glyphWidthPx: 18.65625,
          textStartX: 66,
          gutterWidthPx: 8,
          suffix: 'tab',
        },
      };
      const geometry = resolveListMarkerGeometry(wordLayout, 0, 48, 0, mockMeasureMarkerText);

      expect(geometry).toBeTruthy();
      expect(geometry!.markerStartPx).toBe(48);
      expect(geometry!.suffixWidthPx).toBeCloseTo(29.34375, 5);
      expect(geometry!.textStartPx).toBeCloseTo(96, 5);
    });
  });

  describe('standard hanging indent mode', () => {
    it('uses a direct numbering tab for a zero-indent list level', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 14.8,
          markerBoxWidthPx: 18,
          suffix: 'tab',
        },
        textStartPx: 0,
        tabsPx: [18.9333333333],
      };

      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);

      expect(result).toBeCloseTo(18.9333333333, 8);
    });

    it('ignores later paragraph tab stops when textStartPx is present', () => {
      // Regression: tabs after the inherited text start are for inline w:tab
      // characters, not list-prefix positioning.
      const wordLayout: MinimalWordLayout = {
        marker: { glyphWidthPx: 10, suffix: 'tab' },
        textStartPx: 24,
        tabsPx: [48, 96],
      };
      // markerStart = 24 - 18 = 6, markerContentEnd = 16
      // textStartPx = 24 clears the glyph → used directly
      const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

      expect(result).toBe(24);
    });

    it('uses an explicit suffix tab between the marker and inherited hanging text start (SD-4103)', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 6,
          suffix: 'tab',
        },
        textStartPx: 90, // inherited numbering left: 1350 twips
        tabsPx: [42], // explicit paragraph tab: 630 twips
      };

      const geometry = resolveListMarkerGeometry(wordLayout, 90, 0, 66, mockMeasureMarkerText);

      expect(geometry).toEqual({
        markerStartPx: 24, // inherited left 1350 twips - direct hanging 990 twips
        markerTextWidthPx: 6,
        textStartPx: 42,
        suffixWidthPx: 12,
      });
    });

    it('aligns the direct-left control and inherited-left repro paragraph from SD-4103', () => {
      const marker: MinimalMarker = { glyphWidthPx: 6, suffix: 'tab' };
      const controlLayout: MinimalWordLayout = {
        marker,
        textStartPx: 42, // direct left: 630 twips
        tabsPx: [42],
      };
      const reproLayout: MinimalWordLayout = {
        marker,
        textStartPx: 90, // inherited numbering left: 1350 twips
        tabsPx: [42], // explicit paragraph tab: 630 twips
      };

      const controlTextStart = resolveListTextStartPx(controlLayout, 42, 0, 18, mockMeasureMarkerText);
      const reproTextStart = resolveListTextStartPx(reproLayout, 90, 0, 66, mockMeasureMarkerText);

      expect(controlTextStart).toBe(42);
      expect(reproTextStart).toBe(controlTextStart);
    });

    it('aligns representative Bullet Points.docx rows at the explicit 630-twip suffix tab', () => {
      const marker: MinimalMarker = { glyphWidthPx: 6, suffix: 'tab' };
      const expectedTextStartPx = twipsToPx(630);
      const cases = [
        {
          label: 'direct left 630, hanging 270',
          indentLeft: twipsToPx(630),
          hanging: twipsToPx(270),
          textStart: twipsToPx(630),
        },
        {
          label: 'inherited left 1350, direct hanging 990',
          indentLeft: twipsToPx(1350),
          hanging: twipsToPx(990),
          textStart: twipsToPx(1350),
        },
        {
          label: 'direct left 720, inherited hanging 360',
          indentLeft: twipsToPx(720),
          hanging: twipsToPx(360),
          textStart: twipsToPx(720),
        },
        {
          label: 'direct left 360, firstLine 0',
          indentLeft: twipsToPx(360),
          hanging: 0,
          textStart: twipsToPx(360),
        },
        {
          label: 'direct left 648, hanging 288',
          indentLeft: twipsToPx(648),
          hanging: twipsToPx(288),
          textStart: twipsToPx(648),
        },
      ];

      for (const scenario of cases) {
        const wordLayout: MinimalWordLayout = {
          marker,
          textStartPx: scenario.textStart,
          tabsPx: [expectedTextStartPx],
        };

        const result = resolveListTextStartPx(
          wordLayout,
          scenario.indentLeft,
          0,
          scenario.hanging,
          mockMeasureMarkerText,
        );

        expect(result, scenario.label).toBeCloseTo(expectedTextStartPx, 8);
      }
    });

    it('ignores paragraph tabs before the marker glyph when choosing the marker suffix stop', () => {
      const wordLayout: MinimalWordLayout = {
        marker: { glyphWidthPx: 6, suffix: 'tab' },
        textStartPx: 90,
        tabsPx: [26],
      };

      const result = resolveListTextStartPx(wordLayout, 90, 0, 66, mockMeasureMarkerText);

      expect(result).toBe(90);
    });

    it('uses an explicit suffix tab before the next default stop when firstLine=0 overruns the indent target', () => {
      const wordLayout: MinimalWordLayout = {
        marker: { glyphWidthPx: 6, suffix: 'tab' },
        textStartPx: 24, // direct left: 360 twips
        tabsPx: [42], // explicit paragraph tab: 630 twips
      };

      const geometry = resolveListMarkerGeometry(wordLayout, 24, 0, 0, mockMeasureMarkerText);

      expect(geometry).toEqual({
        markerStartPx: 24,
        markerTextWidthPx: 6,
        textStartPx: 42,
        suffixWidthPx: 12,
      });
    });

    it('ignores far-right inline tabs when firstLine=0 overruns the indent target', () => {
      const wordLayout: MinimalWordLayout = {
        marker: { glyphWidthPx: 6, suffix: 'tab' },
        textStartPx: 24,
        tabsPx: [192],
      };

      const result = resolveListTextStartPx(wordLayout, 24, 0, 0, mockMeasureMarkerText);

      expect(result).toBe(48);
    });

    it('ignores numbering-tab metadata drift in tabsPx', () => {
      // Regression (list-mixed-abstract-ids): numbering tab metadata in tabsPx
      // must not nudge text a few px past the hanging-indent text start.
      const wordLayout: MinimalWordLayout = {
        marker: { glyphWidthPx: 8, suffix: 'tab' },
        textStartPx: 24,
        tabsPx: [26], // numbering tab slightly past textStartPx
      };
      const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

      expect(result).toBe(24);
    });

    it('leaves later inline tabs alone when resolving list prefix', () => {
      // Regression (HVY-20): a later paragraph tab stop (e.g. after "Payment.")
      // must not be consumed by the list-prefix helper.
      const wordLayout: MinimalWordLayout = {
        marker: { glyphWidthPx: 6, suffix: 'tab' },
        textStartPx: 24,
        tabsPx: [192], // far-right tab for inline w:tab use
      };
      const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

      expect(result).toBe(24);
    });

    it('advances a right-justified marker to the hanging text start, not the fixed gutter (SD-3778)', () => {
      // Regression (SD-3778): a right-justified numbering marker (e.g. a roman
      // "i." level) separates from its text with a tab that lands at the same
      // stop the painter targets via computeTabWidth — the hanging text start,
      // not the fixed LIST_MARKER_GAP gutter. Using the gutter left the caret /
      // text-start ~one glyph left of the painted text, so clicking between two
      // characters placed the caret over the wrong character.
      const wordLayout: MinimalWordLayout = {
        marker: { glyphWidthPx: 10, justification: 'right', gutterWidthPx: LIST_MARKER_GAP, suffix: 'tab' },
      };
      // indentLeft 144, firstLine 0, hanging 12 -> anchor = markerContentEnd = 132.
      // computeTabWidth (right, no positive first-line indent) -> hanging (12),
      // so text starts at 144 — NOT 132 + gutter(8) = 140.
      const result = resolveListTextStartPx(wordLayout, 144, 0, 12, mockMeasureMarkerText);
      expect(result).toBe(144);
    });

    it('uses the explicit text start when a wide marker box still leaves clear space after the glyph', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 5,
          markerBoxWidthPx: 24,
          suffix: 'tab',
        },
        textStartPx: 24,
      };

      const result = resolveListTextStartPx(wordLayout, 24, 0, 24, mockMeasureMarkerText);

      expect(result).toBe(24);
    });

    it('uses markerBoxWidthPx to advance a zero-indent heading marker to the next default tab stop', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 11,
          markerBoxWidthPx: 18,
          suffix: 'tab',
        },
      };

      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);

      expect(result).toBe(DEFAULT_TAB_INTERVAL_PX);
    });

    it('calculates marker start from indents', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 18,
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const firstLine = 0;
      const hanging = 18;
      // markerStartPos = indentLeft - hanging + firstLine = 36 - 18 + 0 = 18
      // currentPos = 18 + 18 = 36
      // textStart = indentLeft + firstLine = 36 + 0 = 36
      // tabWidth = textStart - currentPos = 36 - 36 = 0 → overflow
      // nextDefaultTab = 36 + 48 - (36 % 48) = 48
      // result = 48
      const result = resolveListTextStartPx(wordLayout, indentLeft, firstLine, hanging, mockMeasureMarkerText);
      expect(result).toBe(48);
    });

    it('uses minimum gutter when currentPos exceeds textStart', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 30, // Long marker
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const firstLine = 0;
      const hanging = 18;
      // markerStartPos = 36 - 18 + 0 = 18
      // currentPos = 18 + 30 = 48
      // textStart = 36 + 0 = 36
      // tabWidth = textStart - currentPos = 36 - 48 = -12 → overflow
      // nextDefaultTab = 48 + 48 - (48 % 48) = 96
      // result = 96
      const result = resolveListTextStartPx(wordLayout, indentLeft, firstLine, hanging, mockMeasureMarkerText);
      expect(result).toBe(96);
    });

    it('uses the indent text start when the marker leaves a positive gap', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 10,
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const firstLine = 0;
      const hanging = 18;
      // markerStartPos = 36 - 18 + 0 = 18
      // currentPos = 18 + 10 = 28
      // textStart = 36 + 0 = 36
      // gap = 36 - 28 = 8, so text starts at the indent target.
      const result = resolveListTextStartPx(wordLayout, indentLeft, firstLine, hanging, mockMeasureMarkerText);
      expect(result).toBe(36); // textStart
    });

    it('uses actual tab width when positive (matches renderer)', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 12,
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const firstLine = 0;
      const hanging = 18;
      // markerStartPos = 36 - 18 + 0 = 18
      // currentPos = 18 + 12 = 30
      // textStart = 36 + 0 = 36
      // tabWidth = 36 - 30 = 6 (positive, used as-is to match renderer)
      const result = resolveListTextStartPx(wordLayout, indentLeft, firstLine, hanging, mockMeasureMarkerText);
      expect(result).toBe(36); // text starts at textStart position
    });
  });

  // ---------------------------------------------------------------------------
  // Step 8 hotfix regression guards
  //
  // These tests lock the hanging-overflow safeguard behavior that prevents
  // the 48px DEFAULT_TAB_INTERVAL_PX jump. Each test targets a specific
  // branch in Step 8 (standard hanging mode, lines 318–346).
  // ---------------------------------------------------------------------------

  describe('Step 8: hanging-overflow advances to next default tab stop', () => {
    it('advances to next default tab stop when marker overruns hanging space', () => {
      // Marker wider than hanging indent, no textStartPx.
      // Must advance to next 48px-aligned tab stop, matching the renderer's computeTabWidth().
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 25, // wider than hanging (18px)
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 36 - 18 = 18
      // currentPosStandard = 18 + 25 = 43 (past indentLeft 36)
      // textStart = 36, tabWidth = 36 - 43 = -7 → overflow
      // nextDefaultTab = 43 + 48 - (43 % 48) = 48
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(48); // advances to next default tab stop
    });

    it('advances to next default tab stop when marker reaches the indent target', () => {
      // Edge case: marker width equals the hanging indent, so there is no
      // positive gap before the indent target.
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 18, // exactly equals hanging
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 36 - 18 = 18
      // currentPosStandard = 18 + 18 = 36 (exactly at indentLeft)
      // textStart = 36, currentPosStandard has reached textStart, so advance.
      // nextDefaultTab = 36 + 48 - (36 % 48) = 48
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(48); // advances to next default tab stop
    });

    it('advances to next default tab stop when hanging is zero and no textStartPx', () => {
      // hanging=0 → markerStartPos = indentLeft, textStart = indentLeft → tabWidth = -markerWidth
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 10,
          suffix: 'tab',
        },
      };
      const indentLeft = 24;
      const hanging = 0;
      // markerStartPos = 24 - 0 = 24
      // currentPosStandard = 24 + 10 = 34
      // textStart = 24, tabWidth = 24 - 34 = -10 → overflow
      // nextDefaultTab = 34 + 48 - (34 % 48) = 48
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(48); // advances to next default tab stop
    });
  });

  describe('Step 8: textStartPx target branch', () => {
    it('uses textStartPx when it exceeds currentPosStandard', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 10,
          suffix: 'tab',
        },
        textStartPx: 36,
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 36 - 18 = 18
      // currentPosStandard = 18 + 10 = 28
      // gap = max(36 - 28, 8) = max(8, 8) = 8
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(36); // 28 + 8 = 36
    });

    it('uses textStartPx directly when it already clears the visible marker glyph', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 15,
          suffix: 'tab',
        },
        textStartPx: 36,
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 36 - 18 = 18
      // markerContentEnd = 18 + 15 = 33
      // textStartPx = 36 already clears the visible marker glyph, so it is used as-is
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(36);
    });

    it('enforces minimum gutterWidth when textStartPx is behind currentPosStandard', () => {
      // Overflow: marker extends past the target text start
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 25, // wider than hanging
          suffix: 'tab',
        },
        textStartPx: 36,
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 36 - 18 = 18
      // currentPosStandard = 18 + 25 = 43
      // gap = max(36 - 43, 8) = max(-7, 8) = 8
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(43 + LIST_MARKER_GAP); // 43 + 8 = 51
      expect(result).not.toBe(43 + DEFAULT_TAB_INTERVAL_PX);
    });

    it('uses custom gutterWidthPx when larger than LIST_MARKER_GAP', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 25,
          suffix: 'tab',
          gutterWidthPx: 12,
        },
        textStartPx: 36,
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 18, currentPosStandard = 18 + 25 = 43
      // gap = max(36 - 43, 12) = max(-7, 12) = 12
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(43 + 12); // 55
    });
  });

  describe('Step 8: implicit indent fallback', () => {
    it('uses indentLeft + firstLine when no textStartPx provided', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 8,
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 36 - 18 = 18
      // currentPosStandard = 18 + 8 = 26
      // textStart = 36, tabWidth = 36 - 26 = 10 (>= LIST_MARKER_GAP, used as-is)
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(36); // 26 + 10 = 36
    });

    it('uses actual tab width for small positive gap (matches renderer)', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 14,
          suffix: 'tab',
        },
      };
      const indentLeft = 36;
      const hanging = 18;
      // markerStartPos = 18, currentPosStandard = 18 + 14 = 32
      // textStart = 36, tabWidth = 36 - 32 = 4 (used as-is, matching renderer)
      const result = resolveListTextStartPx(wordLayout, indentLeft, 0, hanging, mockMeasureMarkerText);

      expect(result).toBe(36); // text starts at textStart position (indentLeft)
    });
  });

  describe('Step 7: first-line indent mode uses rendered tab stops', () => {
    it('uses a close explicit tab stop without flooring to LIST_MARKER_GAP', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        tabsPx: [22], // tab at 22, just 2px past marker end at 20
        marker: {
          markerX: 0,
          glyphWidthPx: 20, // currentPos = 20
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);

      expect(result).toBe(22);
    });

    it('uses real tab stop gap when it exceeds LIST_MARKER_GAP', () => {
      const wordLayout: MinimalWordLayout = {
        firstLineIndentMode: true,
        tabsPx: [36], // tab at 36, 16px past marker end at 20
        marker: {
          markerX: 0,
          glyphWidthPx: 20, // currentPos = 20
          suffix: 'tab',
        },
      };
      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);

      // tabWidth = 36 - 20 = 16, which is >= LIST_MARKER_GAP → used as-is
      expect(result).toBe(36);
    });
  });

  // ---------------------------------------------------------------------------
  // Regression-value tests
  //
  // These use representative indent/hanging/marker-width values from common
  // DOCX list patterns to guard against regressions in real-world documents.
  // Values derived from word-layout defaults:
  //   DEFAULT_LIST_INDENT_BASE_PX = 24
  //   DEFAULT_LIST_INDENT_STEP_PX = 24
  //   DEFAULT_LIST_HANGING_PX = 18
  // ---------------------------------------------------------------------------

  describe('regression-value tests (representative doc patterns)', () => {
    // Pattern: standard level-1 list (indentLeft=24, hanging=18)
    // Common in most DOCX files. Marker sits in the 18px hanging area.
    describe('standard level-1 list (indentLeft=24, hanging=18)', () => {
      it('short numbered marker "1." fits in hanging area', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 8, suffix: 'tab' },
          textStartPx: 24,
        };
        // markerStartPos = 24 - 18 = 6, currentPosStandard = 6 + 8 = 14
        // gap = max(24 - 14, 8) = max(10, 8) = 10
        const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(24); // text starts at indentLeft
      });

      it('wide numbered marker "viii." overflows hanging area and snaps to next default tab stop', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 22, suffix: 'tab' },
          textStartPx: 24,
        };
        // markerStartPos = 6, markerContentEnd = 6 + 22 = 28
        // overflow (28 > 24) → snap to next default tab stop after 28 = 48
        const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(DEFAULT_TAB_INTERVAL_PX); // 48
      });

      it('bullet marker "•" fits comfortably in hanging area', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 6, suffix: 'tab' },
          textStartPx: 24,
        };
        // markerStartPos = 6, currentPosStandard = 6 + 6 = 12
        // gap = max(24 - 12, 8) = max(12, 8) = 12
        const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(24); // text starts at indentLeft
      });
    });

    // Pattern: level-2 list (indentLeft=48, hanging=18)
    describe('level-2 list (indentLeft=48, hanging=18)', () => {
      it('sub-item marker fits in hanging area', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 12, suffix: 'tab' },
          textStartPx: 48,
        };
        // markerStartPos = 48 - 18 = 30, markerContentEnd = 30 + 12 = 42
        // textStartPx = 48 already clears the visible marker glyph, so it is used as-is
        const result = resolveListTextStartPx(wordLayout, 48, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(48);
      });
    });

    // Pattern: tiny spacing (small indents, marker nearly fills available space)
    // Representative of tight-spacing documents like tiny-spacing.docx
    describe('tiny spacing pattern (small indents)', () => {
      it('marker fills entire indent with no overflow', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 10, suffix: 'tab' },
          textStartPx: 12,
        };
        // indentLeft=12, hanging=12 → markerStartPos = 0
        // markerContentEnd = 10, so textStartPx = 12 is valid and used directly
        const result = resolveListTextStartPx(wordLayout, 12, 0, 12, mockMeasureMarkerText);

        expect(result).toBe(12);
      });

      it('marker overflows tiny hanging space and snaps to next default tab stop', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 15, suffix: 'tab' },
          textStartPx: 12,
        };
        // indentLeft=12, hanging=10 → markerStartPos = 2
        // markerContentEnd = 2 + 15 = 17, overflows textStartPx=12
        // → snap to next default tab stop after 17 = 48
        const result = resolveListTextStartPx(wordLayout, 12, 0, 10, mockMeasureMarkerText);

        expect(result).toBe(DEFAULT_TAB_INTERVAL_PX); // 48
      });
    });

    // Pattern: legal numbering (wider markers like "(a)", "1.1.1")
    // Representative of template_format.docx and sd-1356 patterns
    describe('legal numbering pattern (wide markers)', () => {
      it('compound marker "1.1.1" overflows standard hanging and snaps to next default tab stop', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 30, suffix: 'tab' },
          textStartPx: 36,
        };
        // indentLeft=36, hanging=18 → markerStartPos = 18
        // markerContentEnd = 18 + 30 = 48 (overflows textStartPx=36)
        // → snap to next default tab stop strictly past 48 = 48 + 48 = 96
        const result = resolveListTextStartPx(wordLayout, 36, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(2 * DEFAULT_TAB_INTERVAL_PX); // 96
      });

      it('parenthetical marker "(a)" fits in standard hanging', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 16, suffix: 'tab' },
          textStartPx: 36,
        };
        // indentLeft=36, hanging=18 → markerStartPos = 18
        // markerContentEnd = 18 + 16 = 34
        // textStartPx = 36 already clears the visible marker glyph, so it is used directly
        const result = resolveListTextStartPx(wordLayout, 36, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(36);
      });
    });

    // Pattern: no textStartPx (wordLayout missing or textStartPx absent)
    // Falls to implicit indent fallback in Step 8
    describe('implicit indent fallback (no textStartPx)', () => {
      it('level-1 list with no textStartPx uses indentLeft', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 8, suffix: 'tab' },
          // textStartPx intentionally omitted
        };
        // markerStartPos = 24 - 18 = 6, currentPosStandard = 6 + 8 = 14
        // textStart = 24, tabWidth = 24 - 14 = 10 (>= LIST_MARKER_GAP)
        const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(24); // text at indentLeft
      });

      it('wide marker with no textStartPx advances to next default tab stop', () => {
        const wordLayout: MinimalWordLayout = {
          marker: { glyphWidthPx: 25, suffix: 'tab' },
          // textStartPx intentionally omitted
        };
        // markerStartPos = 24 - 18 = 6, currentPosStandard = 6 + 25 = 31
        // textStart = 24, tabWidth = 24 - 31 = -7 → overflow
        // nextDefaultTab = 31 + 48 - (31 % 48) = 48
        const result = resolveListTextStartPx(wordLayout, 24, 0, 18, mockMeasureMarkerText);

        expect(result).toBe(48); // advances to next default tab stop
      });
    });
  });

  describe('marker text measurement', () => {
    it('uses glyphWidthPx when provided', () => {
      const measureCalls: string[] = [];
      const trackingMeasure = (text: string): number => {
        measureCalls.push(text);
        return text.length * 8;
      };

      const wordLayout: MinimalWordLayout = {
        marker: {
          glyphWidthPx: 25,
          markerText: 'ABC', // Should not be measured
          suffix: 'nothing',
        },
      };

      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, trackingMeasure);
      expect(result).toBe(25); // Uses glyphWidthPx
      expect(measureCalls).toHaveLength(0); // measureMarkerText not called
    });

    it('measures markerText when glyphWidthPx not provided', () => {
      const measureCalls: string[] = [];
      const trackingMeasure = (text: string): number => {
        measureCalls.push(text);
        return text.length * 8;
      };

      const wordLayout: MinimalWordLayout = {
        marker: {
          markerText: 'ABC', // 3 * 8 = 24
          suffix: 'nothing',
        },
      };

      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, trackingMeasure);
      expect(result).toBe(24); // Measured width
      expect(measureCalls).toEqual(['ABC']); // measureMarkerText called
    });

    it('falls back to markerBoxWidthPx when measurement fails', () => {
      const failingMeasure = (): number => NaN;

      const wordLayout: MinimalWordLayout = {
        marker: {
          markerBoxWidthPx: 20,
          markerText: 'ABC',
          suffix: 'nothing',
        },
      };

      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, failingMeasure);
      expect(result).toBe(20); // Uses markerBoxWidthPx fallback
    });

    it('uses 0 when no width information available', () => {
      const wordLayout: MinimalWordLayout = {
        marker: {
          suffix: 'nothing',
        },
      };

      const result = resolveListTextStartPx(wordLayout, 0, 0, 0, mockMeasureMarkerText);
      expect(result).toBe(0); // All widths default to 0
    });
  });
});

describe('list prefixes displaced by float exclusions', () => {
  const layout: MinimalWordLayout = {
    textStartPx: 24,
    marker: { markerText: '1.', glyphWidthPx: 12, markerBoxWidthPx: 18, suffix: 'tab', justification: 'left' },
  };
  it('keeps the marker visible and advances the suffix after the displaced origin', () => {
    const original = resolveListMarkerGeometry(layout, 24, 0, 24, () => 12);
    const displaced = resolveListMarkerGeometry(layout, 24, 0, 24, () => 12, 156);
    expect(original).toMatchObject({ markerStartPx: 0, textStartPx: 24 });
    expect(displaced).toMatchObject({ markerStartPx: 156, textStartPx: 204, suffixWidthPx: 36 });
  });
  it('preserves an authored numbering suffix stop that still clears the displaced marker', () => {
    const displaced = resolveListMarkerGeometry({ ...layout, tabsPx: [24, 180] }, 24, 0, 24, () => 12, 156);
    expect(displaced).toMatchObject({ markerStartPx: 156, textStartPx: 180, suffixWidthPx: 12 });
  });
});
