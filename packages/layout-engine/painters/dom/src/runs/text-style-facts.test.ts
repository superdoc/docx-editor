import { describe, expect, it } from 'vite-plus/test';
import type { TextRun } from '@superdoc/contracts';
import { resolveRunDecorationStyles, resolveRunTypographyStyles } from './text-style-facts.js';
import { applyRunStyles } from './text-run.js';
import { applyTrackedChangeDecorations, resolveTrackedChangeDecorationFacts } from './tracked-changes.js';

describe('worker-safe paint decisions retain existing DOM contracts', () => {
  it('preserves physical face, synthesis, explicit spacing and vertical positioning', () => {
    const run: TextRun = {
      text: 'Measured',
      fontFamily: 'Calibri',
      fontSize: 20,
      bold: true,
      italic: true,
      letterSpacing: 0.5,
      baselineShift: 2,
    };
    const resolve = (_family: string, face: { weight: '400' | '700'; style: 'normal' | 'italic' }) => {
      expect(face).toEqual({ weight: '700', style: 'italic' });
      return 'Carlito';
    };
    expect(resolveRunTypographyStyles(run, resolve)).toEqual({
      'font-family': 'Carlito',
      'font-size': '20px',
      'font-variant-caps': 'normal',
      'font-kerning': 'none',
      'font-synthesis': 'weight style',
      'font-weight': 'bold',
      'font-style': 'italic',
      'letter-spacing': '0.5px',
      'line-height': '1',
      'vertical-align': '2pt',
    });
    const element = document.createElement('span');
    applyRunStyles(element, run, false, resolve);
    expect(element.style.fontFamily).toBe('Carlito');
    expect(element.style.verticalAlign).toBe('2pt');
    expect(element.style.getPropertyValue('font-synthesis')).toBe('weight style');
  });

  it('retains small caps and synthesis in cloneable typography for worker painting', () => {
    const run: TextRun = { text: 'Test ', fontFamily: 'Arial', fontSize: 16, smallCaps: true };
    const styles = structuredClone(resolveRunTypographyStyles(run, (family) => family));
    expect(styles['font-variant-caps']).toBe('small-caps');
    expect(styles['font-synthesis']).toBe('weight style small-caps');
    expect(resolveRunTypographyStyles({ ...run, smallCaps: false }, (family) => family)).toMatchObject({
      'font-variant-caps': 'normal',
      'font-synthesis': 'weight style',
    });
  });

  it('preserves underline and strike as independent inline CSS properties', () => {
    const run: TextRun = {
      text: 'Text',
      fontFamily: 'Arial',
      fontSize: 28,
      underline: { style: 'dotted', color: '#123456' },
      strike: true,
    };
    expect(resolveRunDecorationStyles(run)).toEqual({
      'text-decoration-style': 'dotted',
      'text-decoration-thickness': '2px',
      'text-decoration-color': '#123456',
      'text-decoration-line': 'underline line-through',
    });
    const element = document.createElement('span');
    applyRunStyles(element, run, false, (family) => family);
    expect(element.style.textDecorationLine).toBe('underline line-through');
    expect(element.style.getPropertyValue('text-decoration-thickness')).toBe('2px');
  });

  it('retains author metadata and semantic color precedence in cloneable tracking facts', () => {
    const run: TextRun = {
      text: 'Revision',
      fontFamily: 'Arial',
      fontSize: 16,
      trackedChange: {
        id: 'tc-1',
        kind: 'delete',
        storyKey: 'body',
        author: 'Ada',
        authorEmail: 'ada@example.test',
        color: '#112233',
        semanticColor: '#445566',
        semanticColorKey: 'move-from',
        type: 'text',
        subtype: 'text-deletion',
        targetKind: 'text',
        date: '2026-10-12T00:00:00Z',
        semanticAnchorScope: 'inline',
      },
    };
    const config = { enabled: true, mode: 'review' as const };
    const facts = resolveTrackedChangeDecorationFacts(run, config);
    expect(structuredClone(facts)).toEqual(facts);
    expect(facts.classes).toContain('track-delete-dec');
    expect(facts.classes).toContain('highlighted');
    expect(facts.attributes).toMatchObject({
      'data-track-change-id': 'tc-1',
      'data-story-key': 'body',
      'data-track-change-author': 'Ada',
      'data-track-change-author-email': 'ada@example.test',
      'data-track-change-author-color': '#112233',
      'data-track-change-semantic-color': '#445566',
      'data-track-change-semantic-anchor-scope': 'inline',
    });
    expect(facts.style['--sd-tracked-changes-delete-border']).toBe('#445566');
    const element = document.createElement('span');
    applyTrackedChangeDecorations(element, run, config);
    expect(element.dataset.trackChangeAuthorColor).toBe('#112233');
    expect(element.style.getPropertyValue('--sd-tracked-changes-delete-border')).toBe('#445566');
    expect(resolveTrackedChangeDecorationFacts(run, { enabled: false, mode: 'review' })).toEqual({
      classes: [],
      style: {},
      attributes: {},
    });
  });
});
