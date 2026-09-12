/**
 * Comprehensive test suite for tracked-changes.ts
 *
 * Tests cover:
 * - Security validation (depth, JSON length, array length)
 * - Core logic (metadata building, ID generation, priority selection)
 * - Integration (mode filtering, format marks application)
 * - Helper functions (compatibility checks, node hiding)
 */

import { describe, it, expect, vi } from 'vitest';
import type { Run, TextRun, TabRun, TrackedChangeMeta, RunMark } from '@superdoc/contracts';
import type { PMMark, TrackedChangesConfig, HyperlinkConfig } from './types.js';
import {
  isValidTrackedMode,
  isTextRun,
  stripTrackedChangeFromRun,
  pickTrackedChangeKind,
  normalizeRunMarkList,
  deriveTrackedChangeId,
  buildTrackedChangeMetaFromMark,
  selectTrackedChangeMeta,
  trackedChangesCompatible,
  shouldHideTrackedNode,
  annotateBlockWithTrackedChange,
  resetRunFormatting,
  applyFormatChangeMarks,
  applyTrackedChangesModeToRuns,
} from './tracked-changes.js';
import { MAX_RUN_MARK_JSON_LENGTH, MAX_RUN_MARK_ARRAY_LENGTH, MAX_RUN_MARK_DEPTH } from './constants.js';

