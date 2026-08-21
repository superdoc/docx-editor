import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { initTestEditor } from '@tests/helpers/helpers.js';
import { createTable } from '../table/tableHelpers/createTable.js';

const BLOCK_ID = 'structured-block-1';

/**
 * Locate the first table node within the provided document.
 * @param {import('prosemirror-model').Node} doc
 * @returns {import('prosemirror-model').Node|null}
 */
function findFirstTable(doc) {
  let found = null;
  doc.descendants((node) => {
    if (node.type.name === 'table') {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Locate the first text node within the provided node's descendants.
 * Needed because some plugins (e.g., run wrapping) add inline wrappers.
 * @param {import('prosemirror-model').Node} node
 * @returns {import('prosemirror-model').Node | null}
 */
function findFirstTextNode(node) {
  let found = null;
  node.descendants((child) => {
    if (child.type.name === 'text') {
      found = child;
      return false;
    }
    return true;
  });
  return found;
}

function findFirstNodeByType(node, typeName) {
  let found = null;
  node.descendants((child) => {
    if (child.type.name === typeName) {
      found = child;
      return false;
    }
    return true;
  });
  return found;
}

describe('StructuredContentTableCommands', () => {
  let editor;
  let schema;
  let templateMarkType;
  let templateBlockType;
  let templateBlockAttrs;

  beforeEach(() => {
    ({ editor } = initTestEditor({ mode: 'text', content: '<p></p>' }));
    ({ schema } = editor);

    templateMarkType = schema.marks.bold || schema.marks.strong || null;
    templateBlockType = schema.nodes.heading || schema.nodes.paragraph;
    templateBlockAttrs = templateBlockType === schema.nodes.heading ? { level: 3 } : null;

    let table = createTable(schema, 2, 2, false);
    const rows = [];
    table.forEach((row, _offset, index) => {
      if (index === table.childCount - 1) {
        const cellType = schema.nodes.tableCell;
        const mark = templateMarkType ? templateMarkType.create() : null;
        const styledText = schema.text('Styled Template', mark ? [mark] : undefined);
        const styledBlock = templateBlockType.create(templateBlockAttrs, styledText);
        const baselineBlock = schema.nodes.paragraph.create(null, schema.text('Baseline'));
        const firstCell = cellType.create(row.firstChild.attrs, styledBlock);
        const secondCell = cellType.create(row.lastChild.attrs, baselineBlock);
        rows.push(row.type.create(row.attrs, [firstCell, secondCell]));
      } else {
        rows.push(row);
      }
    });
    table = table.type.create(table.attrs, rows);

    const block = schema.nodes.structuredContentBlock.create({ id: BLOCK_ID }, table ? [table] : undefined);
    const doc = schema.nodes.doc.create(null, [block]);

    const nextState = EditorState.create({ schema, doc, plugins: editor.state.plugins });
    editor.setState(nextState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editor?.destroy();
    editor = null;
    schema = null;
    templateMarkType = null;
    templateBlockType = null;
    templateBlockAttrs = null;
  });

  it('appends rows to the structured content table', () => {
    const initialTable = findFirstTable(editor.state.doc);
    expect(initialTable).not.toBeNull();
    const initialRowCount = initialTable.childCount;

    const didAppend = editor.commands.appendRowsToStructuredContentTable({
      id: BLOCK_ID,
      rows: [['Alpha', 'Beta']],
    });

    expect(didAppend).toBe(true);

    const updatedTable = findFirstTable(editor.state.doc);
    expect(updatedTable.childCount).toBe(initialRowCount + 1);

    const lastRow = updatedTable.lastChild;
    const cellTexts = lastRow.content.content.map((cell) => cell.textContent);
    expect(cellTexts).toEqual(['Alpha', 'Beta']);
  });

  it('copies template styling when copyRowStyle is true', () => {
    const didAppend = editor.commands.appendRowsToStructuredContentTable({
      id: BLOCK_ID,
      rows: [['Styled Copy', 'Value']],
      copyRowStyle: true,
    });

    expect(didAppend).toBe(true);

    const updatedTable = findFirstTable(editor.state.doc);
    const newLastRow = updatedTable.lastChild;
    const firstCell = newLastRow.firstChild;
    const blockNode = firstCell.firstChild;
    const textNode = blockNode.firstChild.firstChild;

    expect(blockNode.type).toBe(templateBlockType);
    if (templateBlockAttrs) {
      expect(blockNode.attrs).toMatchObject(templateBlockAttrs);
    }

    if (templateMarkType) {
      const hasMark = textNode.marks.some((mark) => mark.type === templateMarkType);
      expect(hasMark).toBe(true);
    }
  });
});

describe('updateStructuredContentById', () => {
  let editor;
  let schema;
  const INLINE_ID = 'structured-inline-1';

  beforeEach(() => {
    // Use default mode (docx) to ensure structured content extensions are available
    ({ editor } = initTestEditor());
    ({ schema } = editor);

    // Create a structured content inline with styled text (bold)
    const boldMark = schema.marks.bold || schema.marks.strong;
    const styledText = schema.text('Styled Content', boldMark ? [boldMark.create()] : []);
    const inlineNode = schema.nodes.structuredContent.create({ id: INLINE_ID }, styledText);
    const paragraph = schema.nodes.paragraph.create(null, [inlineNode]);
    const doc = schema.nodes.doc.create(null, [paragraph]);

    const nextState = EditorState.create({ schema, doc, plugins: editor.state.plugins });
    editor.setState(nextState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editor?.destroy();
    editor = null;
    schema = null;
  });

  it('throws error when updating ID with a non-integer value', () => {
    expect(() => {
      editor.commands.updateStructuredContentById(INLINE_ID, {
        attrs: { id: 'abc-123' },
      });
    }).toThrow('Invalid structured content id - must be an integer, got: abc-123');
  });

  it('returns false when no structured content matches the requested ID', () => {
    const originalDoc = editor.state.doc.toJSON();

    const didUpdate = editor.commands.updateStructuredContentById('missing-structured-content-id', {
      text: 'New Content',
    });

    expect(didUpdate).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(originalDoc);
  });

  describe('keepTextNodeStyles option', () => {
    it('preserves marks from the first text node when keepTextNodeStyles is true', () => {
      const didUpdate = editor.commands.updateStructuredContentById(INLINE_ID, {
        text: 'New Content',
        keepTextNodeStyles: true,
      });

      expect(didUpdate).toBe(true);

      // Find the updated structured content
      let updatedNode = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent' && node.attrs.id === INLINE_ID) {
          updatedNode = node;
          return false;
        }
      });

      expect(updatedNode).not.toBeNull();
      expect(updatedNode.textContent).toBe('New Content');

      // Check that the bold mark was preserved
      const firstTextNode = findFirstTextNode(updatedNode);
      expect(firstTextNode).not.toBeNull();
      expect(firstTextNode.type.name).toBe('text');
      const boldMark = schema.marks.bold || schema.marks.strong;
      if (boldMark) {
        const hasBoldMark = firstTextNode.marks.some((mark) => mark.type === boldMark);
        expect(hasBoldMark).toBe(true);
      }
    });

    it('does not preserve marks when keepTextNodeStyles is false or not provided', () => {
      const didUpdate = editor.commands.updateStructuredContentById(INLINE_ID, {
        text: 'New Content',
        keepTextNodeStyles: false,
      });

      expect(didUpdate).toBe(true);

      // Find the updated structured content
      let updatedNode = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent' && node.attrs.id === INLINE_ID) {
          updatedNode = node;
          return false;
        }
      });

      expect(updatedNode).not.toBeNull();
      expect(updatedNode.textContent).toBe('New Content');

      // Check that no marks are present
      const firstTextNode = findFirstTextNode(updatedNode);
      expect(firstTextNode).not.toBeNull();
      expect(firstTextNode.type.name).toBe('text');
      expect(firstTextNode.marks.length).toBe(0);
    });

    it('handles structured content with no text nodes gracefully', () => {
      // Create a structured content with no text nodes (empty content)
      const emptyInlineId = 'empty-inline';
      const emptyInline = schema.nodes.structuredContent.create({ id: emptyInlineId });
      const paragraph = schema.nodes.paragraph.create(null, [emptyInline]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      const nextState = EditorState.create({ schema, doc, plugins: editor.state.plugins });
      editor.setState(nextState);

      const didUpdate = editor.commands.updateStructuredContentById(emptyInlineId, {
        text: 'New Content',
        keepTextNodeStyles: true,
      });

      expect(didUpdate).toBe(true);

      // Find the updated structured content
      let updatedNode = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent' && node.attrs.id === emptyInlineId) {
          updatedNode = node;
          return false;
        }
      });

      expect(updatedNode).not.toBeNull();
      expect(updatedNode.textContent).toBe('New Content');

      // Should have no marks since there was no text node to copy from
      const firstTextNode = findFirstTextNode(updatedNode);
      expect(firstTextNode).not.toBeNull();
      expect(firstTextNode.type.name).toBe('text');
      expect(firstTextNode.marks.length).toBe(0);
    });
  });

  describe('validation before transaction', () => {
    it('validates the updated node before applying the transaction', () => {
      // Spy on console.error to verify validation error is logged
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Try to update with invalid JSON that will fail validation
      // Creating an invalid node structure that violates schema rules
      const invalidJSON = {
        type: 'paragraph', // structuredContent inline should contain inline content, not a paragraph
        content: [{ type: 'text', text: 'Invalid' }],
      };

      const didUpdate = editor.commands.updateStructuredContentById(INLINE_ID, {
        json: invalidJSON,
      });

      // The command should return false due to validation failure
      expect(didUpdate).toBe(false);

      // Verify that console.error was called with validation error
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toBe('Invalid content.');

      // Verify the original node was NOT modified
      let originalNode = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent' && node.attrs.id === INLINE_ID) {
          originalNode = node;
          return false;
        }
      });

      expect(originalNode).not.toBeNull();
      expect(originalNode.textContent).toBe('Styled Content'); // Original text unchanged

      consoleErrorSpy.mockRestore();
    });

    it('allows valid updates to proceed through validation', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Update with valid content
      const didUpdate = editor.commands.updateStructuredContentById(INLINE_ID, {
        text: 'Valid Update',
      });

      // Should succeed
      expect(didUpdate).toBe(true);

      // Verify no validation errors were logged
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // Verify the node was updated
      let updatedNode = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent' && node.attrs.id === INLINE_ID) {
          updatedNode = node;
          return false;
        }
      });

      expect(updatedNode).not.toBeNull();
      expect(updatedNode.textContent).toBe('Valid Update');

      consoleErrorSpy.mockRestore();
    });

    it('prevents transaction when validation throws an error', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock validateJSON to throw an error during validation
      const originalValidateJSON = editor.validateJSON;
      editor.validateJSON = vi.fn().mockImplementation(() => {
        return {
          check: () => {
            throw new Error('Validation failed: invalid content structure');
          },
        };
      });

      const didUpdate = editor.commands.updateStructuredContentById(INLINE_ID, {
        text: 'This will fail validation',
      });

      // Should fail validation and return false
      expect(didUpdate).toBe(false);

      // Verify validation error was logged
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toBe('Invalid content.');

      // Verify the original node was NOT modified
      let originalNode = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent' && node.attrs.id === INLINE_ID) {
          originalNode = node;
          return false;
        }
      });

      expect(originalNode).not.toBeNull();
      expect(originalNode.textContent).toBe('Styled Content'); // Original text unchanged

      // Restore mocks
      editor.validateJSON = originalValidateJSON;
      consoleErrorSpy.mockRestore();
    });
  });
});

