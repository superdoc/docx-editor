import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTestEditor, loadTestDataForEditorTests } from '../../tests/helpers/helpers.js';
import { updateLinkedStyleDefinition } from './update-linked-style.js';
import { findStyleXmlElement } from './style-formatting.js';
import { LinkedStylesPluginKey } from './plugin.js';

// CHARACTERIZATION (Task 1): the shapes recorded here are the baseline that the
// mapper + engine tasks assert against. Re-verify if the SuperDoc style shapes
// change on upgrade (this is exactly what broke the al-pmo overlay).
//
// RECORDED 2026-06-18 (paragraph_spacing_missing.docx):
//   getStyles() ids include: Normal, Heading1..6, Title, Subtitle, Quote, ...
//   Heading1.definition.styles is a FLAT map; out of the box here it holds only
//   block keys: { spacing: { lineSpaceAfter, lineSpaceBefore }, indent: {}, tabStops: null }.
//   Run-level keys are NOT present initially; our mapper writes them as:
//     bold/italic/underline -> presence ({} when on, key absent when off)
//     'font-size' -> "<pt>pt",  'font-family' -> "<family>",  color -> "#RRGGBB"
//   generateLinkedStyleString() reads those run keys into CSS (e.g. "font-size: 30pt").

describe('updateLinkedStyle', () => {
  const filename = 'paragraph_spacing_missing.docx';
  let docx, media, mediaFiles, fonts, editor;
  beforeAll(async () => ({ docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests(filename)));
  beforeEach(() => {
    ({ editor } = initTestEditor({ content: docx, media, mediaFiles, fonts }));
  });

  it('exposes Heading1 with a flat definition.styles map', () => {
    const style = editor.helpers.linkedStyles.getStyleById('Heading1');
    expect(style).toBeTruthy();
    expect(style.id).toBe('Heading1');
    expect(style.type).toBe('paragraph');
    expect(style.definition).toBeTruthy();
    expect(typeof style.definition.styles).toBe('object');
  });
});

describe('updateLinkedStyleDefinition (run-level)', () => {
  const filename = 'paragraph_spacing_missing.docx';
  let docx, media, mediaFiles, fonts, editor;
  beforeAll(async () => ({ docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests(filename)));
  beforeEach(() => {
    ({ editor } = initTestEditor({ content: docx, media, mediaFiles, fonts }));
  });

  it('redefines a style definition and reflects it in the CSS string', () => {
    const id = 'Heading1';
    const before = editor.helpers.linkedStyles.getLinkedStyleString(id);
    const ok = updateLinkedStyleDefinition(editor, id, {
      bold: true,
      italic: false,
      underline: false,
      fontSizePt: 30,
      fontFamily: 'Times New Roman',
      colorHex: 'FF0000',
    });
    expect(ok).toBe(true);
    const after = editor.helpers.linkedStyles.getLinkedStyleString(id);
    expect(after).not.toBe(before);
    expect(after).toContain('30pt');
    expect(after.toLowerCase()).toContain('times new roman');
  });

  it('returns false for an unknown style and does not throw', () => {
    expect(
      updateLinkedStyleDefinition(editor, 'NoSuchStyle', {
        bold: false,
        italic: false,
        underline: false,
        fontSizePt: null,
        fontFamily: null,
        colorHex: null,
      }),
    ).toBe(false);
  });
});

// Regression guard for the "only repaints once" bug. A redefinition changes no
// document content, so each render path needs its own non-document repaint
// signal, and it must fire on EVERY call — not just the first.
describe('updateLinkedStyle repaint signals', () => {
  const filename = 'paragraph_spacing_missing.docx';
  let docx, media, mediaFiles, fonts, editor;
  beforeAll(async () => ({ docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests(filename)));
  beforeEach(() => {
    ({ editor } = initTestEditor({ content: docx, media, mediaFiles, fonts }));
  });

  const headingDecoStrings = () => {
    const set = LinkedStylesPluginKey.getState(editor.state).decorations;
    return set
      .find()
      .map((d) => d.type?.attrs?.style)
      .filter(Boolean);
  };

  it('regenerates plain-PM decorations on EVERY redefinition (not just the first)', () => {
    editor.commands.setStyleById('Heading1');

    editor.commands.updateLinkedStyle('Heading1', {
      bold: false,
      italic: false,
      underline: false,
      fontSizePt: 30,
      fontFamily: 'Arial',
      colorHex: 'FF0000',
    });
    expect(headingDecoStrings().some((s) => s.includes('30pt'))).toBe(true);

    editor.commands.updateLinkedStyle('Heading1', {
      bold: false,
      italic: false,
      underline: false,
      fontSizePt: 40,
      fontFamily: 'Georgia',
      colorHex: '00FF00',
    });
    const after = headingDecoStrings();
    expect(after.some((s) => s.includes('40pt'))).toBe(true);
    expect(after.some((s) => s.includes('30pt'))).toBe(false); // second update took effect
  });
});

// Layout/presentation mode paints from a FlowBlockCache keyed on node identity,
// which a definition change does not invalidate. The engine must ask the
// PresentationEditor to clear that cache and re-render — on every call.
describe('updateLinkedStyle layout-mode repaint hook', () => {
  it('calls presentationEditor.refreshLinkedStyles on each redefinition', () => {
    const refreshLinkedStyles = vi.fn();
    const fakeEditor = {
      presentationEditor: { refreshLinkedStyles },
      converter: {
        linkedStyles: [{ id: 'Heading1', type: 'paragraph', definition: { attrs: {}, styles: {} } }],
        translatedLinkedStyles: { styles: {} },
        convertedXml: {},
      },
      // no `view` => the PM-decoration signal is skipped, isolating the layout hook
    };
    const fmt = { bold: false, italic: false, underline: false, fontSizePt: null, fontFamily: null, colorHex: null };
    expect(updateLinkedStyleDefinition(fakeEditor, 'Heading1', { ...fmt, fontSizePt: 20 })).toBe(true);
    expect(updateLinkedStyleDefinition(fakeEditor, 'Heading1', { ...fmt, fontSizePt: 28 })).toBe(true);
    expect(refreshLinkedStyles).toHaveBeenCalledTimes(2);
  });
});

describe('updateLinkedStyle command', () => {
  const filename = 'paragraph_spacing_missing.docx';
  let docx, media, mediaFiles, fonts, editor;
  beforeAll(async () => ({ docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests(filename)));
  beforeEach(() => {
    ({ editor } = initTestEditor({ content: docx, media, mediaFiles, fonts }));
  });

  it('is callable via editor.commands and updates the style', () => {
    const ok = editor.commands.updateLinkedStyle('Heading1', {
      bold: true,
      italic: false,
      underline: false,
      fontSizePt: 28,
      fontFamily: 'Arial',
      colorHex: '1F3864',
    });
    expect(ok).toBe(true);
    expect(editor.helpers.linkedStyles.getLinkedStyleString('Heading1')).toContain('28pt');
  });
});

describe('style formatting read helpers', () => {
  const filename = 'paragraph_spacing_missing.docx';
  let docx, media, mediaFiles, fonts, editor;
  beforeAll(async () => ({ docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests(filename)));
  beforeEach(() => {
    ({ editor } = initTestEditor({ content: docx, media, mediaFiles, fonts }));
  });

  it('round-trips a redefinition through getLinkedStyleFormatting', () => {
    editor.commands.updateLinkedStyle('Heading1', {
      bold: true,
      italic: false,
      underline: false,
      fontSizePt: 22,
      fontFamily: 'Georgia',
      colorHex: 'AA0000',
    });
    const fmt = editor.helpers.linkedStyles.getLinkedStyleFormatting('Heading1');
    expect(fmt).toMatchObject({ bold: true, fontSizePt: 22, fontFamily: 'Georgia', colorHex: 'AA0000' });
  });

  it('getEffectiveFormattingAtSelection returns a CapturedFormatting object', () => {
    const fmt = editor.helpers.linkedStyles.getEffectiveFormattingAtSelection();
    expect(fmt).toHaveProperty('bold');
    expect(fmt).toHaveProperty('fontSizePt');
    expect(fmt).toHaveProperty('colorHex');
  });

  it('captures style-resolved formatting when the selection has no direct marks', () => {
    // Put the cursor in a paragraph, make it Heading1 (which clears direct marks),
    // and give Heading1 a distinctive look. The cursor now has NO direct marks, so
    // the visible formatting comes entirely from the named style.
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (pos == null && node.type.name === 'paragraph') pos = p + 1;
      return pos == null;
    });
    editor.commands.setTextSelection(pos);
    editor.commands.setStyleById('Heading1');
    editor.commands.updateLinkedStyle('Heading1', {
      bold: true,
      italic: false,
      underline: false,
      fontSizePt: 21,
      fontFamily: 'Georgia',
      colorHex: '112233',
    });

    const fmt = editor.helpers.linkedStyles.getEffectiveFormattingAtSelection();
    // Must reflect the style, not empty/false (the bug: marks-only read wiped it).
    expect(fmt).toMatchObject({ bold: true, fontSizePt: 21, fontFamily: 'Georgia', colorHex: '112233' });
  });
});

describe('export representations (characterization)', () => {
  const filename = 'paragraph_spacing_missing.docx';
  let docx, media, mediaFiles, fonts, editor;
  beforeAll(async () => ({ docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests(filename)));
  beforeEach(() => {
    ({ editor } = initTestEditor({ content: docx, media, mediaFiles, fonts }));
  });

  it('exposes the two export representations', () => {
    const c = editor.converter;
    expect(typeof c.translatedLinkedStyles).toBe('object');
    expect(c.translatedLinkedStyles?.styles?.Heading1?.styleId).toBe('Heading1');
    const xml = c.convertedXml?.['word/styles.xml'];
    expect(xml).toBeTruthy();
    expect(xml.elements?.[0]?.name).toBe('w:styles');
  });

  // RECORDED 2026-06-18 (paragraph_spacing_missing.docx):
  //   translatedLinkedStyles.styles.Heading1 = { type:'paragraph', styleId, name, basedOn,
  //     next, uiPriority, qFormat, paragraphProperties: { spacing, outlineLvl } }  (no runProperties yet)
  //     -> run channel: runProperties.{ bold, italic, underline:{value:'single'}, fontSize:<halfPoints:int>,
  //        fontFamily:{ascii,hAnsi,cs}, color:{val:<hex no #>} }
  //   word/styles.xml root = w:styles; Heading1 = w:style[@w:styleId='Heading1'] with children
  //     w:name, w:basedOn, w:next, w:uiPriority, w:qFormat, w:pPr (no w:rPr yet).
  //     -> append w:rPr (correct CT_Style order is after w:pPr) with w:b/w:i/w:u, w:sz+w:szCs (halfPoints),
  //        w:rFonts{w:ascii,w:hAnsi,w:cs}, w:color{w:val}.
});

describe('redefinition survives in the export representations', () => {
  const filename = 'paragraph_spacing_missing.docx';
  let docx, media, mediaFiles, fonts, editor;
  beforeAll(async () => ({ docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests(filename)));
  beforeEach(() => {
    ({ editor } = initTestEditor({ content: docx, media, mediaFiles, fonts }));
  });

  it('patches word/styles.xml (size in half-points) on redefinition', () => {
    editor.commands.updateLinkedStyle('Heading1', {
      bold: true,
      italic: false,
      underline: false,
      fontSizePt: 30,
      fontFamily: 'Arial',
      colorHex: 'FF0000',
    });
    const xml = editor.converter.convertedXml['word/styles.xml'];
    const styleEl = findStyleXmlElement(xml, 'Heading1');
    const rpr = styleEl.elements.find((e) => e.name === 'w:rPr');
    expect(rpr.elements.find((e) => e.name === 'w:sz')?.attributes['w:val']).toBe('60');
    expect(rpr.elements.find((e) => e.name === 'w:color')?.attributes['w:val']).toBe('FF0000');
  });

  it('patches translatedLinkedStyles run channel on redefinition', () => {
    editor.commands.updateLinkedStyle('Heading1', {
      bold: true,
      italic: false,
      underline: false,
      fontSizePt: 24,
      fontFamily: 'Georgia',
      colorHex: 'AA0000',
    });
    const def = editor.converter.translatedLinkedStyles.styles.Heading1;
    expect(def.runProperties.fontSize).toBe(48);
    expect(def.runProperties.fontFamily).toEqual({ ascii: 'Georgia', hAnsi: 'Georgia', cs: 'Georgia' });
    expect(def.runProperties.color).toEqual({ val: 'AA0000' });
  });
});
