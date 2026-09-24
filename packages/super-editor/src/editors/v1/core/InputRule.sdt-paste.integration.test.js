import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { initTestEditor, loadTestDataForEditorTests } from '../tests/helpers/helpers.js';
import { Editor } from './Editor.js';
import { handleClipboardPaste } from './InputRule.js';
import { embedSliceInHtml } from './helpers/superdocClipboardSlice.js';

const SOURCE_INLINE_ID = '1376475321';
const SOURCE_BLOCK_ID = '1376475322';
const NESTED_INLINE_ID = '1376475323';

function collectControls(document) {
  const controls = [];
  document.descendants((node) => {
    if (node.type.name === 'structuredContent' || node.type.name === 'structuredContentBlock') {
      controls.push({ id: node.attrs.id, tag: node.attrs.tag, alias: node.attrs.alias, lockMode: node.attrs.lockMode });
    }
  });
  return controls;
}

describe('native SuperDoc slice paste of content controls', () => {
  let editor;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('mints independent IDs for inline, block, and nested controls in a compound selection', async () => {
    const { docx, media, mediaFiles, fonts } = await loadTestDataForEditorTests('blank-doc.docx');
    ({ editor } = initTestEditor({ mode: 'docx', content: docx, media, mediaFiles, fonts }));
    const { schema } = editor;
    const inline = schema.nodes.structuredContent.create(
      { id: SOURCE_INLINE_ID, tag: 'inline-tag', alias: 'Inline', lockMode: 'sdtLocked' },
      schema.text('inline value'),
    );
    const nested = schema.nodes.structuredContent.create(
      { id: NESTED_INLINE_ID, tag: 'nested-tag', alias: 'Nested' },
      schema.text('nested value'),
    );
    const block = schema.nodes.structuredContentBlock.create(
      { id: SOURCE_BLOCK_ID, tag: 'block-tag', alias: 'Block' },
      schema.nodes.paragraph.create(null, [schema.text('block text '), nested]),
    );
    const sourceParagraph = schema.nodes.paragraph.create(null, [
      schema.text('before '),
      inline,
      schema.text(' after'),
    ]);
    const destinationParagraph = schema.nodes.paragraph.create(null, schema.text('destination'));
    const initialDocument = schema.nodes.doc.create(null, [sourceParagraph, block, destinationParagraph]);
    editor.setState(EditorState.create({ schema, doc: initialDocument, plugins: editor.state.plugins }));

    const selected = initialDocument.slice(0, sourceParagraph.nodeSize + block.nodeSize);
    const clipboardHtml = embedSliceInHtml('<p>fallback</p>', JSON.stringify(selected.toJSON()));
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)),
    );

    expect(handleClipboardPaste({ editor, view: editor.view }, clipboardHtml, 'before inline value after')).toBe(true);

    const controls = collectControls(editor.state.doc);
    expect(controls).toHaveLength(6);
    expect(controls.slice(0, 3).map(({ id }) => id)).toEqual([SOURCE_INLINE_ID, SOURCE_BLOCK_ID, NESTED_INLINE_ID]);
    expect(new Set(controls.map(({ id }) => id)).size).toBe(6);
    expect(controls.every(({ id }) => typeof id === 'string' && /^-?\d+$/.test(id))).toBe(true);
    expect(controls.slice(3).map(({ tag, alias, lockMode }) => ({ tag, alias, lockMode }))).toEqual(
      controls.slice(0, 3).map(({ tag, alias, lockMode }) => ({ tag, alias, lockMode })),
    );
    expect(editor.state.doc.textContent.match(/before inline value after/g)).toHaveLength(2);
    expect(editor.state.doc.textContent.match(/block text nested value/g)).toHaveLength(2);
    expect(editor.state.doc.textContent.match(/destination/g)).toHaveLength(1);
    for (const control of controls) {
      const target = { kind: 'block', nodeType: 'sdt', nodeId: control.id };
      expect(editor.doc.contentControls.get({ target }).properties.tag).toBe(control.tag);
    }

    const exportedXml = await editor.exportDocx({ exportXmlOnly: true });
    const exportedIds = [...exportedXml.matchAll(/<w:id\b[^>]*w:val="(-?\d+)"/g)].map((match) => match[1]);
    expect(exportedIds).toEqual(expect.arrayContaining(controls.map(({ id }) => id)));
    expect(new Set(exportedIds).size).toBe(exportedIds.length);

    const [content, reopenedMedia, reopenedMediaFiles, reopenedFonts] = await Editor.loadXmlData(
      await editor.exportDocx(),
      true,
    );
    const { editor: reopened } = initTestEditor({
      content,
      media: reopenedMedia,
      mediaFiles: reopenedMediaFiles,
      fonts: reopenedFonts,
      mode: 'docx',
    });
    try {
      const reopenedControls = collectControls(reopened.state.doc);
      expect(reopenedControls.map(({ id }) => id)).toEqual(controls.map(({ id }) => id));
      expect(reopenedControls.map(({ tag }) => tag)).toEqual(controls.map(({ tag }) => tag));
      for (const control of reopenedControls) {
        const target = { kind: 'block', nodeType: 'sdt', nodeId: control.id };
        expect(reopened.doc.contentControls.get({ target }).properties.tag).toBe(control.tag);
      }
    } finally {
      reopened.destroy();
    }
  });

  it('reidentifies content controls in HTML-only paste when the rich slice is unavailable', () => {
    ({ editor } = initTestEditor({ mode: 'text', content: '<p></p>' }));
    const { schema } = editor;
    const source = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.structuredContent.create({ id: SOURCE_INLINE_ID, tag: 'html-control' }, schema.text('source')),
      ]),
      schema.nodes.paragraph.create(null, schema.text('destination')),
    ]);
    editor.setState(EditorState.create({ schema, doc: source, plugins: editor.state.plugins }));
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)),
    );

    const html = `<p><span data-structured-content data-id="${SOURCE_INLINE_ID}" data-tag="html-control">source</span></p>`;
    expect(handleClipboardPaste({ editor, view: editor.view }, html, 'source')).toBe(true);

    const controls = collectControls(editor.state.doc);
    expect(controls).toHaveLength(2);
    expect(controls[0].id).toBe(SOURCE_INLINE_ID);
    expect(controls[1].id).toMatch(/^-?\d+$/);
    expect(controls[1].id).not.toBe(SOURCE_INLINE_ID);
    expect(controls[1].tag).toBe('html-control');
  });

  it('keeps ordinary non-control slice paste unchanged', () => {
    ({ editor } = initTestEditor({ mode: 'text', content: '<p>destination</p>' }));
    const source = editor.schema.nodes.doc.create(null, [
      editor.schema.nodes.paragraph.create(null, editor.schema.text('ordinary text')),
    ]);
    const clipboardHtml = embedSliceInHtml(
      '<p>fallback</p>',
      JSON.stringify(source.slice(0, source.content.size).toJSON()),
    );

    expect(handleClipboardPaste({ editor, view: editor.view }, clipboardHtml, 'ordinary text')).toBe(true);
    expect(editor.state.doc.textContent).toContain('ordinary text');
    expect(collectControls(editor.state.doc)).toHaveLength(0);
  });
});