describe('updateStructuredContentByGroup', () => {
  let editor;
  let schema;
  const GROUP_NAME = 'test-group';

  beforeEach(() => {
    // Use default mode (docx) to ensure structured content extensions are available
    ({ editor } = initTestEditor());
    ({ schema } = editor);

    // Create multiple structured content nodes with the same group
    const boldMark = schema.marks.bold || schema.marks.strong;
    const styledText1 = schema.text('Styled Content 1', boldMark ? [boldMark.create()] : []);
    const styledText2 = schema.text('Styled Content 2', boldMark ? [boldMark.create()] : []);

    // Create tag object for group
    const tagObject = { group: GROUP_NAME };
    const tagString = JSON.stringify(tagObject);

    const inlineNode1 = schema.nodes.structuredContent.create({ id: 'inline-1', tag: tagString }, styledText1);
    const inlineNode2 = schema.nodes.structuredContent.create({ id: 'inline-2', tag: tagString }, styledText2);

    const paragraph = schema.nodes.paragraph.create(null, [inlineNode1, schema.text(' '), inlineNode2]);
    const doc = schema.nodes.doc.create(null, [paragraph]);

    const nextState = EditorState.create({ schema, doc, plugins: editor.state.plugins });
    editor.setState(nextState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editor?.destroy();
    editor = null;
    schema = null;
  });

  it('throws error when updating ID with a non-integer value', () => {
    expect(() => {
      editor.commands.updateStructuredContentByGroup(GROUP_NAME, {
        attrs: { id: 'abc-123' },
      });
    }).toThrow('Invalid structured content id - must be an integer, got: abc-123');
  });

  describe('keepTextNodeStyles option', () => {
    it('preserves marks from the first text node for all nodes in group when keepTextNodeStyles is true', () => {
      const didUpdate = editor.commands.updateStructuredContentByGroup(GROUP_NAME, {
        text: 'Updated Content',
        keepTextNodeStyles: true,
      });

      expect(didUpdate).toBe(true);

      // Find all updated structured content nodes in the group
      const updatedNodes = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent') {
          updatedNodes.push(node);
        }
      });

      expect(updatedNodes.length).toBe(2);

      // Check that both nodes have the updated text with preserved marks
      updatedNodes.forEach((node) => {
        expect(node.textContent).toBe('Updated Content');

        const firstTextNode = findFirstTextNode(node);
        expect(firstTextNode).not.toBeNull();
        expect(firstTextNode.type.name).toBe('text');

        const boldMark = schema.marks.bold || schema.marks.strong;
        if (boldMark) {
          const hasBoldMark = firstTextNode.marks.some((mark) => mark.type === boldMark);
          expect(hasBoldMark).toBe(true);
        }
      });
    });

    it('does not preserve marks when keepTextNodeStyles is false or not provided', () => {
      const didUpdate = editor.commands.updateStructuredContentByGroup(GROUP_NAME, {
        text: 'Updated Content',
        keepTextNodeStyles: false,
      });

      expect(didUpdate).toBe(true);

      // Find all updated structured content nodes in the group
      const updatedNodes = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent') {
          updatedNodes.push(node);
        }
      });

      expect(updatedNodes.length).toBe(2);

      // Check that both nodes have the updated text without marks
      updatedNodes.forEach((node) => {
        expect(node.textContent).toBe('Updated Content');

        const firstTextNode = findFirstTextNode(node);
        expect(firstTextNode).not.toBeNull();
        expect(firstTextNode.type.name).toBe('text');
        expect(firstTextNode.marks.length).toBe(0);
      });
    });
  });

  describe('validation before transaction', () => {
    it('validates each updated node before applying the transaction', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Try to update with invalid JSON that will fail validation
      const invalidJSON = {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Invalid' }],
      };

      const didUpdate = editor.commands.updateStructuredContentByGroup(GROUP_NAME, {
        json: invalidJSON,
      });

      // The command should return false due to validation failure (all-or-nothing behavior)
      expect(didUpdate).toBe(false);

      // Verify that console.error was called with validation error
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toBe('Invalid content.');

      // Verify the original nodes were NOT modified
      const originalNodes = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent') {
          originalNodes.push(node);
        }
      });

      expect(originalNodes.length).toBe(2);
      expect(originalNodes[0].textContent).toBe('Styled Content 1'); // Original text unchanged
      expect(originalNodes[1].textContent).toBe('Styled Content 2'); // Original text unchanged

      consoleErrorSpy.mockRestore();
    });

    it('allows valid updates to proceed through validation for all nodes in group', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Update with valid content
      const didUpdate = editor.commands.updateStructuredContentByGroup(GROUP_NAME, {
        text: 'Valid Update',
      });

      // Should succeed
      expect(didUpdate).toBe(true);

      // Verify no validation errors were logged
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // Verify all nodes were updated
      const updatedNodes = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'structuredContent') {
          updatedNodes.push(node);
        }
      });

      expect(updatedNodes.length).toBe(2);
      updatedNodes.forEach((node) => {
        expect(node.textContent).toBe('Valid Update');
      });

      consoleErrorSpy.mockRestore();
    });
  });
});

