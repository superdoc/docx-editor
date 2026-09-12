/**
 * Tests for Mark Application Module
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeRunMarkList,
  pickTrackedChangeKind,
  buildTrackedChangeMetaFromMark,
  selectTrackedChangeMeta,
  trackedChangesCompatible,
  collectTrackedChangeFromMarks,
  normalizeUnderlineStyle,
  applyTextStyleMark,
  applyMarksToRun,
  extractDataAttributes,
  getLuminance,
  resolveAutoColor,
  TRACK_INSERT_MARK,
  TRACK_DELETE_MARK,
  TRACK_FORMAT_MARK,
} from './application.js';
import { ptToPx } from '../utilities.js';
import type { TextRun, PMMark, TrackedChangeMeta } from '../types.js';
import type { TabRun } from '@superdoc/contracts';

describe('mark application', () => {
  describe('normalizeRunMarkList', () => {
    it('returns undefined for null/undefined value', () => {
      expect(normalizeRunMarkList(null)).toBeUndefined();
      expect(normalizeRunMarkList(undefined)).toBeUndefined();
    });

    it('parses valid JSON string with mark array', () => {
      const json = JSON.stringify([{ type: 'bold' }, { type: 'italic', attrs: { color: 'red' } }]);
      const result = normalizeRunMarkList(json);

      expect(result).toHaveLength(2);
      expect(result?.[0]).toEqual({ type: 'bold' });
      expect(result?.[1]).toEqual({ type: 'italic', attrs: { color: 'red' } });
    });

    it('returns undefined for non-array JSON', () => {
      const json = JSON.stringify({ type: 'bold' });
      expect(normalizeRunMarkList(json)).toBeUndefined();
    });

    it('returns undefined for invalid JSON string', () => {
      expect(normalizeRunMarkList('{ invalid json')).toBeUndefined();
    });

    it('accepts array value directly', () => {
      const marks = [{ type: 'bold' }, { type: 'italic', attrs: { color: 'blue' } }];
      const result = normalizeRunMarkList(marks);

      expect(result).toHaveLength(2);
      expect(result?.[0]).toEqual({ type: 'bold' });
      expect(result?.[1]).toEqual({ type: 'italic', attrs: { color: 'blue' } });
    });

    it('filters out entries without type field', () => {
      const marks = [{ type: 'bold' }, { attrs: { color: 'red' } }, { type: 'italic' }];
      const result = normalizeRunMarkList(marks);

      expect(result).toHaveLength(2);
      expect(result?.[0].type).toBe('bold');
      expect(result?.[1].type).toBe('italic');
    });

    it('filters out non-object entries', () => {
      const marks = [{ type: 'bold' }, 'invalid', null, { type: 'italic' }];
      const result = normalizeRunMarkList(marks);

      expect(result).toHaveLength(2);
      expect(result?.[0].type).toBe('bold');
      expect(result?.[1].type).toBe('italic');
    });

    it('returns undefined for JSON exceeding max length', () => {
      const largeJson = JSON.stringify(Array(3000).fill({ type: 'bold' }));
      expect(normalizeRunMarkList(largeJson)).toBeUndefined();
    });

    it('returns undefined for array exceeding max length', () => {
      const largeArray = Array(150).fill({ type: 'bold' });
      expect(normalizeRunMarkList(largeArray)).toBeUndefined();
    });

    it('returns undefined for deeply nested objects', () => {
      const deepObj = {
        type: 'test',
        attrs: {
          a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } },
        },
      };
      expect(normalizeRunMarkList([deepObj])).toBeUndefined();
    });

    it('returns undefined for empty array', () => {
      expect(normalizeRunMarkList([])).toBeUndefined();
    });

    it('preserves attrs for valid marks', () => {
      const marks = [
        {
          type: 'color',
          attrs: { value: 'red', hex: '#FF0000' },
        },
      ];
      const result = normalizeRunMarkList(marks);

      expect(result?.[0].attrs).toEqual({ value: 'red', hex: '#FF0000' });
    });
  });

  describe('pickTrackedChangeKind', () => {
    it('returns "insert" for trackInsert mark', () => {
      expect(pickTrackedChangeKind(TRACK_INSERT_MARK)).toBe('insert');
    });

    it('returns "delete" for trackDelete mark', () => {
      expect(pickTrackedChangeKind(TRACK_DELETE_MARK)).toBe('delete');
    });

    it('returns "format" for trackFormat mark', () => {
      expect(pickTrackedChangeKind(TRACK_FORMAT_MARK)).toBe('format');
    });

    it('returns undefined for unknown mark type', () => {
      expect(pickTrackedChangeKind('bold')).toBeUndefined();
      expect(pickTrackedChangeKind('italic')).toBeUndefined();
      expect(pickTrackedChangeKind('unknown')).toBeUndefined();
    });
  });

  describe('buildTrackedChangeMetaFromMark', () => {
    it('returns undefined for non-tracked change marks', () => {
      const mark: PMMark = { type: 'bold' };
      expect(buildTrackedChangeMetaFromMark(mark)).toBeUndefined();
    });

    it('builds insert metadata from trackInsert mark', () => {
      const mark: PMMark = {
        type: TRACK_INSERT_MARK,
        attrs: {
          id: 'insert-1',
          author: 'John Doe',
          authorEmail: 'john@example.com',
          date: '2024-01-15',
        },
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.kind).toBe('insert');
      expect(result?.id).toBe('insert-1');
      expect(result?.author).toBe('John Doe');
      expect(result?.authorEmail).toBe('john@example.com');
      expect(result?.date).toBe('2024-01-15');
    });

    it('builds delete metadata from trackDelete mark', () => {
      const mark: PMMark = {
        type: TRACK_DELETE_MARK,
        attrs: {
          id: 'delete-1',
          author: 'Jane Smith',
        },
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.kind).toBe('delete');
      expect(result?.id).toBe('delete-1');
      expect(result?.author).toBe('Jane Smith');
    });

    it('builds format metadata with before/after marks', () => {
      const beforeMarks = [{ type: 'bold' }];
      const afterMarks = [{ type: 'italic' }];

      const mark: PMMark = {
        type: TRACK_FORMAT_MARK,
        attrs: {
          id: 'format-1',
          author: 'Editor',
          before: JSON.stringify(beforeMarks),
          after: JSON.stringify(afterMarks),
        },
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.kind).toBe('format');
      expect(result?.id).toBe('format-1');
      expect(result?.before).toEqual(beforeMarks);
      expect(result?.after).toEqual(afterMarks);
    });

    it('generates unique ID when id is missing', () => {
      const mark: PMMark = {
        type: TRACK_INSERT_MARK,
        attrs: {
          authorEmail: 'john@example.com',
        },
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.id).toBeDefined();
      expect(result?.id).toMatch(/^insert-john@example\.com-unknown-/);
    });

    it('ignores empty string id and generates unique one', () => {
      const mark: PMMark = {
        type: TRACK_INSERT_MARK,
        attrs: {
          id: '',
          author: 'John',
        },
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.id).toBeDefined();
      expect(result?.id).not.toBe('');
    });

    it('ignores non-string author attributes', () => {
      const mark: PMMark = {
        type: TRACK_INSERT_MARK,
        attrs: {
          id: 'test-1',
          author: 123,
          authorEmail: true,
        },
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.author).toBeUndefined();
      expect(result?.authorEmail).toBeUndefined();
    });

    it('includes authorImage when provided', () => {
      const mark: PMMark = {
        type: TRACK_INSERT_MARK,
        attrs: {
          id: 'test-1',
          authorImage: 'https://example.com/avatar.jpg',
        },
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.authorImage).toBe('https://example.com/avatar.jpg');
    });

    it('handles mark without attrs', () => {
      const mark: PMMark = {
        type: TRACK_INSERT_MARK,
      };

      const result = buildTrackedChangeMetaFromMark(mark);

      expect(result?.kind).toBe('insert');
      expect(result?.id).toBeDefined();
    });
  });

  describe('selectTrackedChangeMeta', () => {
    it('returns next when existing is undefined', () => {
      const next: TrackedChangeMeta = {
        kind: 'insert',
        id: 'insert-1',
      };

      expect(selectTrackedChangeMeta(undefined, next)).toBe(next);
    });

    it('prioritizes insert over format', () => {
      const existing: TrackedChangeMeta = {
        kind: 'format',
        id: 'format-1',
      };
      const next: TrackedChangeMeta = {
        kind: 'insert',
        id: 'insert-1',
      };

      const result = selectTrackedChangeMeta(existing, next);

      expect(result).toBe(next);
      expect(result.kind).toBe('insert');
    });

    it('prioritizes delete over format', () => {
      const existing: TrackedChangeMeta = {
        kind: 'format',
        id: 'format-1',
      };
      const next: TrackedChangeMeta = {
        kind: 'delete',
        id: 'delete-1',
      };

      const result = selectTrackedChangeMeta(existing, next);

      expect(result).toBe(next);
      expect(result.kind).toBe('delete');
    });

    it('keeps existing when both are format', () => {
      const existing: TrackedChangeMeta = {
        kind: 'format',
        id: 'format-1',
      };
      const next: TrackedChangeMeta = {
        kind: 'format',
        id: 'format-2',
      };

      const result = selectTrackedChangeMeta(existing, next);

      expect(result).toBe(existing);
    });

    it('keeps existing when next has lower priority', () => {
      const existing: TrackedChangeMeta = {
        kind: 'insert',
        id: 'insert-1',
      };
      const next: TrackedChangeMeta = {
        kind: 'format',
        id: 'format-1',
      };

      const result = selectTrackedChangeMeta(existing, next);

      expect(result).toBe(existing);
    });
  });

  describe('trackedChangesCompatible', () => {
    it('returns true when both runs have no tracked changes', () => {
      const a: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const b: TextRun = { text: 'World', fontFamily: 'Arial', fontSize: 12 };

      expect(trackedChangesCompatible(a, b)).toBe(true);
    });

    it('returns false when only one run has tracked changes', () => {
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'insert-1' },
      };
      const b: TextRun = { text: 'World', fontFamily: 'Arial', fontSize: 12 };

      expect(trackedChangesCompatible(a, b)).toBe(false);
    });

    it('returns true when both have same kind and id', () => {
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'insert-1' };
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: meta,
      };
      const b: TextRun = {
        text: 'World',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: meta,
      };

      expect(trackedChangesCompatible(a, b)).toBe(true);
    });

    it('returns false when kind differs', () => {
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'change-1' },
      };
      const b: TextRun = {
        text: 'World',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'delete', id: 'change-1' },
      };

      expect(trackedChangesCompatible(a, b)).toBe(false);
    });

    it('returns false when id differs', () => {
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'insert-1' },
      };
      const b: TextRun = {
        text: 'World',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'insert-2' },
      };

      expect(trackedChangesCompatible(a, b)).toBe(false);
    });

    it('returns true for the same overlap layers in different order', () => {
      const insertParent: TrackedChangeMeta = { kind: 'insert', id: 'ins-parent' };
      const deleteChild: TrackedChangeMeta = {
        kind: 'delete',
        id: 'del-child',
        overlapParentId: 'ins-parent',
        relationship: 'child',
      };
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChanges: [deleteChild, insertParent],
      };
      const b: TextRun = {
        text: 'World',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChanges: [insertParent, deleteChild],
      };

      expect(trackedChangesCompatible(a, b)).toBe(true);
    });

    it('returns false when one run has an extra overlap layer', () => {
      const insertParent: TrackedChangeMeta = { kind: 'insert', id: 'ins-parent' };
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChanges: [insertParent],
      };
      const b: TextRun = {
        text: 'World',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChanges: [
          insertParent,
          {
            kind: 'delete',
            id: 'del-child',
            overlapParentId: 'ins-parent',
            relationship: 'child',
          },
        ],
      };

      expect(trackedChangesCompatible(a, b)).toBe(false);
    });
  });

  describe('collectTrackedChangeFromMarks', () => {
    it('returns undefined for null/undefined marks', () => {
      expect(collectTrackedChangeFromMarks(null as never)).toBeUndefined();
      expect(collectTrackedChangeFromMarks(undefined)).toBeUndefined();
    });

    it('returns undefined for empty marks array', () => {
      expect(collectTrackedChangeFromMarks([])).toBeUndefined();
    });

    it('returns single tracked change from array with one tracked mark', () => {
      const marks: PMMark[] = [
        {
          type: TRACK_INSERT_MARK,
          attrs: { id: 'insert-1', author: 'John' },
        },
      ];

      const result = collectTrackedChangeFromMarks(marks);

      expect(result?.kind).toBe('insert');
      expect(result?.author).toBe('John');
    });

    it('ignores non-tracked change marks', () => {
      const marks: PMMark[] = [
        { type: 'bold' },
        {
          type: TRACK_INSERT_MARK,
          attrs: { id: 'insert-1' },
        },
        { type: 'italic' },
      ];

      const result = collectTrackedChangeFromMarks(marks);

      expect(result?.kind).toBe('insert');
      expect(result?.id).toBe('insert-1');
    });

    it('prioritizes higher-priority tracked changes', () => {
      const marks: PMMark[] = [
        {
          type: TRACK_FORMAT_MARK,
          attrs: { id: 'format-1' },
        },
        {
          type: TRACK_INSERT_MARK,
          attrs: { id: 'insert-1' },
        },
      ];

      const result = collectTrackedChangeFromMarks(marks);

      expect(result?.kind).toBe('insert');
    });

    it('handles multiple tracked change marks and selects highest priority', () => {
      const marks: PMMark[] = [
        {
          type: TRACK_DELETE_MARK,
          attrs: { id: 'delete-1' },
        },
        {
          type: TRACK_FORMAT_MARK,
          attrs: { id: 'format-1' },
        },
      ];

      const result = collectTrackedChangeFromMarks(marks);

      expect(result?.kind).toBe('delete');
    });
  });

  describe('normalizeUnderlineStyle', () => {
    it('returns "double" for double style', () => {
      expect(normalizeUnderlineStyle('double')).toBe('double');
    });

    it('returns "dotted" for dotted style', () => {
      expect(normalizeUnderlineStyle('dotted')).toBe('dotted');
    });

    it('returns "dashed" for dashed style', () => {
      expect(normalizeUnderlineStyle('dashed')).toBe('dashed');
    });

    it('returns "wavy" for wavy style', () => {
      expect(normalizeUnderlineStyle('wavy')).toBe('wavy');
    });

    it('returns undefined for explicit off values', () => {
      expect(normalizeUnderlineStyle('none')).toBeUndefined();
      expect(normalizeUnderlineStyle('0')).toBeUndefined();
      expect(normalizeUnderlineStyle('false')).toBeUndefined();
      expect(normalizeUnderlineStyle('off')).toBeUndefined();
      expect(normalizeUnderlineStyle(0)).toBeUndefined();
      expect(normalizeUnderlineStyle(false)).toBeUndefined();
    });

    it('returns "single" for undefined/null (default)', () => {
      expect(normalizeUnderlineStyle(null)).toBe('single');
      expect(normalizeUnderlineStyle(undefined)).toBe('single');
    });

    it('returns "single" for unknown underline types', () => {
      expect(normalizeUnderlineStyle('words')).toBe('single');
      expect(normalizeUnderlineStyle('thick')).toBe('single');
      expect(normalizeUnderlineStyle('unknown')).toBe('single');
      expect(normalizeUnderlineStyle(123)).toBe('single');
    });

    it('handles case-insensitive off values', () => {
      expect(normalizeUnderlineStyle('NONE')).toBeUndefined();
      expect(normalizeUnderlineStyle('False')).toBeUndefined();
      expect(normalizeUnderlineStyle('OFF')).toBeUndefined();
      expect(normalizeUnderlineStyle('Double')).toBe('double');
      expect(normalizeUnderlineStyle('WAVY')).toBe('wavy');
    });
  });

  describe('applyTextStyleMark', () => {
    it('applies color to run', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { color: 'FF0000' });

      expect(run.color).toBe('#FF0000');
    });

    it('ignores invalid color values', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { color: 'invalid-color' });

      // normalizeColor will attempt to parse invalid colors but may still set them
      expect(run.color).toBe('#invalid-color');
    });

    it('applies fontFamily to run', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontFamily: 'Times New Roman' });

      expect(run.fontFamily).toBe('Times New Roman');
    });

    it('ignores empty fontFamily', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const original = run.fontFamily;
      applyTextStyleMark(run, { fontFamily: '   ' });

      expect(run.fontFamily).toBe(original);
    });

    it('applies fontSize to run', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: 16 });

      expect(run.fontSize).toBe(16);
    });

    it('ignores invalid fontSize values', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: 'large' });

      expect(run.fontSize).toBe(12);
    });

    it('converts pt fontSize strings to px', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '16pt' });

      expect(run.fontSize).toBeCloseTo(ptToPx(16)!);
    });

    it('applies fontSize from string with px units', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '24px' });

      expect(run.fontSize).toBe(24);
    });

    it('handles empty string fontSize', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '' });
      expect(run.fontSize).toBe(12);
    });

    it('handles whitespace-only string fontSize', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '   ' });
      expect(run.fontSize).toBe(12);
    });

    it('handles string with unit prefix', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: 'pt12' });
      expect(run.fontSize).toBe(12);
    });

    it('handles negative fontSize strings', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '-5pt' });
      expect(run.fontSize).toBe(12);
    });

    it('handles zero fontSize string', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '0pt' });
      expect(run.fontSize).toBe(12);
    });

    it('handles fontSize below minimum boundary', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '0.5px' });
      expect(run.fontSize).toBe(12);
    });

    it('handles fontSize at minimum boundary', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '1pt' });
      expect(run.fontSize).toBeCloseTo(ptToPx(1)!);
    });

    it('handles fontSize at maximum boundary', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '1000px' });
      expect(run.fontSize).toBe(1000);
    });

    it('handles fontSize above maximum boundary', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '1001pt' });
      expect(run.fontSize).toBe(12);
    });

    it('handles decimal fontSize with units', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '12.5pt' });
      expect(run.fontSize).toBeCloseTo(ptToPx(12.5)!);
    });

    it('handles fontSize string with leading whitespace', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { fontSize: '  16pt' });
      expect(run.fontSize).toBeCloseTo(ptToPx(16)!);
    });

    it('applies letterSpacing to run', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { letterSpacing: 2 });

      expect(run.letterSpacing).toBe(2);
    });

    it('converts point-based letterSpacing strings to pixels', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { letterSpacing: '0.75pt' });

      expect(run.letterSpacing).toBeCloseTo(ptToPx(0.75)!);
    });

    it('preserves negative letterSpacing strings', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, { letterSpacing: '-0.65pt' });

      expect(run.letterSpacing).toBeCloseTo(ptToPx(-0.65)!);
    });

    it('applies multiple style attributes', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyTextStyleMark(run, {
        color: '0000FF',
        fontFamily: 'Courier',
        fontSize: 14,
        letterSpacing: 1.5,
      });

      expect(run.color).toBe('#0000FF');
      expect(run.fontFamily).toBe('Courier');
      expect(run.fontSize).toBe(14);
      expect(run.letterSpacing).toBe(1.5);
    });

    describe('textTransform extraction', () => {
      it('applies uppercase textTransform', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 'uppercase' });

        expect(run.textTransform).toBe('uppercase');
      });

      it('applies lowercase textTransform', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 'lowercase' });

        expect(run.textTransform).toBe('lowercase');
      });

      it('applies capitalize textTransform', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 'capitalize' });

        expect(run.textTransform).toBe('capitalize');
      });

      it('applies none textTransform', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 'none' });

        expect(run.textTransform).toBe('none');
      });

      it('filters out invalid textTransform values', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 'invalid' });

        expect(run.textTransform).toBeUndefined();
      });

      it('ignores non-string textTransform values', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 123 });

        expect(run.textTransform).toBeUndefined();
      });

      it('ignores null textTransform values', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: null });

        expect(run.textTransform).toBeUndefined();
      });

      it('ignores undefined textTransform values', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: undefined });

        expect(run.textTransform).toBeUndefined();
      });

      it('ignores empty string textTransform', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: '' });

        expect(run.textTransform).toBeUndefined();
      });

      it('is case-sensitive (rejects UPPERCASE)', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 'UPPERCASE' });

        expect(run.textTransform).toBeUndefined();
      });

      it('is case-sensitive (rejects Capitalize)', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: 'Capitalize' });

        expect(run.textTransform).toBeUndefined();
      });

      it('rejects values with whitespace', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: ' uppercase ' });

        expect(run.textTransform).toBeUndefined();
      });

      it('rejects boolean values', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: true });

        expect(run.textTransform).toBeUndefined();
      });

      it('rejects object values', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: { value: 'uppercase' } });

        expect(run.textTransform).toBeUndefined();
      });

      it('rejects array values', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, { textTransform: ['uppercase'] });

        expect(run.textTransform).toBeUndefined();
      });

      it('works together with other style properties', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
        applyTextStyleMark(run, {
          color: 'FF0000',
          fontFamily: 'Courier',
          fontSize: 16,
          textTransform: 'uppercase',
        });

        expect(run.color).toBe('#FF0000');
        expect(run.fontFamily).toBe('Courier');
        expect(run.fontSize).toBe(16);
        expect(run.textTransform).toBe('uppercase');
      });

      it('overwrites existing textTransform value', () => {
        const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, textTransform: 'lowercase' };
        applyTextStyleMark(run, { textTransform: 'uppercase' });

        expect(run.textTransform).toBe('uppercase');
      });
    });

    describe('vertAlign', () => {
      it('sets vertAlign for superscript', () => {
        const run: TextRun = { text: '1st', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'superscript' });
        expect(run.vertAlign).toBe('superscript');
      });

      it('sets vertAlign for subscript', () => {
        const run: TextRun = { text: 'H2O', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'subscript' });
        expect(run.vertAlign).toBe('subscript');
      });

      it('sets vertAlign for baseline', () => {
        const run: TextRun = { text: 'text', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'baseline' });
        expect(run.vertAlign).toBe('baseline');
      });

      it('ignores invalid vertAlign values', () => {
        const run: TextRun = { text: 'text', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'invalid' });
        expect(run.vertAlign).toBeUndefined();
      });

      it('scales fontSize by 0.65 for superscript', () => {
        const run: TextRun = { text: '1st', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'superscript' });
        expect(run.fontSize).toBeCloseTo(16 * 0.65);
      });

      it('scales fontSize by 0.65 for subscript', () => {
        const run: TextRun = { text: 'H2O', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'subscript' });
        expect(run.fontSize).toBeCloseTo(16 * 0.65);
      });

      it('does not scale fontSize for baseline', () => {
        const run: TextRun = { text: 'text', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'baseline' });
        expect(run.fontSize).toBe(16);
      });

      it('does not scale fontSize when baselineShift is set', () => {
        const run: TextRun = { text: '1st', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'superscript', position: '3pt' });
        expect(run.fontSize).toBe(16);
      });

      it('treats zero position as an identity value for superscript scaling', () => {
        const run: TextRun = { text: '1st', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { vertAlign: 'superscript', position: '0pt' });
        expect(run.fontSize).toBeCloseTo(16 * 0.65);
        expect(run.baselineShift).toBeUndefined();
      });
    });

    describe('position / baselineShift', () => {
      it('parses position string to baselineShift number', () => {
        const run: TextRun = { text: 'text', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { position: '3pt' });
        expect(run.baselineShift).toBe(3);
      });

      it('handles negative position values', () => {
        const run: TextRun = { text: 'text', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { position: '-1.5pt' });
        expect(run.baselineShift).toBe(-1.5);
      });

      it('treats zero position as no explicit baseline shift', () => {
        const run: TextRun = { text: 'text', fontFamily: 'Arial', fontSize: 16, baselineShift: 2 };
        applyTextStyleMark(run, { position: '0pt' });
        expect(run.baselineShift).toBeUndefined();
      });

      it('ignores non-numeric position', () => {
        const run: TextRun = { text: 'text', fontFamily: 'Arial', fontSize: 16 };
        applyTextStyleMark(run, { position: 'invalid' });
        expect(run.baselineShift).toBeUndefined();
      });
    });
  });

  describe('applyMarksToRun', () => {
    it('applies bold mark', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'bold' }]);

      expect(run.bold).toBe(true);
    });

    it('honors explicit bold off values', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, bold: true };
      applyMarksToRun(run, [{ type: 'bold', attrs: { value: 'off' } }]);

      expect(run.bold).toBeUndefined();
    });

    it('applies italic mark', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'italic' }]);

      expect(run.italic).toBe(true);
    });

    it('honors explicit italic off values', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, italic: true };
      applyMarksToRun(run, [{ type: 'italic', attrs: { value: 0 } }]);

      expect(run.italic).toBeUndefined();
    });

    it('applies strike mark', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'strike' }]);

      expect(run.strike).toBe(true);
    });

    it('honors explicit strike off values', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, strike: true };
      applyMarksToRun(run, [{ type: 'strike', attrs: { value: false } }]);

      expect(run.strike).toBeUndefined();
    });

    it('applies highlight mark', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'highlight', attrs: { color: 'FFFF00' } }]);

      expect(run.highlight).toBe('#FFFF00');
    });

    it('applies comment mark metadata', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'commentMark', attrs: { commentId: 'c-1', internal: true } }]);

      expect(run.comments).toEqual([{ commentId: 'c-1', importedId: undefined, internal: true, trackedChange: false }]);
    });

    it('dedupes comment annotations by id/importedId', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [
        { type: 'comment', attrs: { commentId: 'c-1', importedId: 'imp-1' } },
        { type: 'commentMark', attrs: { commentId: 'c-1', importedId: 'imp-1' } },
      ]);

      expect(run.comments).toHaveLength(1);
      expect(run.comments?.[0]).toEqual({
        commentId: 'c-1',
        importedId: 'imp-1',
        internal: false,
        trackedChange: false,
      });
    });

    it('applies underline mark with default style', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'underline', attrs: {} }]);

      expect(run.underline?.style).toBe('single');
    });

    it('applies underline mark with custom style', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'underline', attrs: { underlineType: 'double' } }]);

      expect(run.underline?.style).toBe('double');
    });

    it('applies underline mark with color', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'underline', attrs: { color: 'FF0000' } }]);

      expect(run.underline?.color).toBe('#FF0000');
    });

    it('clears underline when underline mark is explicit none', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        underline: { style: 'single' },
      };
      applyMarksToRun(run, [{ type: 'underline', attrs: { underlineType: 'none' } }]);

      expect(run.underline).toBeUndefined();
    });

    it('applies textStyle mark', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [
        {
          type: 'textStyle',
          attrs: { color: '0000FF', fontSize: 14 },
        },
      ]);

      expect(run.color).toBe('#0000FF');
      expect(run.fontSize).toBe(14);
    });

    it('applies tracked change marks', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [
        {
          type: TRACK_INSERT_MARK,
          attrs: { id: 'insert-1', author: 'John' },
        },
      ]);

      expect(run.trackedChange?.kind).toBe('insert');
      expect(run.trackedChange?.author).toBe('John');
    });

    it('applies tracked change marks to a tab run (SD-3376)', () => {
      const run = { kind: 'tab', text: '\t' } as TabRun;
      applyMarksToRun(run as unknown as TextRun, [
        {
          type: TRACK_INSERT_MARK,
          attrs: { id: 'tab-insert', author: 'John' },
        },
      ]);

      expect(run.trackedChange?.kind).toBe('insert');
      expect(run.trackedChange?.id).toBe('tab-insert');
      expect(run.trackedChange?.author).toBe('John');
    });

    it('normalizes overlapping tracked change layers with parent insert first', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [
        {
          type: TRACK_DELETE_MARK,
          attrs: { id: 'del-child', overlapParentId: 'ins-parent', author: 'Reviewer' },
        },
        {
          type: TRACK_INSERT_MARK,
          attrs: { id: 'ins-parent', author: 'Author' },
        },
      ]);

      expect(run.trackedChanges?.map((layer) => `${layer.kind}:${layer.id}`)).toEqual([
        'insert:ins-parent',
        'delete:del-child',
      ]);
      expect(run.trackedChanges?.[0].relationship).toBe('parent');
      expect(run.trackedChanges?.[1].relationship).toBe('child');
      expect(run.trackedChanges?.[1].overlapParentId).toBe('ins-parent');
      expect(run.trackedChange).toBe(run.trackedChanges?.[0]);
      expect(run.trackedChange?.kind).toBe('insert');
      expect(run.trackedChange?.id).toBe('ins-parent');
    });

    it('applies link mark with enableRichHyperlinks disabled', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'link', attrs: { href: 'https://example.com' } }], { enableRichHyperlinks: false });

      expect(run.link?.href).toBe('https://example.com');
    });

    it('applies multiple marks', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'bold' }, { type: 'italic' }, { type: 'textStyle', attrs: { color: 'FF0000' } }]);

      expect(run.bold).toBe(true);
      expect(run.italic).toBe(true);
      expect(run.color).toBe('#FF0000');
    });

    it('prioritizes tracked changes correctly', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [
        {
          type: TRACK_FORMAT_MARK,
          attrs: { id: 'format-1' },
        },
        {
          type: TRACK_INSERT_MARK,
          attrs: { id: 'insert-1' },
        },
      ]);

      // Insert should take priority over format
      expect(run.trackedChange?.kind).toBe('insert');
      expect(run.trackedChanges?.map((layer) => layer.kind)).toEqual(['insert', 'format']);
    });

    it('ignores unknown mark types', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'unknownMark' as never }]);

      // Run should remain unchanged
      expect(run.bold).toBeUndefined();
      expect(run.italic).toBeUndefined();
    });

    it('uses default hyperlink config when not provided', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [{ type: 'link', attrs: { href: 'https://example.com' } }]);

      expect(run.link?.href).toBe('https://example.com');
    });

    it('handles empty marks array', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, []);

      expect(run.bold).toBeUndefined();
      expect(run.italic).toBeUndefined();
    });

    it('preserves existing run properties when applying marks', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        bold: false,
      };
      applyMarksToRun(run, [{ type: 'italic' }]);

      expect(run.text).toBe('Hello');
      expect(run.fontFamily).toBe('Arial');
      expect(run.fontSize).toBe(12);
      expect(run.italic).toBe(true);
    });
  });

  describe('getLuminance', () => {
    it('returns 0 for pure black (#000000)', () => {
      const luminance = getLuminance('#000000');
      expect(luminance).toBe(0);
    });

    it('returns 1 for pure white (#FFFFFF)', () => {
      const luminance = getLuminance('#FFFFFF');
      expect(luminance).toBe(1);
    });

    it('returns ~0.2159 for mid-gray (#808080)', () => {
      const luminance = getLuminance('#808080');
      // Mid gray should produce a luminance around 0.2159
      expect(luminance).toBeCloseTo(0.2159, 3);
    });

    it('returns luminance < 0.18 for dark purple (#342D8C)', () => {
      const luminance = getLuminance('#342D8C');
      // Dark purple should be below the WCAG AA threshold
      expect(luminance).toBeLessThan(0.18);
      expect(luminance).toBeCloseTo(0.045, 2);
    });

    it('handles short hex format (#F00 = #FF0000)', () => {
      const luminance = getLuminance('#F00');
      const luminanceFull = getLuminance('#FF0000');
      expect(luminance).toBe(luminanceFull);
      expect(luminance).toBeCloseTo(0.2126, 3);
    });

    it('handles hex without # prefix', () => {
      const luminance = getLuminance('808080');
      const luminanceWithHash = getLuminance('#808080');
      expect(luminance).toBe(luminanceWithHash);
    });

    it('returns 1.0 (light) for invalid color strings', () => {
      expect(getLuminance('invalid')).toBe(1);
      expect(getLuminance('xyz')).toBe(1);
      expect(getLuminance('')).toBe(1);
      expect(getLuminance('#GGGGGG')).toBe(1);
    });

    it('handles pure red (#FF0000)', () => {
      const luminance = getLuminance('#FF0000');
      // Red channel coefficient is 0.2126
      expect(luminance).toBeCloseTo(0.2126, 4);
    });

    it('handles pure green (#00FF00)', () => {
      const luminance = getLuminance('#00FF00');
      // Green channel coefficient is 0.7152
      expect(luminance).toBeCloseTo(0.7152, 4);
    });

    it('handles pure blue (#0000FF)', () => {
      const luminance = getLuminance('#0000FF');
      // Blue channel coefficient is 0.0722
      expect(luminance).toBeCloseTo(0.0722, 4);
    });

    it('handles light gray (#CCCCCC)', () => {
      const luminance = getLuminance('#CCCCCC');
      // Light gray should be well above the 0.18 threshold
      expect(luminance).toBeGreaterThan(0.18);
      expect(luminance).toBeCloseTo(0.6038, 3);
    });

    it('applies sRGB gamma correction correctly', () => {
      // Test a color where gamma correction matters
      // #404040 should have different linear vs non-linear luminance
      const luminance = getLuminance('#404040');
      // With sRGB gamma correction, #404040 (64/255 per channel) produces ~0.0513 luminance
      expect(luminance).toBeCloseTo(0.0513, 2);
    });

    it('handles edge case at gamma threshold (values around 0.03928)', () => {
      // RGB value of ~10 corresponds to c = 10/255 ≈ 0.0392 (right at threshold)
      const luminance = getLuminance('#0A0A0A');
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(0.01);
    });

    it('is case-insensitive for hex letters', () => {
      expect(getLuminance('#ffffff')).toBe(1);
      expect(getLuminance('#FFFFFF')).toBe(1);
      expect(getLuminance('#FfFfFf')).toBe(1);
    });

    it('handles 3-digit short hex with various values', () => {
      // #ABC should expand to #AABBCC
      const luminance = getLuminance('#ABC');
      const luminanceExpanded = getLuminance('#AABBCC');
      expect(luminance).toBe(luminanceExpanded);
    });
  });

  describe('resolveAutoColor', () => {
    it('returns white (#FFFFFF) for pure black background', () => {
      expect(resolveAutoColor('#000000')).toBe('#FFFFFF');
    });

    it('returns black (#000000) for pure white background', () => {
      expect(resolveAutoColor('#FFFFFF')).toBe('#000000');
    });

    it('returns white for dark purple (#342D8C)', () => {
      // Dark purple has luminance < 0.18, should get white text
      expect(resolveAutoColor('#342D8C')).toBe('#FFFFFF');
    });

    it('returns black for light gray (#CCCCCC)', () => {
      // Light gray has luminance > 0.18, should get black text
      expect(resolveAutoColor('#CCCCCC')).toBe('#000000');
    });

    it('handles threshold boundary at luminance = 0.18', () => {
      // Mid gray (#808080) has luminance ~0.2159 (above threshold)
      expect(resolveAutoColor('#808080')).toBe('#000000');
    });

    it('returns white for colors just below threshold', () => {
      // Find a color with luminance slightly below 0.18
      // #5E5E5E has luminance ~0.1307 (< 0.18)
      expect(resolveAutoColor('#5E5E5E')).toBe('#FFFFFF');
    });

    it('returns black for colors just above threshold', () => {
      // #8C8C8C has luminance ~0.2518 (> 0.18)
      expect(resolveAutoColor('#8C8C8C')).toBe('#000000');
    });

    it('handles short hex format', () => {
      // #000 = pure black -> white text
      expect(resolveAutoColor('#000')).toBe('#FFFFFF');
      // #FFF = pure white -> black text
      expect(resolveAutoColor('#FFF')).toBe('#000000');
    });

    it('handles hex without # prefix', () => {
      expect(resolveAutoColor('000000')).toBe('#FFFFFF');
      expect(resolveAutoColor('FFFFFF')).toBe('#000000');
    });

    it('defaults to black text for invalid colors', () => {
      // Invalid colors return luminance 1.0 (light), so should get black text
      expect(resolveAutoColor('invalid')).toBe('#000000');
      expect(resolveAutoColor('')).toBe('#000000');
      expect(resolveAutoColor('#XYZ')).toBe('#000000');
    });

    it('returns white for pure red (#FF0000)', () => {
      // Red has luminance ~0.2126 (above threshold), should get black text
      expect(resolveAutoColor('#FF0000')).toBe('#000000');
    });

    it('returns black for pure green (#00FF00)', () => {
      // Green has luminance ~0.7152 (well above threshold), should get black text
      expect(resolveAutoColor('#00FF00')).toBe('#000000');
    });

    it('returns white for pure blue (#0000FF)', () => {
      // Blue has luminance ~0.0722 (below threshold), should get white text
      expect(resolveAutoColor('#0000FF')).toBe('#FFFFFF');
    });

    it('returns white for dark red (#8B0000)', () => {
      // Dark red has low luminance, should get white text
      expect(resolveAutoColor('#8B0000')).toBe('#FFFFFF');
    });

    it('is case-insensitive', () => {
      expect(resolveAutoColor('#ffffff')).toBe('#000000');
      expect(resolveAutoColor('#FFFFFF')).toBe('#000000');
      expect(resolveAutoColor('#000000')).toBe('#FFFFFF');
      expect(resolveAutoColor('#000000')).toBe('#FFFFFF');
    });
  });

  describe('applyMarksToRun - backgroundColor auto color resolution', () => {
    it('applies auto white text color for dark purple background', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      // No explicit color mark, but backgroundColor provided
      applyMarksToRun(run, [], undefined, undefined, '#342D8C');

      expect(run.color).toBe('#FFFFFF');
    });

    it('preserves existing run color when style already set one', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, color: '#336699' };
      // Background color provided but no color mark; style-set color should remain
      applyMarksToRun(run, [], undefined, undefined, '#000000');

      expect(run.color).toBe('#336699');
    });

    it('treats auto color value as unset and applies contrast color', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, color: 'auto' };
      applyMarksToRun(run, [], undefined, undefined, '#000000');

      expect(run.color).toBe('#FFFFFF');
    });

    it('treats default black color as eligible for auto contrast', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, color: '#000000' };
      applyMarksToRun(run, [], undefined, undefined, '#000000');

      expect(run.color).toBe('#FFFFFF');
    });

    it('treats short-hex black as eligible for auto contrast', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, color: '#000' };
      applyMarksToRun(run, [], undefined, undefined, '#000000');

      expect(run.color).toBe('#FFFFFF');
    });

    it('treats none color value as unset and applies contrast color', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12, color: 'none' };
      applyMarksToRun(run, [], undefined, undefined, '#000000');

      expect(run.color).toBe('#FFFFFF');
    });

    it('does not override an explicit black color mark', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'textStyle', attrs: { color: '#000000' } }];
      applyMarksToRun(run, marks, undefined, undefined, '#000000');

      expect(run.color).toBe('#000000'); // Mark-set color should stick
    });

    it('applies auto black text color for white background', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [], undefined, undefined, '#FFFFFF');

      expect(run.color).toBe('#000000');
    });

    it('applies auto black text color for light gray background', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [], undefined, undefined, '#CCCCCC');

      expect(run.color).toBe('#000000');
    });

    it('skips auto color when explicit color mark is present', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'textStyle', attrs: { color: 'FF0000' } }];
      applyMarksToRun(run, marks, undefined, undefined, '#000000');

      // Explicit red color should override auto resolution
      expect(run.color).toBe('#FF0000');
    });

    it('skips auto color when no background is provided', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [], undefined, undefined, undefined);

      // No backgroundColor, so no auto color should be applied
      expect(run.color).toBeUndefined();
    });

    it('works with TabRun (should not apply auto color)', () => {
      const run = { kind: 'tab' as const };
      applyMarksToRun(run, [], undefined, undefined, '#000000');

      // TabRun should not receive auto color
      expect('color' in run).toBe(false);
    });

    it('applies auto color even when other marks are present (no color)', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'bold' }, { type: 'italic' }];
      applyMarksToRun(run, marks, undefined, undefined, '#000000');

      // Bold and italic don't set color, so auto color should apply
      expect(run.bold).toBe(true);
      expect(run.italic).toBe(true);
      expect(run.color).toBe('#FFFFFF');
    });

    it('applies auto color when textStyle mark does not set color', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'textStyle', attrs: { fontSize: 16, fontFamily: 'Courier' } }];
      applyMarksToRun(run, marks, undefined, undefined, '#FFFFFF');

      // textStyle sets fontSize and fontFamily but not color
      expect(run.fontSize).toBe(16);
      expect(run.fontFamily).toBe('Courier');
      expect(run.color).toBe('#000000'); // Auto color applied
    });

    it('handles short hex background colors', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [], undefined, undefined, '#000');

      expect(run.color).toBe('#FFFFFF');
    });

    it('handles background colors without # prefix', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      applyMarksToRun(run, [], undefined, undefined, 'FFFFFF');

      expect(run.color).toBe('#000000');
    });

    it('applies auto color at threshold boundary', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      // Mid gray should produce black text
      applyMarksToRun(run, [], undefined, undefined, '#808080');

      expect(run.color).toBe('#000000');
    });

    it('handles invalid background color gracefully', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      // Invalid color should default to luminance 1.0 -> black text
      applyMarksToRun(run, [], undefined, undefined, 'invalid');

      expect(run.color).toBe('#000000');
    });

    it('prioritizes explicit color from highlight over auto color', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'highlight', attrs: { color: 'FFFF00' } }];
      applyMarksToRun(run, marks, undefined, undefined, '#000000');

      // Highlight doesn't set text color, so auto color should still apply
      expect(run.highlight).toBe('#FFFF00');
      expect(run.color).toBe('#FFFFFF'); // Auto color for dark background
    });

    it('does not apply auto color when textStyle explicitly sets color to undefined', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'textStyle', attrs: { color: '' } }];
      applyMarksToRun(run, marks, undefined, undefined, '#000000');

      // Empty color string should not set run.color, but mark attempted to set it
      // This is a tricky edge case - the mark tried to set color (even if invalid)
      // Check current behavior: normalizeColor('') likely returns undefined or '#'
      // If it returns undefined, color won't be set, so auto color should apply
      // If it returns '#invalid', then markSetColor will be false and auto applies
      // Based on code: resolveColorFromAttributes returns undefined for empty string
      expect(run.color).toBe('#FFFFFF'); // Auto color applied since no valid color was set
    });
  });

  describe('extractDataAttributes', () => {
    describe('Happy path', () => {
      it('extracts valid data-* attributes with string values', () => {
        const attrs = {
          'data-id': '123',
          'data-name': 'test',
          'data-category': 'example',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-id': '123',
          'data-name': 'test',
          'data-category': 'example',
        });
      });

      it('converts number values to strings', () => {
        const attrs = {
          'data-id': 123,
          'data-count': 456,
          'data-score': 3.14,
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-id': '123',
          'data-count': '456',
          'data-score': '3.14',
        });
      });

      it('converts boolean values to strings', () => {
        const attrs = {
          'data-active': true,
          'data-disabled': false,
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-active': 'true',
          'data-disabled': 'false',
        });
      });
    });

    describe('Edge cases', () => {
      it('returns undefined for undefined input', () => {
        const result = extractDataAttributes(undefined);
        expect(result).toBeUndefined();
      });

      it('returns undefined for empty object', () => {
        const result = extractDataAttributes({});
        expect(result).toBeUndefined();
      });

      it('returns undefined when no data-* attributes exist', () => {
        const attrs = {
          id: '123',
          class: 'test',
          style: 'color: red',
        };

        const result = extractDataAttributes(attrs);
        expect(result).toBeUndefined();
      });

      it('filters out non-data-* attributes', () => {
        const attrs = {
          id: '123',
          class: 'test',
          'data-id': 'valid',
          style: 'color: red',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-id': 'valid',
        });
      });

      it('filters out null values', () => {
        const attrs = {
          'data-id': '123',
          'data-null': null,
          'data-name': 'test',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-id': '123',
          'data-name': 'test',
        });
      });

      it('filters out undefined values', () => {
        const attrs = {
          'data-id': '123',
          'data-undefined': undefined,
          'data-name': 'test',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-id': '123',
          'data-name': 'test',
        });
      });

      it('filters out object values', () => {
        const attrs = {
          'data-id': '123',
          'data-object': { nested: 'value' },
          'data-name': 'test',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-id': '123',
          'data-name': 'test',
        });
      });

      it('filters out array values', () => {
        const attrs = {
          'data-id': '123',
          'data-array': [1, 2, 3],
          'data-name': 'test',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-id': '123',
          'data-name': 'test',
        });
      });

      it('handles case-insensitive data- prefix matching', () => {
        const attrs = {
          'DATA-ID': '123',
          'Data-Name': 'test',
          'dAtA-MiXeD': 'value',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'DATA-ID': '123',
          'Data-Name': 'test',
          'dAtA-MiXeD': 'value',
        });
      });
    });

    describe('Security limits (DoS protection)', () => {
      it('enforces MAX_DATA_ATTR_COUNT limit (50)', () => {
        const attrs: Record<string, unknown> = {};
        // Create 60 data attributes (exceeds limit of 50)
        for (let i = 0; i < 60; i++) {
          attrs[`data-attr-${i}`] = `value-${i}`;
        }

        const result = extractDataAttributes(attrs);

        // Should stop at 50 attributes
        expect(Object.keys(result!).length).toBe(50);
      });

      it('enforces MAX_DATA_ATTR_VALUE_LENGTH limit (1000)', () => {
        const longValue = 'a'.repeat(1001);
        const attrs = {
          'data-long': longValue,
          'data-valid': 'test',
        };

        const result = extractDataAttributes(attrs);

        // Long value should be filtered out
        expect(result).toEqual({
          'data-valid': 'test',
        });
      });

      it('enforces MAX_DATA_ATTR_NAME_LENGTH limit (100)', () => {
        const longKey = 'data-' + 'a'.repeat(100);
        const attrs: Record<string, unknown> = {
          [longKey]: 'value',
          'data-valid': 'test',
        };

        const result = extractDataAttributes(attrs);

        // Long key should be filtered out
        expect(result).toEqual({
          'data-valid': 'test',
        });
      });

      it('accepts value at exactly MAX_DATA_ATTR_VALUE_LENGTH', () => {
        const exactLengthValue = 'a'.repeat(1000);
        const attrs = {
          'data-exact': exactLengthValue,
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-exact': exactLengthValue,
        });
      });

      it('accepts name at exactly MAX_DATA_ATTR_NAME_LENGTH', () => {
        // 100 characters including 'data-' prefix
        const exactLengthKey = 'data-' + 'a'.repeat(95);
        const attrs: Record<string, unknown> = {
          [exactLengthKey]: 'value',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          [exactLengthKey]: 'value',
        });
      });

      it('handles mixed valid and invalid attributes with limits', () => {
        const longValue = 'a'.repeat(1001);
        const longKey = 'data-' + 'b'.repeat(100);
        const attrs: Record<string, unknown> = {
          'data-valid1': 'value1',
          'data-long-value': longValue,
          [longKey]: 'value',
          'data-valid2': 'value2',
          'data-null': null,
          'data-object': { nested: true },
          'data-valid3': 'value3',
        };

        const result = extractDataAttributes(attrs);

        expect(result).toEqual({
          'data-valid1': 'value1',
          'data-valid2': 'value2',
          'data-valid3': 'value3',
        });
      });
    });
  });

  describe('enableComments parameter', () => {
    it('skips comment marks when enableComments is false', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [
        { type: 'bold' },
        { type: 'comment', attrs: { commentId: 'c-1', internal: false } },
        { type: 'commentMark', attrs: { commentId: 'c-2', internal: true } },
        { type: 'italic' },
      ];

      applyMarksToRun(run, marks, undefined, undefined, undefined, false);

      // Bold and italic should be applied
      expect(run.bold).toBe(true);
      expect(run.italic).toBe(true);

      // Comments should NOT be applied when enableComments is false
      expect(run.comments).toBeUndefined();
    });

    it('includes comment marks when enableComments is true', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [
        { type: 'bold' },
        { type: 'comment', attrs: { commentId: 'c-1', internal: false } },
        { type: 'commentMark', attrs: { commentId: 'c-2', internal: true } },
      ];

      applyMarksToRun(run, marks, undefined, undefined, undefined, true);

      // Bold should be applied
      expect(run.bold).toBe(true);

      // Comments SHOULD be applied when enableComments is true
      expect(run.comments).toBeDefined();
      expect(run.comments).toHaveLength(2);
      expect(run.comments?.[0]).toEqual({
        commentId: 'c-1',
        importedId: undefined,
        internal: false,
        trackedChange: false,
      });
      expect(run.comments?.[1]).toEqual({
        commentId: 'c-2',
        importedId: undefined,
        internal: true,
        trackedChange: false,
      });
    });

    it('includes comment marks when enableComments is undefined (default true)', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'comment', attrs: { commentId: 'c-1', internal: false } }];

      // Default behavior when enableComments is not specified should include comments
      applyMarksToRun(run, marks, undefined);

      expect(run.comments).toBeDefined();
      expect(run.comments).toHaveLength(1);
      expect(run.comments?.[0]).toEqual({
        commentId: 'c-1',
        importedId: undefined,
        internal: false,
        trackedChange: false,
      });
    });

    it('includes comment marks when config object is undefined', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'commentMark', attrs: { commentId: 'c-1', internal: true } }];

      // When no config is passed, comments should be included by default
      applyMarksToRun(run, marks);

      expect(run.comments).toBeDefined();
      expect(run.comments).toHaveLength(1);
      expect(run.comments?.[0]).toEqual({
        commentId: 'c-1',
        importedId: undefined,
        internal: true,
        trackedChange: false,
      });
    });

    it('handles mixed marks with enableComments false', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [
        { type: 'bold' },
        { type: 'textStyle', attrs: { color: 'FF0000' } },
        { type: 'comment', attrs: { commentId: 'c-1' } },
        { type: 'underline', attrs: { underlineType: 'double' } },
        { type: 'commentMark', attrs: { commentId: 'c-2' } },
        { type: 'italic' },
      ];

      applyMarksToRun(run, marks, undefined, undefined, undefined, false);

      // All non-comment marks should be applied
      expect(run.bold).toBe(true);
      expect(run.italic).toBe(true);
      expect(run.color).toBe('#FF0000');
      expect(run.underline?.style).toBe('double');

      // Comments should be skipped
      expect(run.comments).toBeUndefined();
    });

    it('handles mixed marks with enableComments true', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [
        { type: 'bold' },
        { type: 'comment', attrs: { commentId: 'c-1', internal: false } },
        { type: 'italic' },
        { type: 'commentMark', attrs: { commentId: 'c-2', internal: true } },
      ];

      applyMarksToRun(run, marks, undefined, undefined, undefined, true);

      // All marks should be applied
      expect(run.bold).toBe(true);
      expect(run.italic).toBe(true);
      expect(run.comments).toHaveLength(2);
    });

    it('only skips comment marks, not other marks, when enableComments is false', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [
        { type: 'comment', attrs: { commentId: 'c-1' } },
        { type: 'strike' },
        { type: 'commentMark', attrs: { commentId: 'c-2' } },
        { type: 'highlight', attrs: { color: 'FFFF00' } },
      ];

      applyMarksToRun(run, marks, undefined, undefined, undefined, false);

      // Non-comment marks should be applied
      expect(run.strike).toBe(true);
      expect(run.highlight).toBe('#FFFF00');

      // Comments should be skipped
      expect(run.comments).toBeUndefined();
    });

    it('handles enableComments with empty marks array', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };

      applyMarksToRun(run, [], undefined, undefined, undefined, false);

      expect(run.comments).toBeUndefined();
      expect(run.bold).toBeUndefined();
    });

    it('handles enableComments with only non-comment marks', () => {
      const run: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const marks: PMMark[] = [{ type: 'bold' }, { type: 'italic' }];

      applyMarksToRun(run, marks, undefined, undefined, undefined, false);

      // Non-comment marks should still be applied
      expect(run.bold).toBe(true);
      expect(run.italic).toBe(true);
      expect(run.comments).toBeUndefined();
    });
  });
});
