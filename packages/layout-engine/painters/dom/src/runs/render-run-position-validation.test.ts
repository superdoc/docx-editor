import { describe, expect, it } from 'vite-plus/test';
import type { TextRun } from '@superdoc/contracts';
import { createPositionValidationCollector } from '../pm-position-validation.js';
import { renderRun } from './render-run.js';
import type { RunRenderContext } from './types.js';

const makeRunContext = (positionValidation: RunRenderContext['positionValidation']): RunRenderContext => ({
  doc: document,
  layoutEpoch: 1,
  showFormattingMarks: false,
  contentControlsChrome: 'default',
  resolvePhysical: (family) => family,
  pendingTooltips: new WeakMap<HTMLElement, string>(),
  getNextLinkId: () => 'link-1',
  applySdtDataset: () => {},
  buildImageHyperlinkAnchor: (child) => child,
  resolveTrackedChangesConfig: () => ({ mode: 'final', enabled: false }),
  applyTrackedChangeDecorations: () => {},
  resolveRunSdtId: () => null,
  createInlineSdtWrapper: () => document.createElement('span'),
  syncInlineSdtWrapperTypography: () => {},
  expandSdtWrapperPmRange: () => {},
  positionValidation,
});

const pageField: TextRun = {
  text: '1',
  token: 'pageNumber',
  fontFamily: 'Arial',
  fontSize: 12,
};

describe('renderRun position validation', () => {
  it('retains both authored Word-checkbox glyphs on its painted placeholder', () => {
    const checkboxRun: TextRun = {
      text: '',
      fontFamily: 'Arial',
      fontSize: 12,
      visualPlaceholder: 'emptyInlineSdt',
      sdt: {
        type: 'structuredContent',
        scope: 'inline',
        id: 'checkbox-1',
        checkbox: {
          checked: false,
          checkedSymbol: { font: 'MS Gothic', char: '2612' },
          uncheckedSymbol: { font: 'MS Gothic', char: '2610' },
        },
      },
    };

    const element = renderRun(
      checkboxRun,
      { pageNumber: 1, totalPages: 1, section: 'body' },
      makeRunContext(undefined),
    );

    expect(element?.textContent).toBe('☐');
    expect(element?.dataset.wordCheckboxGlyph).toBe('true');
    expect(element?.dataset.checkboxCheckedGlyph).toBe('☒');
    expect(element?.dataset.checkboxUncheckedGlyph).toBe('☐');
  });

  it('retains both authored Word-checkbox glyphs on a non-empty checkbox run', () => {
    const checkboxRun: TextRun = {
      text: '☐',
      fontFamily: 'Arial',
      fontSize: 12,
      sdt: {
        type: 'structuredContent',
        scope: 'inline',
        id: 'checkbox-2',
        checkbox: {
          checked: false,
          checkedSymbol: { font: 'MS Gothic', char: '2612' },
          uncheckedSymbol: { font: 'MS Gothic', char: '2610' },
        },
      },
    };

    const element = renderRun(
      checkboxRun,
      { pageNumber: 1, totalPages: 1, section: 'body' },
      makeRunContext(undefined),
    );

    expect(element?.textContent).toBe('☐');
    expect(element?.dataset.wordCheckboxGlyph).toBe('true');
    expect(element?.dataset.checkboxCheckedGlyph).toBe('☒');
    expect(element?.dataset.checkboxUncheckedGlyph).toBe('☐');
  });

  it('does not mark non-glyph text inside a checkbox SDT as the toggle target', () => {
    const checkboxRun: TextRun = {
      text: 'Not required',
      fontFamily: 'Arial',
      fontSize: 12,
      sdt: {
        type: 'structuredContent',
        scope: 'inline',
        id: 'checkbox-3',
        checkbox: {
          checked: false,
          checkedSymbol: { font: 'MS Gothic', char: '2612' },
          uncheckedSymbol: { font: 'MS Gothic', char: '2610' },
        },
      },
    };

    const element = renderRun(
      checkboxRun,
      { pageNumber: 1, totalPages: 1, section: 'body' },
      makeRunContext(undefined),
    );

    expect(element?.dataset.wordCheckboxGlyph).toBeUndefined();
  });

  it('keeps an editable body page field on the body coordinate requirement', () => {
    const collector = createPositionValidationCollector({
      enabled: true,
      coordinateModel: 'editor-neutral-story',
    });

    renderRun(pageField, { pageNumber: 1, totalPages: 1, section: 'body' }, makeRunContext(collector));

    const summary = collector.consume();
    expect(summary.byRequirement['legacy-pm-required'].checked).toBe(1);
    expect(summary.issuesByCode['missing-both']).toBe(1);
  });

  it('classifies the same dynamic field as visual-only in named furniture', () => {
    const collector = createPositionValidationCollector({
      enabled: true,
      coordinateModel: 'editor-neutral-story',
    });

    renderRun(
      pageField,
      { pageNumber: 1, totalPages: 1, section: 'footer', story: { kind: 'footer', id: 'rId9' } },
      makeRunContext(collector),
    );

    const summary = collector.consume();
    expect(summary.byRequirement['visual-only'].valid).toBe(1);
    expect(summary.issues).toBe(0);
  });
});