describe('insertStructuredContentInline formatting', () => {
  let editor;
  let schema;

  beforeEach(() => {
    ({ editor } = initTestEditor());
    ({ schema } = editor);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    schema = null;
  });

  it('does not wrap structuredContent in a run when inserted inside a run', () => {
    const fontFamily = {
      ascii: 'Courier New',
      eastAsia: 'Courier New',
      hAnsi: 'Courier New',
      cs: 'Courier New',
    };
    const textStyleMark = schema.marks.textStyle.create({
      fontFamily: 'Courier New',
      fontSize: '12pt',
    });
    const styledText = schema.text('This is some text', [textStyleMark]);
    const run = schema.nodes.run.create({ runProperties: { fontFamily } }, styledText);
    const paragraph = schema.nodes.paragraph.create(null, [run]);
    const doc = schema.nodes.doc.create(null, [paragraph]);

    // run content starts at position 2 (doc > paragraph > run), so cursor after "This is " is at 2 + 8 = 10
    const cursorPos = 2 + 'This is '.length; // 10
    const nextState = EditorState.create({
      schema,
      doc,
      plugins: editor.state.plugins,
      selection: TextSelection.create(doc, cursorPos),
    });
    editor.setState(nextState);

    editor.commands.insertStructuredContentInline({
      text: 'Inline Header',
      attrs: { group: 'header' },
    });

    const updatedParagraph = editor.state.doc.firstChild;

    // The paragraph's direct children should be: run, structuredContent, run
    // The structuredContent must NOT be wrapped in a run
    const childTypes = [];
    updatedParagraph.forEach((child) => {
      childTypes.push(child.type.name);

      // If a run contains a structuredContent as a child, that's the bug
      if (child.type.name === 'run') {
        child.forEach((grandchild) => {
          if (grandchild.type.name === 'structuredContent') {
            throw new Error('structuredContent should not be wrapped inside a run');
          }
        });
      }
    });

    expect(childTypes).toContain('structuredContent');
    expect(updatedParagraph.textContent).toBe('This is Inline Headersome text');

    // The SDT's inner content should be a run with the inherited formatting
    let sdt = null;
    updatedParagraph.forEach((child) => {
      if (child.type.name === 'structuredContent') sdt = child;
    });
    const innerRun = sdt.firstChild;
    expect(innerRun.type.name).toBe('run');
    expect(innerRun.attrs.runProperties).toMatchObject({ fontFamily });
  });

  it('does not produce an empty left run when cursor is at the start of a run', () => {
    const fontFamily = {
      ascii: 'Courier New',
      eastAsia: 'Courier New',
      hAnsi: 'Courier New',
      cs: 'Courier New',
    };
    const textStyleMark = schema.marks.textStyle.create({
      fontFamily: 'Courier New',
      fontSize: '12pt',
    });
    const styledText = schema.text('Hello', [textStyleMark]);
    const run = schema.nodes.run.create({ runProperties: { fontFamily } }, styledText);
    const paragraph = schema.nodes.paragraph.create(null, [run]);
    const doc = schema.nodes.doc.create(null, [paragraph]);

    // Cursor at the very start of the run content: doc(1) + paragraph(1) = 2
    const cursorPos = 2;
    const nextState = EditorState.create({
      schema,
      doc,
      plugins: editor.state.plugins,
      selection: TextSelection.create(doc, cursorPos),
    });
    editor.setState(nextState);

    editor.commands.insertStructuredContentInline({
      text: 'Field',
      attrs: { group: 'header' },
    });

    const updatedParagraph = editor.state.doc.firstChild;

    // Should be: structuredContent, run — no empty run before the SDT
    const childTypes = [];
    updatedParagraph.forEach((child) => {
      childTypes.push(child.type.name);
      if (child.type.name === 'run') {
        expect(child.content.size).toBeGreaterThan(0);
      }
    });

    expect(childTypes).toEqual(['structuredContent', 'run']);
    expect(updatedParagraph.textContent).toBe('FieldHello');
  });

  it('removes selected text when inserting with a ranged selection inside a run', () => {
    const fontFamily = {
      ascii: 'Courier New',
      eastAsia: 'Courier New',
      hAnsi: 'Courier New',
      cs: 'Courier New',
    };
    const textStyleMark = schema.marks.textStyle.create({
      fontFamily: 'Courier New',
      fontSize: '12pt',
    });
    const styledText = schema.text('This is some text', [textStyleMark]);
    const run = schema.nodes.run.create({ runProperties: { fontFamily } }, styledText);
    const paragraph = schema.nodes.paragraph.create(null, [run]);
    const doc = schema.nodes.doc.create(null, [paragraph]);

    // Select "some" (positions 10..14 inside run content starting at 2: "some" = chars 8..12)
    const selFrom = 2 + 'This is '.length; // 10
    const selTo = 2 + 'This is some'.length; // 14
    const nextState = EditorState.create({
      schema,
      doc,
      plugins: editor.state.plugins,
      selection: TextSelection.create(doc, selFrom, selTo),
    });
    editor.setState(nextState);

    editor.commands.insertStructuredContentInline({
      text: 'Inline Header',
      attrs: { group: 'header' },
    });

    const updatedParagraph = editor.state.doc.firstChild;

    // "some" should be removed; remaining text is "This is " + "Inline Header" + " text"
    expect(updatedParagraph.textContent).toBe('This is Inline Header text');
  });

  it('does not produce an empty right run when cursor is at the end of a run', () => {
    const fontFamily = {
      ascii: 'Courier New',
      eastAsia: 'Courier New',
      hAnsi: 'Courier New',
      cs: 'Courier New',
    };
    const textStyleMark = schema.marks.textStyle.create({
      fontFamily: 'Courier New',
      fontSize: '12pt',
    });
    const styledText = schema.text('Hello', [textStyleMark]);
    const run = schema.nodes.run.create({ runProperties: { fontFamily } }, styledText);
    const paragraph = schema.nodes.paragraph.create(null, [run]);
    const doc = schema.nodes.doc.create(null, [paragraph]);

    // Cursor at the very end of the run content: doc(1) + paragraph(1) + "Hello"(5) = 7
    const cursorPos = 2 + 'Hello'.length; // 7
    const nextState = EditorState.create({
      schema,
      doc,
      plugins: editor.state.plugins,
      selection: TextSelection.create(doc, cursorPos),
    });
    editor.setState(nextState);

    editor.commands.insertStructuredContentInline({
      text: 'Field',
      attrs: { group: 'header' },
    });

    const updatedParagraph = editor.state.doc.firstChild;

    // Should be: run, structuredContent — no empty run after the SDT
    const childTypes = [];
    updatedParagraph.forEach((child) => {
      childTypes.push(child.type.name);
      if (child.type.name === 'run') {
        expect(child.content.size).toBeGreaterThan(0);
      }
    });

    expect(childTypes).toEqual(['run', 'structuredContent']);
    expect(updatedParagraph.textContent).toBe('HelloField');
  });

  it('places the cursor right after the inserted SDT', () => {
    const fontFamily = {
      ascii: 'Courier New',
      eastAsia: 'Courier New',
      hAnsi: 'Courier New',
      cs: 'Courier New',
    };
    const textStyleMark = schema.marks.textStyle.create({
      fontFamily: 'Courier New',
      fontSize: '12pt',
    });
    const styledText = schema.text('Hello World', [textStyleMark]);
    const run = schema.nodes.run.create({ runProperties: { fontFamily } }, styledText);
    const paragraph = schema.nodes.paragraph.create(null, [run]);
    const doc = schema.nodes.doc.create(null, [paragraph]);

    // Cursor after "Hello " (6 chars): doc(1) + paragraph(1) + 6 = 8
    const cursorPos = 2 + 'Hello '.length; // 8
    const nextState = EditorState.create({
      schema,
      doc,
      plugins: editor.state.plugins,
      selection: TextSelection.create(doc, cursorPos),
    });
    editor.setState(nextState);

    editor.commands.insertStructuredContentInline({
      text: 'Field',
      attrs: { group: 'header' },
    });

    const updatedState = editor.state;
    const updatedParagraph = updatedState.doc.firstChild;

    // Find the SDT node and compute where the cursor should be (right after it)
    let sdtEnd = null;
    let offset = 1; // paragraph opens at pos 1
    updatedParagraph.forEach((child) => {
      if (child.type.name === 'structuredContent') {
        sdtEnd = offset + child.nodeSize;
      }
      offset += child.nodeSize;
    });

    expect(sdtEnd).not.toBeNull();
    expect(updatedState.selection.from).toBe(sdtEnd);
    expect(updatedState.selection.to).toBe(sdtEnd);
  });
});