describe('tracked-changes', () => {
  describe('isValidTrackedMode', () => {
    it('should return true for valid tracked modes', () => {
      expect(isValidTrackedMode('review')).toBe(true);
      expect(isValidTrackedMode('original')).toBe(true);
      expect(isValidTrackedMode('final')).toBe(true);
      expect(isValidTrackedMode('off')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isValidTrackedMode('invalid')).toBe(false);
      expect(isValidTrackedMode('')).toBe(false);
      expect(isValidTrackedMode(123)).toBe(false);
      expect(isValidTrackedMode(null)).toBe(false);
      expect(isValidTrackedMode(undefined)).toBe(false);
      expect(isValidTrackedMode({})).toBe(false);
    });
  });

  describe('isTextRun', () => {
    it('should identify TextRun correctly', () => {
      const textRun: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
      };
      expect(isTextRun(textRun)).toBe(true);
    });

    it('should identify TabRun correctly', () => {
      const tabRun: TabRun = {
        kind: 'tab',
        text: '\t',
      };
      expect(isTextRun(tabRun)).toBe(false);
    });

    it('should handle edge cases safely', () => {
      const runWithoutText = { fontFamily: 'Arial', fontSize: 12 } as Run;
      expect(isTextRun(runWithoutText)).toBe(false);
    });
  });

  describe('stripTrackedChangeFromRun', () => {
    it('should remove trackedChange from TextRun', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: {
          kind: 'insert',
          id: 'test-id',
        },
      };
      stripTrackedChangeFromRun(run);
      expect(run.trackedChange).toBeUndefined();
    });

    it('should not error on TabRun', () => {
      const tabRun: TabRun = { kind: 'tab', text: '\t' };
      expect(() => stripTrackedChangeFromRun(tabRun)).not.toThrow();
    });

    it('should remove tracked change layers from BreakRun', () => {
      const run: Run = {
        kind: 'break',
        trackedChange: { kind: 'insert', id: 'ins-1' },
        trackedChanges: [
          { kind: 'insert', id: 'ins-1' },
          { kind: 'delete', id: 'del-1' },
        ],
      };

      stripTrackedChangeFromRun(run);
      expect(run.trackedChange).toBeUndefined();
      expect(run.trackedChanges).toBeUndefined();
    });

    it('should not error on TextRun without trackedChange', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
      };
      expect(() => stripTrackedChangeFromRun(run)).not.toThrow();
    });
  });

  describe('pickTrackedChangeKind', () => {
    it('should map trackInsert to insert', () => {
      expect(pickTrackedChangeKind('trackInsert')).toBe('insert');
    });

    it('should map trackDelete to delete', () => {
      expect(pickTrackedChangeKind('trackDelete')).toBe('delete');
    });

    it('should map trackFormat to format', () => {
      expect(pickTrackedChangeKind('trackFormat')).toBe('format');
    });

    it('should return undefined for unknown mark types', () => {
      expect(pickTrackedChangeKind('bold')).toBeUndefined();
      expect(pickTrackedChangeKind('italic')).toBeUndefined();
      expect(pickTrackedChangeKind('unknown')).toBeUndefined();
    });
  });

  describe('normalizeRunMarkList - Security Validation', () => {
    it('should reject JSON exceeding MAX_RUN_MARK_JSON_LENGTH', () => {
      const largeJSON = JSON.stringify(Array.from({ length: 1000 }, () => ({ type: 'bold', attrs: {} })));
      // Ensure it exceeds the limit
      expect(largeJSON.length).toBeGreaterThan(MAX_RUN_MARK_JSON_LENGTH);
      const result = normalizeRunMarkList(largeJSON);
      expect(result).toBeUndefined();
    });

    it('should reject arrays exceeding MAX_RUN_MARK_ARRAY_LENGTH', () => {
      const largeArray = Array.from({ length: MAX_RUN_MARK_ARRAY_LENGTH + 1 }, () => ({
        type: 'bold',
      }));
      const result = normalizeRunMarkList(largeArray);
      expect(result).toBeUndefined();
    });

    it('should reject deeply nested structures exceeding MAX_RUN_MARK_DEPTH', () => {
      // Create a structure with depth > MAX_RUN_MARK_DEPTH
      let nested: Record<string, unknown> = { type: 'bold' };
      for (let i = 0; i < MAX_RUN_MARK_DEPTH + 1; i++) {
        nested = { child: nested };
      }
      const result = normalizeRunMarkList([nested]);
      expect(result).toBeUndefined();
    });

    it('should handle malformed JSON strings gracefully', () => {
      const malformedJSON = '{ invalid json }';
      const result = normalizeRunMarkList(malformedJSON);
      expect(result).toBeUndefined();
    });

    it('should normalize valid JSON string to RunMark array', () => {
      const validJSON = JSON.stringify([{ type: 'bold' }, { type: 'italic', attrs: { color: 'red' } }]);
      const result = normalizeRunMarkList(validJSON);
      expect(result).toEqual([
        { type: 'bold', attrs: undefined },
        { type: 'italic', attrs: { color: 'red' } },
      ]);
    });

    it('should filter out invalid entries from array', () => {
      const mixedArray = [
        { type: 'bold' },
        null,
        { type: 'italic' },
        'invalid',
        { noType: true },
        { type: 'underline', attrs: { style: 'single' } },
      ];
      const result = normalizeRunMarkList(mixedArray);
      expect(result).toEqual([
        { type: 'bold', attrs: undefined },
        { type: 'italic', attrs: undefined },
        { type: 'underline', attrs: { style: 'single' } },
      ]);
    });

    it('should return undefined for empty arrays after filtering', () => {
      const invalidArray = [null, 'string', 123, { noType: true }];
      const result = normalizeRunMarkList(invalidArray);
      expect(result).toBeUndefined();
    });

    it('should handle null and undefined explicitly', () => {
      expect(normalizeRunMarkList(null)).toBeUndefined();
      expect(normalizeRunMarkList(undefined)).toBeUndefined();
    });

    it('should return undefined for non-array, non-string values', () => {
      expect(normalizeRunMarkList(123)).toBeUndefined();
      expect(normalizeRunMarkList(true)).toBeUndefined();
      expect(normalizeRunMarkList({ type: 'bold' })).toBeUndefined();
    });

    it('should handle arrays within depth limit correctly', () => {
      const validNested = [
        {
          type: 'bold',
          attrs: {
            nested: {
              level1: {
                level2: 'value',
              },
            },
          },
        },
      ];
      const result = normalizeRunMarkList(validNested);
      expect(result).toBeDefined();
      expect(result?.[0].type).toBe('bold');
    });

    it('should handle mixed array and object nesting in depth calculation', () => {
      const mixedNesting = [
        {
          type: 'bold',
          attrs: {
            nested: {
              level1: 'value',
            },
          },
        },
      ];
      // This should be within limits (depth of 3: array -> object -> attrs -> nested)
      const result = normalizeRunMarkList(mixedNesting);
      expect(result).toBeDefined();
      expect(result?.[0].type).toBe('bold');
    });

    it('should handle primitives in depth validation safely', () => {
      const withPrimitives = [
        {
          type: 'bold',
          attrs: {
            string: 'value',
            number: 123,
            boolean: true,
            null: null,
          },
        },
      ];
      const result = normalizeRunMarkList(withPrimitives);
      expect(result).toBeDefined();
      expect(result?.[0].attrs).toBeDefined();
    });
  });

  describe('deriveTrackedChangeId', () => {
    it('should return provided ID when available', () => {
      const attrs = { id: 'custom-id-123' };
      const result = deriveTrackedChangeId('insert', attrs);
      expect(result).toBe('custom-id-123');
    });

    it('should generate fallback ID when id is missing', () => {
      const attrs = { authorEmail: 'user@example.com', date: '2025-01-15' };
      const result = deriveTrackedChangeId('insert', attrs);
      expect(result).toMatch(/^insert-user@example\.com-2025-01-15-\d+-[a-z0-9]{9}$/);
    });

    it('should handle empty attrs by using unknown placeholders', () => {
      const result = deriveTrackedChangeId('format', {});
      expect(result).toMatch(/^format-unknown-unknown-\d+-[a-z0-9]{9}$/);
    });

    it('should ensure uniqueness through timestamp and random components', () => {
      const id1 = deriveTrackedChangeId('insert', {});
      const id2 = deriveTrackedChangeId('insert', {});
      // IDs should be different due to timestamp/random
      expect(id1).not.toBe(id2);
    });

    it('should handle undefined attrs', () => {
      const result = deriveTrackedChangeId('delete', undefined);
      expect(result).toMatch(/^delete-unknown-unknown-\d+-[a-z0-9]{9}$/);
    });

    it('should trim and reject empty string IDs', () => {
      const attrs = { id: '   ', authorEmail: 'user@example.com' };
      const result = deriveTrackedChangeId('insert', attrs);
      expect(result).toMatch(/^insert-user@example\.com/);
    });
  });

  describe('buildTrackedChangeMetaFromMark', () => {
    it('should return undefined for non-tracked change marks', () => {
      const mark: PMMark = { type: 'bold' };
      const result = buildTrackedChangeMetaFromMark(mark);
      expect(result).toBeUndefined();
    });

    it('should build metadata for insert mark with all fields', () => {
      const mark: PMMark = {
        type: 'trackInsert',
        attrs: {
          id: 'ins-123',
          author: 'John Doe',
          authorEmail: 'john@example.com',
          authorImage: 'https://example.com/avatar.jpg',
          date: '2025-01-15T10:00:00Z',
        },
      };
      const result = buildTrackedChangeMetaFromMark(mark);
      expect(result).toEqual({
        kind: 'insert',
        id: 'ins-123',
        author: 'John Doe',
        authorEmail: 'john@example.com',
        authorImage: 'https://example.com/avatar.jpg',
        date: '2025-01-15T10:00:00Z',
      });
    });

    it('should generate ID when not provided', () => {
      const mark: PMMark = {
        type: 'trackDelete',
        attrs: {
          author: 'Jane Doe',
          authorEmail: 'jane@example.com',
        },
      };
      const result = buildTrackedChangeMetaFromMark(mark);
      expect(result?.kind).toBe('delete');
      expect(result?.id).toMatch(/^delete-jane@example\.com/);
      expect(result?.author).toBe('Jane Doe');
    });

    it('should omit optional fields when not present', () => {
      const mark: PMMark = {
        type: 'trackInsert',
        attrs: { id: 'ins-456' },
      };
      const result = buildTrackedChangeMetaFromMark(mark);
      expect(result).toEqual({
        kind: 'insert',
        id: 'ins-456',
      });
    });

    it('should handle format marks with before/after arrays', () => {
      const mark: PMMark = {
        type: 'trackFormat',
        attrs: {
          id: 'fmt-789',
          before: [{ type: 'bold' }],
          after: [{ type: 'italic' }],
        },
      };
      const result = buildTrackedChangeMetaFromMark(mark);
      expect(result?.kind).toBe('format');
      expect(result?.before).toEqual([{ type: 'bold', attrs: undefined }]);
      expect(result?.after).toEqual([{ type: 'italic', attrs: undefined }]);
    });

    it('should handle invalid before/after gracefully', () => {
      const mark: PMMark = {
        type: 'trackFormat',
        attrs: {
          id: 'fmt-999',
          before: 'invalid',
          after: null,
        },
      };
      const result = buildTrackedChangeMetaFromMark(mark);
      expect(result?.before).toBeUndefined();
      expect(result?.after).toBeUndefined();
    });

    it('should handle mark without attrs', () => {
      const mark: PMMark = { type: 'trackInsert' };
      const result = buildTrackedChangeMetaFromMark(mark);
      expect(result?.kind).toBe('insert');
      expect(result?.id).toMatch(/^insert-unknown-unknown/);
    });
  });

  describe('selectTrackedChangeMeta', () => {
    it('should return next meta when existing is undefined', () => {
      const next: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const result = selectTrackedChangeMeta(undefined, next);
      expect(result).toBe(next);
    });

    it('should prioritize insert over format', () => {
      const existing: TrackedChangeMeta = { kind: 'format', id: 'fmt-1' };
      const next: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const result = selectTrackedChangeMeta(existing, next);
      expect(result).toBe(next);
    });

    it('should prioritize delete over format', () => {
      const existing: TrackedChangeMeta = { kind: 'format', id: 'fmt-1' };
      const next: TrackedChangeMeta = { kind: 'delete', id: 'del-1' };
      const result = selectTrackedChangeMeta(existing, next);
      expect(result).toBe(next);
    });

    it('should keep existing when priorities are equal (insert vs insert)', () => {
      const existing: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const next: TrackedChangeMeta = { kind: 'insert', id: 'ins-2' };
      const result = selectTrackedChangeMeta(existing, next);
      expect(result).toBe(existing);
    });

    it('should keep existing when priorities are equal (delete vs delete)', () => {
      const existing: TrackedChangeMeta = { kind: 'delete', id: 'del-1' };
      const next: TrackedChangeMeta = { kind: 'delete', id: 'del-2' };
      const result = selectTrackedChangeMeta(existing, next);
      expect(result).toBe(existing);
    });

    it('should keep existing when next priority is lower', () => {
      const existing: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const next: TrackedChangeMeta = { kind: 'format', id: 'fmt-1' };
      const result = selectTrackedChangeMeta(existing, next);
      expect(result).toBe(existing);
    });
  });

  describe('trackedChangesCompatible', () => {
    it('should return true when both runs have no metadata', () => {
      const a: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 12 };
      const b: TextRun = { text: 'World', fontFamily: 'Arial', fontSize: 12 };
      expect(trackedChangesCompatible(a, b)).toBe(true);
    });

    it('should return false when only one run has metadata', () => {
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'ins-1' },
      };
      const b: TextRun = { text: 'World', fontFamily: 'Arial', fontSize: 12 };
      expect(trackedChangesCompatible(a, b)).toBe(false);
    });

    it('should return true when both have same kind and id', () => {
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
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
        trackedChange: { ...meta },
      };
      expect(trackedChangesCompatible(a, b)).toBe(true);
    });

    it('should return false when kinds differ', () => {
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'id-1' },
      };
      const b: TextRun = {
        text: 'World',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'delete', id: 'id-1' },
      };
      expect(trackedChangesCompatible(a, b)).toBe(false);
    });

    it('should return false when IDs differ', () => {
      const a: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'ins-1' },
      };
      const b: TextRun = {
        text: 'World',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'ins-2' },
      };
      expect(trackedChangesCompatible(a, b)).toBe(false);
    });
  });

  describe('shouldHideTrackedNode', () => {
    it('should return false when metadata is undefined', () => {
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      expect(shouldHideTrackedNode(undefined, config)).toBe(false);
    });

    it('should return false when config is undefined', () => {
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      expect(shouldHideTrackedNode(meta, undefined)).toBe(false);
    });

    it('should return false when tracking is disabled', () => {
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const config: TrackedChangesConfig = { enabled: false, mode: 'original' };
      expect(shouldHideTrackedNode(meta, config)).toBe(false);
    });

    it('should hide inserts in original mode', () => {
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      expect(shouldHideTrackedNode(meta, config)).toBe(true);
    });

    it('should hide deletions in final mode', () => {
      const meta: TrackedChangeMeta = { kind: 'delete', id: 'del-1' };
      const config: TrackedChangesConfig = { enabled: true, mode: 'final' };
      expect(shouldHideTrackedNode(meta, config)).toBe(true);
    });

    it('should not hide insertions in review mode', () => {
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      expect(shouldHideTrackedNode(meta, config)).toBe(false);
    });

    it('should not hide deletions in review mode', () => {
      const meta: TrackedChangeMeta = { kind: 'delete', id: 'del-1' };
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      expect(shouldHideTrackedNode(meta, config)).toBe(false);
    });

    it('should not hide format changes in any mode', () => {
      const meta: TrackedChangeMeta = { kind: 'format', id: 'fmt-1' };
      const configs: TrackedChangesConfig[] = [
        { enabled: true, mode: 'original' },
        { enabled: true, mode: 'final' },
        { enabled: true, mode: 'review' },
      ];
      configs.forEach((config) => {
        expect(shouldHideTrackedNode(meta, config)).toBe(false);
      });
    });
  });

  describe('annotateBlockWithTrackedChange', () => {
    it('should add trackedChange to block attrs when enabled', () => {
      const block: { attrs?: Record<string, unknown> } = {};
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      annotateBlockWithTrackedChange(block, meta, config);
      expect(block.attrs?.trackedChange).toBe(meta);
    });

    it('should not add trackedChange when config is undefined', () => {
      const block: { attrs?: Record<string, unknown> } = {};
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      annotateBlockWithTrackedChange(block, meta, undefined);
      expect(block.attrs).toBeUndefined();
    });

    it('should not add trackedChange when meta is undefined', () => {
      const block: { attrs?: Record<string, unknown> } = {};
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      annotateBlockWithTrackedChange(block, undefined, config);
      expect(block.attrs).toBeUndefined();
    });

    it('should not add trackedChange when disabled', () => {
      const block: { attrs?: Record<string, unknown> } = {};
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const config: TrackedChangesConfig = { enabled: false, mode: 'review' };
      annotateBlockWithTrackedChange(block, meta, config);
      expect(block.attrs).toBeUndefined();
    });

    it('should not add trackedChange when mode is off', () => {
      const block: { attrs?: Record<string, unknown> } = {};
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const config: TrackedChangesConfig = { enabled: true, mode: 'off' };
      annotateBlockWithTrackedChange(block, meta, config);
      expect(block.attrs).toBeUndefined();
    });

    it('should preserve existing attrs when adding trackedChange', () => {
      const block = { attrs: { existing: 'value' } };
      const meta: TrackedChangeMeta = { kind: 'insert', id: 'ins-1' };
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      annotateBlockWithTrackedChange(block, meta, config);
      expect(block.attrs).toEqual({
        existing: 'value',
        trackedChange: meta,
      });
    });
  });

  describe('resetRunFormatting', () => {
    it('should remove all formatting properties', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        bold: true,
        italic: true,
        color: '#FF0000',
        underline: { style: 'single' },
        strike: true,
        highlight: '#FFFF00',
        link: { href: 'https://example.com' },
        letterSpacing: 2,
      };
      resetRunFormatting(run);
      expect(run.bold).toBeUndefined();
      expect(run.italic).toBeUndefined();
      expect(run.color).toBeUndefined();
      expect(run.underline).toBeUndefined();
      expect(run.strike).toBeUndefined();
      expect(run.highlight).toBeUndefined();
      expect(run.link).toBeUndefined();
      expect(run.letterSpacing).toBeUndefined();
    });

    it('should preserve text and base properties', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        bold: true,
        italic: true,
      };
      resetRunFormatting(run);
      expect(run.text).toBe('Hello');
      expect(run.fontFamily).toBe('Arial');
      expect(run.fontSize).toBe(12);
    });

    it('should preserve trackedChange metadata', () => {
      const meta: TrackedChangeMeta = { kind: 'format', id: 'fmt-1' };
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        bold: true,
        trackedChange: meta,
      };
      resetRunFormatting(run);
      expect(run.trackedChange).toBe(meta);
    });

    it('should handle run with no formatting gracefully', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
      };
      expect(() => resetRunFormatting(run)).not.toThrow();
    });

    it('should clear vertAlign and baselineShift', () => {
      const run: TextRun = {
        text: '1st',
        fontFamily: 'Arial',
        fontSize: 10.4,
        vertAlign: 'superscript',
        baselineShift: 3,
      };
      resetRunFormatting(run);
      expect(run.vertAlign).toBeUndefined();
      expect(run.baselineShift).toBeUndefined();
    });
  });

  describe('applyFormatChangeMarks', () => {
    it('should not apply marks when tracked change is not format', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: { kind: 'insert', id: 'ins-1' },
      };
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      applyFormatChangeMarks(run, config, hyperlinkConfig, applyMarksToRun);
      expect(applyMarksToRun).not.toHaveBeenCalled();
    });

    it('should not apply marks when mode is not original', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: {
          kind: 'format',
          id: 'fmt-1',
          before: [{ type: 'bold' }],
        },
      };
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      applyFormatChangeMarks(run, config, hyperlinkConfig, applyMarksToRun);
      expect(applyMarksToRun).not.toHaveBeenCalled();
    });

    it('should reset formatting when before marks are empty', () => {
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        bold: true,
        trackedChange: {
          kind: 'format',
          id: 'fmt-1',
          before: [],
        },
      };
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      applyFormatChangeMarks(run, config, hyperlinkConfig, applyMarksToRun);
      expect(run.bold).toBeUndefined();
      expect(applyMarksToRun).not.toHaveBeenCalled();
    });

    it('should apply valid before marks in original mode', () => {
      const beforeMarks: RunMark[] = [{ type: 'bold' }, { type: 'italic', attrs: { color: 'red' } }];
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        trackedChange: {
          kind: 'format',
          id: 'fmt-1',
          before: beforeMarks,
        },
      };
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      applyFormatChangeMarks(run, config, hyperlinkConfig, applyMarksToRun);
      expect(applyMarksToRun).toHaveBeenCalledWith(
        run,
        beforeMarks,
        hyperlinkConfig,
        undefined,
        undefined,
        true,
        undefined,
      );
    });

    it('should handle errors in applyMarksToRun by resetting formatting', () => {
      const beforeMarks: RunMark[] = [{ type: 'bold' }];
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        bold: true,
        trackedChange: {
          kind: 'format',
          id: 'fmt-1',
          before: beforeMarks,
        },
      };
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn(() => {
        throw new Error('Mark application failed');
      });

      applyFormatChangeMarks(run, config, hyperlinkConfig, applyMarksToRun);
      expect(run.bold).toBeUndefined();
    });

    it('should validate marks and reset on invalid before marks', () => {
      const invalidMarks = [{ type: 'bold' }, null, { noType: true }] as unknown as RunMark[];
      const run: TextRun = {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 12,
        bold: true,
        trackedChange: {
          kind: 'format',
          id: 'fmt-1',
          before: invalidMarks,
        },
      };
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      applyFormatChangeMarks(run, config, hyperlinkConfig, applyMarksToRun);
      expect(run.bold).toBeUndefined();
      expect(applyMarksToRun).not.toHaveBeenCalled();
    });
  });

  describe('applyTrackedChangesModeToRuns', () => {
    it('should return runs unchanged when config is undefined', () => {
      const runs: Run[] = [
        { text: 'Hello', fontFamily: 'Arial', fontSize: 12 },
        { kind: 'tab', text: '\t' },
      ];
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, undefined, hyperlinkConfig, applyMarksToRun);
      expect(result).toBe(runs);
    });

    it('should handle empty runs array', () => {
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns([], config, hyperlinkConfig, applyMarksToRun);
      expect(result).toEqual([]);
    });

    it('should preserve TabRuns in filtered output', () => {
      const tabRun: TabRun = { kind: 'tab', text: '\t' };
      const runs: Run[] = [
        { text: 'Hello', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-1' } },
        tabRun,
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).toContain(tabRun);
      expect(result).toHaveLength(1); // Only tab, insert should be hidden
    });

    it('hides a tracked-inserted tab in original mode (SD-3376)', () => {
      const insertedTab: TabRun = {
        kind: 'tab',
        text: '\t',
        trackedChange: { kind: 'insert', id: 'tab-ins' },
      } as TabRun;
      const runs: Run[] = [{ text: 'Keep', fontFamily: 'Arial', fontSize: 12 }, insertedTab];
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).not.toContain(insertedTab);
      expect(result).toHaveLength(1);
      expect((result[0] as TextRun).text).toBe('Keep');
    });

    it('hides a tracked-deleted tab in final mode (SD-3376)', () => {
      const deletedTab: TabRun = {
        kind: 'tab',
        text: '\t',
        trackedChange: { kind: 'delete', id: 'tab-del' },
      } as TabRun;
      const runs: Run[] = [{ text: 'Keep', fontFamily: 'Arial', fontSize: 12 }, deletedTab];
      const config: TrackedChangesConfig = { enabled: true, mode: 'final' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).not.toContain(deletedTab);
      expect(result).toHaveLength(1);
      expect((result[0] as TextRun).text).toBe('Keep');
    });

    it('keeps a tracked-inserted tab visible in original mode when it is a deletion (SD-3376)', () => {
      const deletedTab: TabRun = {
        kind: 'tab',
        text: '\t',
        trackedChange: { kind: 'delete', id: 'tab-del' },
      } as TabRun;
      const runs: Run[] = [deletedTab];
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      // Deletions stay visible in original mode.
      expect(result).toContain(deletedTab);
    });

    it('should filter insertions in original mode', () => {
      const runs: Run[] = [
        { text: 'Normal', fontFamily: 'Arial', fontSize: 12 },
        { text: 'Inserted', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-1' } },
        { text: 'More', fontFamily: 'Arial', fontSize: 12 },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).toHaveLength(2);
      expect((result[0] as TextRun).text).toBe('Normal');
      expect((result[1] as TextRun).text).toBe('More');
    });

    it('should strip metadata from remaining runs in original mode after filtering inserts', () => {
      const runs: Run[] = [
        { text: 'Keep', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'delete', id: 'del-1' } },
        { text: 'Inserted', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-1' } },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).toHaveLength(1);
      const [kept] = result as TextRun[];
      expect(kept.text).toBe('Keep');
      expect(kept.trackedChange).toBeUndefined();
    });

    it('should filter deletions in final mode', () => {
      const runs: Run[] = [
        { text: 'Normal', fontFamily: 'Arial', fontSize: 12 },
        { text: 'Deleted', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'delete', id: 'del-1' } },
        { text: 'More', fontFamily: 'Arial', fontSize: 12 },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'final' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).toHaveLength(2);
      expect((result[0] as TextRun).text).toBe('Normal');
      expect((result[1] as TextRun).text).toBe('More');
    });

    it('should hide runs with overlapped child deletions in final mode', () => {
      const runs: Run[] = [
        {
          text: 'HELLO',
          fontFamily: 'Arial',
          fontSize: 12,
          trackedChange: { kind: 'insert', id: 'ins-parent' },
          trackedChanges: [
            { kind: 'insert', id: 'ins-parent', relationship: 'parent' },
            {
              kind: 'delete',
              id: 'del-child',
              overlapParentId: 'ins-parent',
              relationship: 'child',
            },
          ],
        },
        { text: 'XYZ', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-2' } },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'final' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).toHaveLength(1);
      expect((result[0] as TextRun).text).toBe('XYZ');
    });

    it('should strip metadata from remaining runs in final mode after filtering deletions', () => {
      const runs: Run[] = [
        { text: 'Keep', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-1' } },
        { text: 'Deleted', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'delete', id: 'del-1' } },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'final' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(result).toHaveLength(1);
      const [kept] = result as TextRun[];
      expect(kept.text).toBe('Keep');
      expect(kept.trackedChange).toBeUndefined();
    });

    it('should strip metadata when disabled', () => {
      const runs: Run[] = [
        { text: 'Hello', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-1' } },
      ];
      const config: TrackedChangesConfig = { enabled: false, mode: 'review' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect((result[0] as TextRun).trackedChange).toBeUndefined();
    });

    it('should strip metadata when mode is off', () => {
      const runs: Run[] = [
        { text: 'Hello', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-1' } },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'off' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect((result[0] as TextRun).trackedChange).toBeUndefined();
    });

    it('should apply format changes when not filtering', () => {
      const runs: Run[] = [
        {
          text: 'Formatted',
          fontFamily: 'Arial',
          fontSize: 12,
          trackedChange: {
            kind: 'format',
            id: 'fmt-1',
            before: [{ type: 'bold' }],
          },
        },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'review' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      // In review mode, format changes are not applied (only in original)
      expect(applyMarksToRun).not.toHaveBeenCalled();
    });

    it('should apply format changes to filtered runs in original mode', () => {
      const runs: Run[] = [
        {
          text: 'Formatted',
          fontFamily: 'Arial',
          fontSize: 12,
          trackedChange: {
            kind: 'format',
            id: 'fmt-1',
            before: [{ type: 'bold' }],
          },
        },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      expect(applyMarksToRun).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('should handle mixed filtering and metadata operations', () => {
      const runs: Run[] = [
        { text: 'Normal', fontFamily: 'Arial', fontSize: 12 },
        { text: 'Insert', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'insert', id: 'ins-1' } },
        { text: 'Delete', fontFamily: 'Arial', fontSize: 12, trackedChange: { kind: 'delete', id: 'del-1' } },
        {
          text: 'Format',
          fontFamily: 'Arial',
          fontSize: 12,
          trackedChange: { kind: 'format', id: 'fmt-1', before: [{ type: 'bold' }] },
        },
      ];
      const config: TrackedChangesConfig = { enabled: true, mode: 'original' };
      const hyperlinkConfig: HyperlinkConfig = { enableRichHyperlinks: false };
      const applyMarksToRun = vi.fn();

      const result = applyTrackedChangesModeToRuns(runs, config, hyperlinkConfig, applyMarksToRun);
      // Should have Normal, Delete, and Format (Insert hidden in original mode)
      expect(result).toHaveLength(3);
      expect((result[0] as TextRun).text).toBe('Normal');
      expect((result[1] as TextRun).text).toBe('Delete');
      expect((result[2] as TextRun).text).toBe('Format');
    });
  });
});