describe('StructuredContent ID Validation', () => {
  let editor;

  beforeEach(() => {
    ({ editor } = initTestEditor({ mode: 'text', content: '<p></p>' }));
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  describe('insertStructuredContentInline', () => {
    it('accepts valid integer string IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentInline({
          attrs: { id: '123' },
          text: 'Test content',
        });
      }).not.toThrow();
    });

    it('accepts valid negative integer string IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentInline({
          attrs: { id: '-456' },
          text: 'Test content',
        });
      }).not.toThrow();
    });

    it('accepts numeric integer IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentInline({
          attrs: { id: 789 },
          text: 'Test content',
        });
      }).not.toThrow();
    });

    it('auto-generates ID when not provided', () => {
      expect(() => {
        editor.commands.insertStructuredContentInline({
          text: 'Test content',
        });
      }).not.toThrow();
    });

    it('throws error for non-integer string IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentInline({
          attrs: { id: 'abc-123' },
          text: 'Test content',
        });
      }).toThrow('Invalid structured content id - must be an integer, got: abc-123');
    });

    it('throws error for float IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentInline({
          attrs: { id: '123.45' },
          text: 'Test content',
        });
      }).toThrow('Invalid structured content id - must be an integer, got: 123.45');
    });

    it('throws error for UUID-style IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentInline({
          attrs: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          text: 'Test content',
        });
      }).toThrow('Invalid structured content id - must be an integer, got: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });
  });

  describe('insertStructuredContentBlock', () => {
    it('preserves preset image content when inserting an sdtLocked block', () => {
      const signatureSrc = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

      const didInsert = editor.commands.insertStructuredContentBlock({
        attrs: {
          id: '1299215856',
          tag: '{"fieldType":"signer"}',
          alias: 'Signature TEST',
          lockMode: 'sdtLocked',
        },
        json: {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src: signatureSrc,
                alt: 'Signature Example',
                size: { width: 200, height: 50 },
                wrap: { type: 'Inline' },
              },
            },
          ],
        },
      });

      expect(didInsert).toBe(true);

      const insertedBlock = findFirstNodeByType(editor.state.doc, 'structuredContentBlock');
      expect(insertedBlock).not.toBeNull();
      expect(insertedBlock.attrs).toMatchObject({
        id: '1299215856',
        alias: 'Signature TEST',
        lockMode: 'sdtLocked',
      });

      const insertedImage = findFirstNodeByType(insertedBlock, 'image');
      expect(insertedImage).not.toBeNull();
      expect(insertedImage.attrs).toMatchObject({
        src: expect.stringMatching(/^word\/media\/image-\d+\.svg$/),
        alt: 'Signature Example',
        size: { width: 200, height: 50 },
      });
      expect(editor.storage.image.media[insertedImage.attrs.src]).toBe(signatureSrc);
    });

    it('accepts valid integer string IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentBlock({
          attrs: { id: '123' },
          html: '<p>Test content</p>',
        });
      }).not.toThrow();
    });

    it('accepts valid negative integer string IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentBlock({
          attrs: { id: '-456' },
          html: '<p>Test content</p>',
        });
      }).not.toThrow();
    });

    it('auto-generates ID when not provided', () => {
      expect(() => {
        editor.commands.insertStructuredContentBlock({
          html: '<p>Test content</p>',
        });
      }).not.toThrow();
    });

    it('throws error for non-integer string IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentBlock({
          attrs: { id: 'my-block-id' },
          html: '<p>Test content</p>',
        });
      }).toThrow('Invalid structured content id - must be an integer, got: my-block-id');
    });

    it('throws error for float IDs', () => {
      expect(() => {
        editor.commands.insertStructuredContentBlock({
          attrs: { id: '99.99' },
          html: '<p>Test content</p>',
        });
      }).toThrow('Invalid structured content id - must be an integer, got: 99.99');
    });
  });
});
