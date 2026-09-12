import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-id'),
}));
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';

import { Extension } from '@core/Extension.js';
import { CommentsPlugin, CommentsPluginKey, __test__ } from './comments-plugin.js';
import { CommentMarkName } from './comments-constants.js';
import { TrackChangesBasePluginKey } from '../track-changes/plugins/index.js';
import { comments_module_events } from '@superdoc/common';
import * as CommentHelpers from './comments-helpers.js';
import { normalizeCommentEventPayload, updatePosition } from './helpers/index.js';
import { TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName } from '../track-changes/constants.js';

const {
  getActiveCommentId,
  findTrackedMark,
  handleTrackedChangeTransaction,
  getTrackedChangeText,
  createOrUpdateTrackedChangeComment,
  findRangeById,
} = __test__;

const createCommentSchema = () => {
  const nodes = {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: { group: 'inline' },
    tab: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      toDOM: () => ['span', { 'data-type': 'tab' }],
      parseDOM: [{ tag: 'span[data-type="tab"]' }],
    },
    commentRangeStart: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { 'w:id': {} },
      toDOM: (node) => ['commentRangeStart', node.attrs],
      parseDOM: [{ tag: 'commentRangeStart' }],
    },
    commentRangeEnd: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { 'w:id': {} },
      toDOM: (node) => ['commentRangeEnd', node.attrs],
      parseDOM: [{ tag: 'commentRangeEnd' }],
    },
  };

  const marks = {
    [CommentMarkName]: {
      attrs: { commentId: {}, importedId: { default: null }, internal: { default: true } },
      inclusive: false,
      toDOM: (mark) => [CommentMarkName, mark.attrs],
      parseDOM: [{ tag: CommentMarkName }],
    },
    [TrackInsertMarkName]: {
      attrs: { id: {}, author: { default: null }, authorEmail: { default: null }, date: { default: null } },
      inclusive: false,
      toDOM: (mark) => [TrackInsertMarkName, mark.attrs],
      parseDOM: [{ tag: TrackInsertMarkName }],
    },
    [TrackDeleteMarkName]: {
      attrs: { id: {}, author: { default: null }, authorEmail: { default: null }, date: { default: null } },
      inclusive: false,
      toDOM: (mark) => [TrackDeleteMarkName, mark.attrs],
      parseDOM: [{ tag: TrackDeleteMarkName }],
    },
    [TrackFormatMarkName]: {
      attrs: {
        id: {},
        author: { default: null },
        authorEmail: { default: null },
        date: { default: null },
        before: { default: [] },
        after: { default: [] },
      },
      inclusive: false,
      toDOM: (mark) => [TrackFormatMarkName, mark.attrs],
      parseDOM: [{ tag: TrackFormatMarkName }],
    },
    underline: {
      attrs: {},
      inclusive: false,
      toDOM: () => ['underline', 0],
      parseDOM: [{ tag: 'underline' }],
    },
    link: {
      attrs: {
        href: { default: null },
        text: { default: null },
      },
      inclusive: false,
      toDOM: (mark) => ['a', mark.attrs, 0],
      parseDOM: [{ tag: 'a' }],
    },
  };

  return new Schema({ nodes, marks });
};

const createEditorEnvironment = (schema, doc) => {
  const endPos = Math.min(doc.content.size, 2);
  const selection = endPos > 1 ? TextSelection.create(doc, 1, endPos) : TextSelection.create(doc, 1, 1);
  const baseState = EditorState.create({ schema, doc, selection });

  const view = {
    state: baseState,
    dispatch: vi.fn((tr) => {
      view.state = view.state.apply(tr);
    }),
    focus: vi.fn(),
  };

  const editor = {
    schema,
    view,
    emit: vi.fn(),
    options: {
      user: { name: 'Test User', email: 'test.user@example.com', image: 'https://example.com/avatar.png' },
      documentId: 'doc-1',
      isInternal: true,
    },
    setOptions: vi.fn(),
  };

  Object.defineProperty(editor, 'state', {
    get() {
      return view.state;
    },
  });

  const extension = Extension.create(CommentsPlugin.config);
  extension.addCommands = CommentsPlugin.config.addCommands.bind(extension);
  extension.addPmPlugins = CommentsPlugin.config.addPmPlugins.bind(extension);
  extension.editor = editor;

  return { editor, commands: extension.addCommands(), view, extension };
};

describe('CommentsPlugin commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new comment marks with metadata', () => {
    const schema = createCommentSchema();
    const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands, view } = createEditorEnvironment(schema, doc);

    let currentState = editor.state;
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
      view.state = currentState;
    });

    const command = commands.insertComment({ commentId: 'c-1', isInternal: true, text: '<p>Hello</p>' });
    const tr = currentState.tr;
    const result = command({ tr, state: currentState, dispatch });

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    const dispatchedTr = dispatch.mock.calls[0][0];
    expect(dispatchedTr.getMeta(CommentsPluginKey)).toMatchObject({ event: 'add' });

    expect(editor.emit).toHaveBeenCalledWith(
      'commentsUpdate',
      expect.objectContaining({
        type: comments_module_events.ADD,
        comment: expect.objectContaining({
          commentId: 'c-1',
          isInternal: true,
          commentText: '<p>Hello</p>',
          creatorName: 'Test User',
          creatorEmail: 'test.user@example.com',
          creatorImage: 'https://example.com/avatar.png',
          fileId: 'doc-1',
        }),
        activeCommentId: 'c-1',
      }),
    );

    const applied = currentState;
    const mark = applied.doc.nodeAt(1)?.marks.find((m) => m.type === schema.marks[CommentMarkName]);
    expect(mark?.attrs).toMatchObject({ commentId: 'c-1', internal: true });
  });

  it('skips emitting events when skipEmit flag is provided', () => {
    const schema = createCommentSchema();
    const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands, view } = createEditorEnvironment(schema, doc);

    let currentState = editor.state;
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
      view.state = currentState;
    });

    const command = commands.insertComment({ commentId: 'c-2', isInternal: false, skipEmit: true });
    const tr = currentState.tr;
    const result = command({ tr, state: currentState, dispatch });

    expect(result).toBe(true);
    expect(editor.emit).not.toHaveBeenCalled();

    const applied = currentState;
    const mark = applied.doc.nodeAt(1)?.marks.find((m) => m.type === schema.marks[CommentMarkName]);
    expect(mark?.attrs).toMatchObject({ commentId: 'c-2', internal: false });
  });

  it('assigns generated id and defaults isInternal to false when omitted', () => {
    const schema = createCommentSchema();
    const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands, view } = createEditorEnvironment(schema, doc);

    let currentState = editor.state;
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
      view.state = currentState;
    });

    const command = commands.insertComment({ text: '<p>Body</p>' });
    const tr = currentState.tr;
    const result = command({ tr, state: currentState, dispatch });

    expect(result).toBe(true);
    const event = editor.emit.mock.calls[0][1];
    expect(event.comment.commentId).toBe('generated-id');
    expect(event.comment.isInternal).toBe(false);
    const mark = currentState.doc.nodeAt(1)?.marks.find((m) => m.type === schema.marks[CommentMarkName]);
    expect(mark?.attrs.commentId).toBe('generated-id');
    expect(mark?.attrs.internal).toBe(false);
  });

  it('removes comment marks via helper when removing a comment', () => {
    const schema = createCommentSchema();
    const mark = schema.marks[CommentMarkName].create({ commentId: 'c-3', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [mark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { commands, view } = createEditorEnvironment(schema, doc);

    let currentState = view.state;
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
      view.state = currentState;
    });

    const spy = vi.spyOn(CommentHelpers, 'removeCommentsById');

    const command = commands.removeComment({ commentId: 'c-3' });
    const tr = currentState.tr;
    command({ tr, dispatch, state: currentState });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'c-3' }));
    expect(tr.getMeta(CommentsPluginKey)).toMatchObject({ event: 'deleted' });

    spy.mockRestore();
  });

  it('resolves comment via helper and marks update event', () => {
    const schema = createCommentSchema();
    const mark = schema.marks[CommentMarkName].create({ commentId: 'c-4', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [mark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { commands, view } = createEditorEnvironment(schema, doc);

    let currentState = view.state;
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
      view.state = currentState;
    });

    const spy = vi.spyOn(CommentHelpers, 'resolveCommentById');

    const command = commands.resolveComment({ commentId: 'c-4' });
    const tr = currentState.tr;
    command({ tr, dispatch, state: currentState });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'c-4' }));
    expect(tr.getMeta(CommentsPluginKey)).toMatchObject({ event: 'update' });

    spy.mockRestore();
  });

  it('sets active comment metadata when command is invoked', () => {
    const schema = createCommentSchema();
    const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
    const doc = schema.node('doc', null, [paragraph]);
    const { commands } = createEditorEnvironment(schema, doc);

    const tr = { setMeta: vi.fn() };
    const command = commands.setActiveComment({ commentId: 'focus-id' });
    const result = command({ tr });

    expect(result).toBe(true);
    expect(tr.setMeta).toHaveBeenCalledWith(CommentsPluginKey, {
      type: 'setActiveComment',
      activeThreadId: 'focus-id',
      forceUpdate: true,
    });
  });

  it('updates comment internals when toggled', () => {
    const schema = createCommentSchema();
    const mark = schema.marks[CommentMarkName].create({ commentId: 'c-42', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [mark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands, view } = createEditorEnvironment(schema, doc);

    let currentState = editor.state;
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
      view.state = currentState;
    });

    const command = commands.setCommentInternal({ commentId: 'c-42', isInternal: false });
    const tr = currentState.tr;
    const result = command({ tr, state: currentState, dispatch });

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    const dispatchedTr = dispatch.mock.calls[0][0];
    expect(dispatchedTr.getMeta(CommentsPluginKey)).toMatchObject({ type: 'setCommentInternal' });

    const updatedMark = currentState.doc.nodeAt(1)?.marks.find((m) => m.type === schema.marks[CommentMarkName]);
    expect(updatedMark?.attrs.internal).toBe(false);
  });

  it('supports moveComment capability checks when dispatch is undefined', () => {
    const schema = createCommentSchema();
    const mark = schema.marks[CommentMarkName].create({ commentId: 'c-move', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [mark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands } = createEditorEnvironment(schema, doc);

    const command = commands.moveComment({ commentId: 'c-move', from: 2, to: 4 });

    let result;
    expect(() => {
      result = command({ tr: editor.state.tr, dispatch: undefined, state: editor.state, editor });
    }).not.toThrow();
    expect(result).toBe(true);
  });

  it('returns false (without throwing) when moveComment targets an out-of-bounds range', () => {
    const schema = createCommentSchema();
    const mark = schema.marks[CommentMarkName].create({ commentId: 'c-oob', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [mark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands, view } = createEditorEnvironment(schema, doc);

    let currentState = editor.state;
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
      view.state = currentState;
    });

    const command = commands.moveComment({
      commentId: 'c-oob',
      from: doc.content.size + 5,
      to: doc.content.size + 8,
    });

    let result;
    expect(() => {
      result = command({ tr: currentState.tr, dispatch, state: currentState, editor });
    }).not.toThrow();
    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('focuses editor when moving the cursor to a comment by id', () => {
    const schema = createCommentSchema();
    const mark = schema.marks[CommentMarkName].create({ commentId: 'c-10', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [mark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands } = createEditorEnvironment(schema, doc);

    const result = commands.setCursorById('c-10')({ state: editor.state, editor });

    expect(result).toBe(true);
    expect(editor.view.focus).toHaveBeenCalled();
  });

  it('returns false when attempting to set cursor by unknown id', () => {
    const schema = createCommentSchema();
    const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands } = createEditorEnvironment(schema, doc);

    const result = commands.setCursorById('missing')({ state: editor.state, editor });

    expect(result).toBe(false);
    expect(editor.view.focus).not.toHaveBeenCalled();
  });

  it('sets the active thread without focusing the hidden view when requested', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'c-10', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { commands } = createEditorEnvironment(schema, doc);

    const tr = {
      setSelection: vi.fn(),
      setMeta: vi.fn(),
    };
    const editor = {
      view: { focus: vi.fn() },
    };

    const result = commands.setCursorById('c-10', { activeCommentId: 'thread-1' })({ state: { doc, tr }, editor });

    expect(result).toBe(true);
    expect(tr.setSelection).toHaveBeenCalled();
    expect(tr.setMeta).toHaveBeenCalledWith(
      CommentsPluginKey,
      expect.objectContaining({
        type: 'setActiveComment',
        activeThreadId: 'thread-1',
        forceUpdate: true,
      }),
    );
    expect(editor.view.focus).not.toHaveBeenCalled();
  });

  describe('addCommentReply', () => {
    it('emits commentsUpdate event with parentCommentId', () => {
      const schema = createCommentSchema();
      const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
      const doc = schema.node('doc', null, [paragraph]);
      const { editor, commands } = createEditorEnvironment(schema, doc);

      const command = commands.addCommentReply({
        parentId: 'parent-123',
        content: 'This is a reply',
      });
      const result = command({ editor });

      expect(result).toBe(true);
      expect(editor.emit).toHaveBeenCalledWith(
        'commentsUpdate',
        expect.objectContaining({
          type: comments_module_events.ADD,
          comment: expect.objectContaining({
            commentId: 'generated-id',
            parentCommentId: 'parent-123',
            commentText: 'This is a reply',
            creatorName: 'Test User',
            creatorEmail: 'test.user@example.com',
            creatorImage: 'https://example.com/avatar.png',
          }),
          activeCommentId: 'generated-id',
        }),
      );
    });

    it('uses provided author fields instead of editor config', () => {
      const schema = createCommentSchema();
      const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
      const doc = schema.node('doc', null, [paragraph]);
      const { editor, commands } = createEditorEnvironment(schema, doc);

      const command = commands.addCommentReply({
        parentId: 'parent-456',
        content: 'Custom author reply',
        author: 'Custom Author',
        authorEmail: 'custom@example.com',
        authorImage: 'https://example.com/custom.png',
      });
      const result = command({ editor });

      expect(result).toBe(true);
      expect(editor.emit).toHaveBeenCalledWith(
        'commentsUpdate',
        expect.objectContaining({
          comment: expect.objectContaining({
            parentCommentId: 'parent-456',
            creatorName: 'Custom Author',
            creatorEmail: 'custom@example.com',
            creatorImage: 'https://example.com/custom.png',
          }),
        }),
      );
    });

    it('returns false and warns when parentId is missing', () => {
      const schema = createCommentSchema();
      const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
      const doc = schema.node('doc', null, [paragraph]);
      const { editor, commands } = createEditorEnvironment(schema, doc);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const command = commands.addCommentReply({ content: 'No parent' });
      const result = command({ editor });

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith('addCommentReply requires a parentId');
      expect(editor.emit).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('falls back to editor config user when author fields not provided', () => {
      const schema = createCommentSchema();
      const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
      const doc = schema.node('doc', null, [paragraph]);
      const { editor, commands } = createEditorEnvironment(schema, doc);

      const command = commands.addCommentReply({
        parentId: 'parent-789',
        content: 'Reply with default user',
      });
      command({ editor });

      expect(editor.emit).toHaveBeenCalledWith(
        'commentsUpdate',
        expect.objectContaining({
          comment: expect.objectContaining({
            creatorName: 'Test User',
            creatorEmail: 'test.user@example.com',
            creatorImage: 'https://example.com/avatar.png',
          }),
        }),
      );
    });

    it('handles empty editor options gracefully', () => {
      const schema = createCommentSchema();
      const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
      const doc = schema.node('doc', null, [paragraph]);
      const { editor, commands } = createEditorEnvironment(schema, doc);

      // Clear user from editor options
      editor.options.user = undefined;

      const command = commands.addCommentReply({
        parentId: 'parent-no-user',
        content: 'Reply without user config',
      });
      const result = command({ editor });

      expect(result).toBe(true);
      expect(editor.emit).toHaveBeenCalledWith(
        'commentsUpdate',
        expect.objectContaining({
          comment: expect.objectContaining({
            parentCommentId: 'parent-no-user',
            commentText: 'Reply without user config',
          }),
        }),
      );
    });
  });

  it('findRangeById finds resolved comment via commentRangeStart/End nodes', () => {
    const schema = createCommentSchema();
    const startNode = schema.nodes.commentRangeStart.create({ 'w:id': 'resolved-1' });
    const endNode = schema.nodes.commentRangeEnd.create({ 'w:id': 'resolved-1' });
    const paragraph = schema.node('paragraph', null, [startNode, schema.text('Commented text'), endNode]);
    const doc = schema.node('doc', null, [paragraph]);

    const result = findRangeById(doc, 'resolved-1');

    expect(result).not.toBeNull();
    expect(result.from).toBe(1); // position of commentRangeStart
    expect(result.to).toBe(16); // position of commentRangeEnd
  });

  it('findRangeById returns null when commentRangeStart/End nodes have different ids', () => {
    const schema = createCommentSchema();
    const startNode = schema.nodes.commentRangeStart.create({ 'w:id': 'comment-1' });
    const endNode = schema.nodes.commentRangeEnd.create({ 'w:id': 'comment-2' });
    const paragraph = schema.node('paragraph', null, [startNode, schema.text('Commented text'), endNode]);
    const doc = schema.node('doc', null, [paragraph]);

    const result = findRangeById(doc, 'comment-1');

    expect(result).toBeNull(); // Only found start, not end
  });

  it('focuses editor when moving cursor to resolved comment by id via nodes', () => {
    const schema = createCommentSchema();
    const startNode = schema.nodes.commentRangeStart.create({ 'w:id': 'resolved-1' });
    const endNode = schema.nodes.commentRangeEnd.create({ 'w:id': 'resolved-1' });
    const paragraph = schema.node('paragraph', null, [startNode, schema.text('Commented text'), endNode]);
    const doc = schema.node('doc', null, [paragraph]);
    const { editor, commands } = createEditorEnvironment(schema, doc);

    const result = commands.setCursorById('resolved-1')({ state: editor.state, editor });

    expect(result).toBe(true);
    expect(editor.view.focus).toHaveBeenCalled();
  });
});

const createPluginStateEnvironment = ({ schema: providedSchema, doc: providedDoc } = {}) => {
  const schema = providedSchema ?? createCommentSchema();
  const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
  const doc = providedDoc ?? schema.node('doc', null, [paragraph]);
  const selection = TextSelection.create(doc, 1);

  let state = EditorState.create({ schema, doc, selection });

  const editor = {
    options: { documentId: 'doc-1' },
    emit: vi.fn(),
    view: null,
  };

  const extension = Extension.create(CommentsPlugin.config);
  extension.addCommands = CommentsPlugin.config.addCommands.bind(extension);
  extension.addPmPlugins = CommentsPlugin.config.addPmPlugins.bind(extension);
  extension.editor = editor;
  const [plugin] = extension.addPmPlugins();

  state = EditorState.create({ schema, doc, selection, plugins: [plugin] });

  const view = {
    state,
    dispatch: vi.fn((tr) => {
      state = state.apply(tr);
      view.state = state;
    }),
    focus: vi.fn(),
  };

  editor.view = view;
  Object.defineProperty(editor, 'state', {
    get() {
      return view.state;
    },
  });
  const pluginView = plugin.spec.view?.(view);

  return { plugin, editor, view, schema, pluginView };
};

describe('CommentsPlugin state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates active thread and emits events when setActiveComment meta is applied', () => {
    const { view, editor } = createPluginStateEnvironment();

    const tr = view.state.tr.setMeta(CommentsPluginKey, {
      type: 'setActiveComment',
      activeThreadId: 'thread-1',
      forceUpdate: true,
    });

    view.dispatch(tr);

    const pluginState = CommentsPluginKey.getState(view.state);
    expect(pluginState.activeThreadId).toBe('thread-1');
  });

  describe('deferred selected events', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const setActiveComment = (view, activeThreadId) => {
      view.dispatch(
        view.state.tr.setMeta(CommentsPluginKey, {
          type: 'setActiveComment',
          activeThreadId,
          forceUpdate: true,
        }),
      );
    };

    it('only emits the final active thread when several activations are scheduled together', () => {
      const { view, editor } = createPluginStateEnvironment();

      setActiveComment(view, 'comment-1');
      setActiveComment(view, 'comment-2');
      setActiveComment(view, 'comment-3');

      expect(editor.emit).not.toHaveBeenCalled();
      expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('comment-3');

      vi.runAllTimers();

      expect(editor.emit).toHaveBeenCalledTimes(1);
      expect(editor.emit).toHaveBeenCalledWith('commentsUpdate', {
        type: comments_module_events.SELECTED,
        activeCommentId: 'comment-3',
      });
      expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('comment-3');
    });

    it('drops a stale activation when a clear is scheduled after it', () => {
      const { view, editor } = createPluginStateEnvironment();

      setActiveComment(view, 'comment-1');
      setActiveComment(view, null);

      vi.runAllTimers();

      expect(editor.emit).toHaveBeenCalledTimes(1);
      expect(editor.emit).toHaveBeenCalledWith('commentsUpdate', {
        type: comments_module_events.SELECTED,
        activeCommentId: null,
      });
      expect(CommentsPluginKey.getState(view.state).activeThreadId).toBeNull();
    });

    it('drops a stale clear when a new activation is scheduled after it', () => {
      const { view, editor } = createPluginStateEnvironment();

      setActiveComment(view, 'comment-1');
      vi.runAllTimers();
      editor.emit.mockClear();

      setActiveComment(view, null);
      setActiveComment(view, 'comment-2');

      vi.runAllTimers();

      expect(editor.emit).toHaveBeenCalledTimes(1);
      expect(editor.emit).toHaveBeenCalledWith('commentsUpdate', {
        type: comments_module_events.SELECTED,
        activeCommentId: 'comment-2',
      });
      expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('comment-2');
    });

    it('emits the reverted thread once when an activation burst returns to the original id', () => {
      const { view, editor } = createPluginStateEnvironment();

      setActiveComment(view, 'comment-1');
      setActiveComment(view, 'comment-2');
      setActiveComment(view, 'comment-1');

      vi.runAllTimers();

      expect(editor.emit).toHaveBeenCalledTimes(1);
      expect(editor.emit).toHaveBeenCalledWith('commentsUpdate', {
        type: comments_module_events.SELECTED,
        activeCommentId: 'comment-1',
      });
      expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('comment-1');
    });

    it('does not schedule a notification when the active thread is reasserted', () => {
      const { view, editor } = createPluginStateEnvironment();

      setActiveComment(view, 'comment-1');
      vi.runAllTimers();
      editor.emit.mockClear();

      setActiveComment(view, 'comment-1');
      vi.runAllTimers();

      expect(editor.emit).not.toHaveBeenCalled();
    });

    it('settles when the selected event is echoed back to the plugin', () => {
      const { view, editor } = createPluginStateEnvironment();

      editor.emit.mockImplementation((event, update) => {
        if (event === 'commentsUpdate' && update.type === comments_module_events.SELECTED) {
          setActiveComment(view, update.activeCommentId);
        }
      });

      setActiveComment(view, 'comment-1');
      setActiveComment(view, 'comment-2');
      setActiveComment(view, 'comment-3');

      vi.runAllTimers();

      expect(editor.emit).toHaveBeenCalledTimes(1);
      expect(editor.emit).toHaveBeenCalledWith('commentsUpdate', {
        type: comments_module_events.SELECTED,
        activeCommentId: 'comment-3',
      });
      expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('comment-3');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not emit when the editor is destroyed before a deferred notification runs', () => {
      const { view, editor } = createPluginStateEnvironment();

      setActiveComment(view, 'comment-1');
      editor.isDestroyed = true;

      expect(() => vi.runAllTimers()).not.toThrow();
      expect(editor.emit).not.toHaveBeenCalled();
    });
  });

  it('stores decorations provided through metadata', () => {
    const { view } = createPluginStateEnvironment();
    const decorations = DecorationSet.create(view.state.doc, []);

    const tr = view.state.tr.setMeta(CommentsPluginKey, {
      decorations,
      allCommentPositions: { thread: { start: 1, end: 2 } },
    });

    view.dispatch(tr);

    const pluginState = CommentsPluginKey.getState(view.state);
    expect(pluginState.decorations).toBe(decorations);
    expect(pluginState.allCommentPositions).toEqual({ thread: { start: 1, end: 2 } });
  });

  it('collects tracked change metadata and emits updates', () => {
    const { view, editor } = createPluginStateEnvironment();
    const trackedMark = {
      attrs: { id: 'change-1', author: 'A', authorEmail: 'a@example.com', date: 'now' },
      type: { name: 'trackInsert' },
    };

    const tr = view.state.tr.setMeta(TrackChangesBasePluginKey, {
      insertedMark: trackedMark,
      deletionMark: null,
      formatMark: null,
      deletionNodes: [],
      step: { slice: { content: { content: [view.state.doc.firstChild] } } },
    });

    view.dispatch(tr);

    const pluginState = CommentsPluginKey.getState(view.state);
    expect(pluginState.trackedChanges['change-1']).toBeDefined();
  });

  // Regression test: ensures comment positions are emitted on initial load even when
  // the first update only changes the active thread (without document changes).
  // Previously, positions would not emit until a subsequent document change occurred.
  it('emits comment positions when the first update only changes the active thread', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'thread-1', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark])]);
    const doc = schema.node('doc', null, [paragraph]);

    const { view, editor, pluginView } = createPluginStateEnvironment({ schema, doc });
    expect(pluginView).toBeDefined();

    const forceTr = view.state.tr.setMeta(CommentsPluginKey, { type: 'force' });
    view.dispatch(forceTr);

    view.coordsAtPos = vi.fn(() => ({ top: 10, left: 20 }));

    pluginView.update(view);

    expect(view.coordsAtPos).toHaveBeenCalled();
    expect(editor.emit).toHaveBeenCalledWith(
      'comment-positions',
      expect.objectContaining({
        allCommentPositions: expect.objectContaining({
          'thread-1': expect.objectContaining({
            bounds: expect.objectContaining({ top: 10, left: 20 }),
          }),
        }),
      }),
    );
  });

  it('preserves the preferred tracked-change thread when cursor lands on overlapping comment text', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'comment-1', internal: true });
    const trackedMark = schema.marks[TrackInsertMarkName].create({ id: 'tracked-1' });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark, trackedMark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { view } = createPluginStateEnvironment({ schema, doc });

    const tr = view.state.tr
      .setSelection(TextSelection.create(doc, 2))
      .setMeta(CommentsPluginKey, { type: 'setCursorById', preferredActiveThreadId: 'tracked-1' });

    view.dispatch(tr);

    const pluginState = CommentsPluginKey.getState(view.state);
    expect(pluginState.activeThreadId).toBe('tracked-1');
  });
});

describe('normalizeCommentEventPayload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fills missing fields from editor options and fallback values', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234);

    const payload = normalizeCommentEventPayload({
      conversation: { text: '<p>Body</p>', skipEmit: true },
      editorOptions: {
        user: { name: 'Payload User', email: 'payload@example.com' },
        documentId: 'doc-42',
      },
      fallbackCommentId: 'fallback-id',
      fallbackInternal: false,
    });

    expect(payload).toEqual(
      expect.objectContaining({
        commentId: 'fallback-id',
        isInternal: false,
        commentText: '<p>Body</p>',
        creatorName: 'Payload User',
        creatorEmail: 'payload@example.com',
        fileId: 'doc-42',
        documentId: 'doc-42',
        createdTime: 1234,
      }),
    );
    expect(payload).not.toHaveProperty('skipEmit');
    expect(payload).not.toHaveProperty('text');

    nowSpy.mockRestore();
  });

  it('respects provided fields over inferred defaults', () => {
    const payload = normalizeCommentEventPayload({
      conversation: {
        commentId: 'provided',
        creatorName: 'Provided User',
        creatorEmail: 'provided@example.com',
        commentText: '<p>Existing</p>',
        isInternal: true,
      },
      editorOptions: { user: { name: 'Fallback', email: 'fallback@example.com' }, documentId: 'doc-99' },
      fallbackCommentId: 'fallback',
      fallbackInternal: false,
    });

    expect(payload).toEqual(
      expect.objectContaining({
        commentId: 'provided',
        creatorName: 'Provided User',
        creatorEmail: 'provided@example.com',
        commentText: '<p>Existing</p>',
        isInternal: true,
      }),
    );
  });
});

describe('updatePosition', () => {
  let originalDOMRect;

  beforeEach(() => {
    originalDOMRect = global.DOMRect;
    if (!originalDOMRect) {
      global.DOMRect = class {
        constructor(left, top, width = 0, height = 0) {
          this.left = left;
          this.top = top;
          this.right = left + width;
          this.bottom = top + height;
        }
      };
    }
  });

  afterEach(() => {
    if (!originalDOMRect) {
      delete global.DOMRect;
    } else {
      global.DOMRect = originalDOMRect;
    }
  });

  it('records a new thread entry using DOMRect bounds', () => {
    const allPositions = {};
    const rect = new DOMRect(20, 10, 30, 40);

    updatePosition({
      allCommentPositions: allPositions,
      threadId: 'thread-1',
      pos: 5,
      currentBounds: rect,
      node: { nodeSize: 4 },
    });

    expect(allPositions['thread-1']).toEqual(
      expect.objectContaining({
        threadId: 'thread-1',
        start: 5,
        end: 9,
        bounds: expect.objectContaining({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }),
      }),
    );
  });

  it('extends an existing thread entry while preserving outer bounds', () => {
    const allPositions = {
      'thread-1': {
        threadId: 'thread-1',
        start: 5,
        end: 9,
        bounds: { top: 20, bottom: 30, left: 10, right: 40 },
      },
    };

    updatePosition({
      allCommentPositions: allPositions,
      threadId: 'thread-1',
      pos: 3,
      currentBounds: { top: 15, bottom: 35, left: 8, right: 42 },
      node: { nodeSize: 10 },
    });

    expect(allPositions['thread-1']).toEqual({
      threadId: 'thread-1',
      start: 3,
      end: 13,
      bounds: expect.objectContaining({ top: 15, bottom: 35 }),
    });
  });
});

describe('internal helper functions', () => {
  it('getActiveCommentId returns the nearest comment mark id', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'comment-123', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const selection = TextSelection.create(doc, 1);
    expect(getActiveCommentId(doc, selection)).toBe('comment-123');
  });

  it('getActiveCommentId returns tracked change id when present', () => {
    const schema = createCommentSchema();
    const trackMark = schema.marks[TrackInsertMarkName].create({ id: 'change-abc' });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [trackMark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const selection = TextSelection.create(doc, 1);
    expect(getActiveCommentId(doc, selection)).toBe('change-abc');
  });

  it('getActiveCommentId ignores non-collapsed selections', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'comment-456' });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const selection = TextSelection.create(doc, 1, 2);
    expect(getActiveCommentId(doc, selection)).toBeUndefined();
  });

  it('findTrackedMark locates the first tracked change mark in range', () => {
    const schema = createCommentSchema();
    const trackMark = schema.marks[TrackInsertMarkName].create({ id: 'tracked-1' });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [trackMark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const found = findTrackedMark({ doc, from: 1, to: 1 });
    expect(found?.mark?.attrs.id).toBe('tracked-1');
  });

  it('findTrackedMark returns undefined when no mark exists', () => {
    const schema = createCommentSchema();
    const paragraph = schema.node('paragraph', null, [schema.text('Hello')]);
    const doc = schema.node('doc', null, [paragraph]);
    const found = findTrackedMark({ doc, from: 1, to: 1 });
    expect(found).toBeUndefined();
  });

  it('handleTrackedChangeTransaction emits add and update events', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'change-tracked',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      date: 'today',
    });
    const textNode = schema.text('Inserted', [insertMark]);
    const paragraph = schema.node('paragraph', null, [textNode]);
    const doc = schema.node('doc', null, [paragraph]);
    const state = EditorState.create({ schema, doc });
    const editor = { options: { documentId: 'doc-1' }, emit: vi.fn() };

    const meta = {
      insertedMark: insertMark,
      deletionMark: null,
      formatMark: null,
      deletionNodes: [],
      step: { slice: { content: { content: [textNode] } } },
    };

    const first = handleTrackedChangeTransaction(meta, {}, state, editor);
    expect(first['change-tracked']).toMatchObject({ insertion: 'change-tracked' });
    expect(editor.emit).toHaveBeenCalledWith(
      'commentsUpdate',
      expect.objectContaining({ event: comments_module_events.ADD, changeId: 'change-tracked' }),
    );

    editor.emit.mockClear();
    const second = handleTrackedChangeTransaction(meta, first, state, editor);
    expect(second['change-tracked']).toBeDefined();
    expect(editor.emit).toHaveBeenCalledWith(
      'commentsUpdate',
      expect.objectContaining({ event: comments_module_events.UPDATE, changeId: 'change-tracked' }),
    );
  });

  it('handleTrackedChangeTransaction emits event for deletion-only tracked changes when step nodes are empty', () => {
    const schema = createCommentSchema();
    const deleteMark = schema.marks[TrackDeleteMarkName].create({
      id: 'change-delete-only',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      date: 'today',
    });
    const deletedNode = schema.text('Removed', [deleteMark]);
    const paragraph = schema.node('paragraph', null, [deletedNode]);
    const doc = schema.node('doc', null, [paragraph]);
    const state = EditorState.create({ schema, doc });
    const editor = { options: { documentId: 'doc-1' }, emit: vi.fn() };

    const meta = {
      insertedMark: null,
      deletionMark: deleteMark,
      formatMark: null,
      deletionNodes: [deletedNode],
      step: { slice: { content: { content: [] } } },
    };

    const trackedChanges = handleTrackedChangeTransaction(meta, {}, state, editor);

    expect(trackedChanges['change-delete-only']).toMatchObject({ deletion: 'change-delete-only' });
    expect(editor.emit).toHaveBeenCalledWith(
      'commentsUpdate',
      expect.objectContaining({ event: comments_module_events.ADD, changeId: 'change-delete-only' }),
    );
  });

  it('handleTrackedChangeTransaction emits separate events for independent replacements', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'change-insert-only',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      date: 'today',
    });
    const deleteMark = schema.marks[TrackDeleteMarkName].create({
      id: 'change-delete-only',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      date: 'today',
    });

    const deletedNode = schema.text('Removed', [deleteMark]);
    const insertedNode = schema.text('Added', [insertMark]);
    const paragraph = schema.node('paragraph', null, [deletedNode, insertedNode]);
    const doc = schema.node('doc', null, [paragraph]);
    const state = EditorState.create({ schema, doc });
    const editor = { options: { documentId: 'doc-1' }, emit: vi.fn() };

    const meta = {
      insertedMark: insertMark,
      deletionMark: deleteMark,
      formatMark: null,
      deletionNodes: [deletedNode],
      step: { slice: { content: { content: [insertedNode] } } },
    };

    const trackedChanges = handleTrackedChangeTransaction(meta, {}, state, editor);

    expect(trackedChanges['change-insert-only']).toMatchObject({ insertion: 'change-insert-only' });
    expect(trackedChanges['change-delete-only']).toMatchObject({ deletion: 'change-delete-only' });
    expect(editor.emit).toHaveBeenCalledTimes(2);
    expect(editor.emit).toHaveBeenNthCalledWith(
      1,
      'commentsUpdate',
      expect.objectContaining({
        event: comments_module_events.ADD,
        changeId: 'change-insert-only',
        trackedChangeType: TrackInsertMarkName,
        trackedChangeText: 'Added',
        deletedText: null,
      }),
    );
    expect(editor.emit).toHaveBeenNthCalledWith(
      2,
      'commentsUpdate',
      expect.objectContaining({
        event: comments_module_events.ADD,
        changeId: 'change-delete-only',
        trackedChangeType: TrackDeleteMarkName,
        trackedChangeText: '',
        deletedText: 'Removed',
      }),
    );
  });

  it('handleTrackedChangeTransaction returns original state when no marks provided', () => {
    const schema = createCommentSchema();
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Text')])]);
    const state = EditorState.create({ schema, doc });
    const editor = { options: { documentId: 'doc-1' }, emit: vi.fn() };

    const result = handleTrackedChangeTransaction({ deletionNodes: [] }, { existing: 'value' }, state, editor);
    expect(result).toBeUndefined();
    expect(editor.emit).not.toHaveBeenCalled();
  });

  it('getTrackedChangeText extracts insertion, deletion, and format strings', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({ id: 'insert-1' });
    const deleteMark = schema.marks[TrackDeleteMarkName].create({ id: 'delete-1' });
    const formatMark = schema.marks[TrackFormatMarkName].create({
      id: 'format-1',
      before: [{ type: 'bold' }],
      after: [{ type: 'italic' }],
    });

    const insertionNodes = [schema.text('Added', [insertMark])];
    const deletionNodes = [schema.text('Removed', [deleteMark])];

    const insertionResult = getTrackedChangeText({
      nodes: insertionNodes,
      mark: insertMark,
      trackedChangeType: TrackInsertMarkName,
      isReplacement: false,
    });
    expect(insertionResult.trackedChangeText).toBe('Added');
    expect(insertionResult.deletionText).toBe('');

    const deletionResult = getTrackedChangeText({
      nodes: deletionNodes,
      mark: deleteMark,
      trackedChangeType: TrackDeleteMarkName,
      isReplacement: false,
    });
    expect(deletionResult.deletionText).toBe('Removed');

    const formatResult = getTrackedChangeText({
      nodes: [schema.text('Format', [formatMark])],
      mark: formatMark,
      trackedChangeType: TrackFormatMarkName,
      isReplacement: false,
    });
    expect(formatResult.trackedChangeText).toBe('italic, removed bold');
    expect(formatResult.trackedChangeDisplayType).toBeNull();

    const deltaFormatMark = schema.marks[TrackFormatMarkName].create({
      id: 'format-2',
      before: [{ type: 'textStyle', attrs: { color: '#111111', fontSize: '12px' } }],
      after: [{ type: 'bold', attrs: {} }],
    });
    const deltaFormatResult = getTrackedChangeText({
      nodes: [schema.text('Format', [deltaFormatMark])],
      mark: deltaFormatMark,
      trackedChangeType: TrackFormatMarkName,
      isReplacement: false,
    });
    expect(deltaFormatResult.trackedChangeText).toContain('bold');
    expect(deltaFormatResult.trackedChangeText).not.toContain('undefined');

    const hyperlinkFormatMark = schema.marks[TrackFormatMarkName].create({
      id: 'format-3',
      before: [],
      after: [
        { type: 'underline', attrs: {} },
        { type: 'link', attrs: { href: 'https://example.com', text: 'website' } },
      ],
    });
    const hyperlinkFormatResult = getTrackedChangeText({
      nodes: [schema.text('website', [hyperlinkFormatMark, schema.marks.link.create({ href: 'https://example.com' })])],
      mark: hyperlinkFormatMark,
      trackedChangeType: TrackFormatMarkName,
      isReplacement: false,
    });
    expect(hyperlinkFormatResult).toMatchObject({
      trackedChangeText: 'https://example.com',
      trackedChangeDisplayType: 'hyperlinkAdded',
    });

    const combinedResult = getTrackedChangeText({
      nodes: [...insertionNodes, ...deletionNodes],
      mark: insertMark,
      trackedChangeType: TrackInsertMarkName,
      isReplacement: true,
    });
    expect(combinedResult.deletionText).toBe('Removed');
  });

  it('surfaces tracked tab nodes as a literal tab in comment text (SD-3376)', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({ id: 'insert-tab' });
    const deleteMark = schema.marks[TrackDeleteMarkName].create({ id: 'delete-tab' });
    // Tab is an inline atom with no `.text`/`.textContent`; the comment text
    // builder keys off `node.type.name === 'tab'`.
    const insertTabNode = { type: { name: 'tab' }, marks: [insertMark] };
    const deleteTabNode = { type: { name: 'tab' }, marks: [deleteMark] };

    const insertResult = getTrackedChangeText({
      nodes: [schema.text('A', [insertMark]), insertTabNode, schema.text('B', [insertMark])],
      mark: insertMark,
      trackedChangeType: TrackInsertMarkName,
      isReplacement: false,
    });
    expect(insertResult.trackedChangeText).toBe('A\tB');

    const deleteResult = getTrackedChangeText({
      nodes: [schema.text('A', [deleteMark]), deleteTabNode, schema.text('B', [deleteMark])],
      mark: deleteMark,
      trackedChangeType: TrackDeleteMarkName,
      isReplacement: false,
    });
    expect(deleteResult.deletionText).toBe('A\tB');
  });

  it('creates a comment payload for a tab-only tracked change found during live-document rebuild', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'tab-only-change',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });
    const tabNode = schema.nodes.tab.create(null, null, [insertMark]);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [tabNode])]);
    const state = EditorState.create({ schema, doc });

    const payload = createOrUpdateTrackedChangeComment({
      event: 'add',
      marks: { insertedMark: insertMark, deletionMark: null, formatMark: null },
      deletionNodes: [],
      nodes: [],
      newEditorState: state,
      documentId: 'doc-1',
      trackedChangesForId: [{ mark: insertMark, from: 1, to: doc.content.size }],
    });

    expect(payload).toMatchObject({
      event: comments_module_events.ADD,
      changeId: 'tab-only-change',
      trackedChangeType: TrackInsertMarkName,
      trackedChangeText: '\t',
      deletedText: null,
    });
  });

  it('does not duplicate replacement text when creating tracked change comments', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'replace-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });
    const deleteMark = schema.marks[TrackDeleteMarkName].create({
      id: 'replace-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });

    const docInsertNode = schema.text('replacement', [insertMark]);
    const docDeleteNode = schema.text('original', [deleteMark]);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [docInsertNode, docDeleteNode])]);
    const state = EditorState.create({ schema, doc });

    // Simulate step slice and deletion nodes from a replacement transaction
    const stepInsertNodes = [schema.text('replacement', [insertMark])];
    const deletionNodes = [schema.text('original', [deleteMark])];

    const payload = createOrUpdateTrackedChangeComment({
      event: 'add',
      marks: { insertedMark: insertMark, deletionMark: deleteMark, formatMark: null },
      deletionNodes,
      nodes: stepInsertNodes,
      newEditorState: state,
      documentId: 'doc-1',
    });

    expect(payload?.trackedChangeText).toBe('replacement');
    expect(payload?.trackedChangeText).not.toBe('replacementt');
    expect(payload?.deletedText).toBe('original');
  });

  it('preserves deletedText on replacement update when transaction meta only carries insertion mark', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'replace-update-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });
    const deleteMark = schema.marks[TrackDeleteMarkName].create({
      id: 'replace-update-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });

    const docInsertNode = schema.text('replacement', [insertMark]);
    const docDeleteNode = schema.text('original', [deleteMark]);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [docInsertNode, docDeleteNode])]);
    const state = EditorState.create({ schema, doc });

    // Simulate an update transaction where meta has only insertedMark, but the
    // document still has both insert+delete marks under the same tracked-change id.
    const payload = createOrUpdateTrackedChangeComment({
      event: 'update',
      marks: { insertedMark: insertMark, deletionMark: null, formatMark: null },
      deletionNodes: [],
      nodes: [schema.text('replacement', [insertMark])],
      newEditorState: state,
      documentId: 'doc-1',
      trackedChangesForId: [
        { mark: insertMark, from: 1, to: doc.content.size },
        { mark: deleteMark, from: 1, to: doc.content.size },
      ],
    });

    expect(payload?.event).toBe(comments_module_events.UPDATE);
    expect(payload?.trackedChangeType).toBe('both');
    expect(payload?.trackedChangeText).toBe('replacement');
    expect(payload?.deletedText).toBe('original');
    expect(payload?.changeId).toBe('replace-update-1');
    expect(payload?.trackedChangeDisplayType).toBeNull();
  });

  it('does not collapse distinct insert/delete ids into one replacement payload', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'replace-insert-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });
    const deleteMark = schema.marks[TrackDeleteMarkName].create({
      id: 'replace-delete-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });

    const docInsertNode = schema.text('replacement', [insertMark]);
    const docDeleteNode = schema.text('original', [deleteMark]);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [docDeleteNode, docInsertNode])]);
    const state = EditorState.create({ schema, doc });

    const payload = createOrUpdateTrackedChangeComment({
      event: 'add',
      marks: { insertedMark: insertMark, deletionMark: deleteMark, formatMark: null },
      deletionNodes: [docDeleteNode],
      nodes: [docInsertNode],
      newEditorState: state,
      documentId: 'doc-1',
      trackedChangesForId: [{ mark: insertMark, from: 1, to: doc.content.size }],
    });

    expect(payload?.changeId).toBe('replace-insert-1');
    expect(payload?.trackedChangeType).toBe(TrackInsertMarkName);
    expect(payload?.trackedChangeText).toBe('replacement');
    expect(payload?.deletedText).toBe('');
  });

  it('createOrUpdateTrackedChangeComment builds add and update payloads', () => {
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'create-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });
    const nodes = [schema.text('Body', [insertMark])];
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, nodes)]),
    });

    const baseArgs = {
      marks: { insertedMark: insertMark, deletionMark: null, formatMark: null },
      deletionNodes: [],
      nodes,
      newEditorState: state,
      documentId: 'doc-1',
    };

    const addPayload = createOrUpdateTrackedChangeComment({ event: 'add', ...baseArgs });
    expect(addPayload).toMatchObject({
      event: comments_module_events.ADD,
      changeId: 'create-1',
      trackedChangeText: 'Body',
    });
    expect(addPayload.deletedText).toBeNull();

    const updatePayload = createOrUpdateTrackedChangeComment({ event: 'update', ...baseArgs });
    expect(updatePayload.event).toBe(comments_module_events.UPDATE);
    expect(updatePayload.deletedText).toBeNull();

    const emptyState = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Plain')])]),
    });

    const emptyPayload = createOrUpdateTrackedChangeComment({
      event: 'add',
      marks: { insertedMark: insertMark, deletionMark: null, formatMark: null },
      deletionNodes: [],
      nodes: [schema.text('No mark')],
      newEditorState: emptyState,
      documentId: 'doc-1',
    });
    expect(emptyPayload).toBeUndefined();
  });

  it('createOrUpdateTrackedChangeComment preserves hyperlink-specific display metadata for format changes', () => {
    const schema = createCommentSchema();
    const formatMark = schema.marks[TrackFormatMarkName].create({
      id: 'format-link-1',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
      before: [],
      after: [
        { type: 'underline', attrs: {} },
        { type: 'link', attrs: { href: 'https://example.com', text: 'website' } },
      ],
    });
    const nodes = [schema.text('website', [formatMark])];
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, nodes)]),
    });

    const payload = createOrUpdateTrackedChangeComment({
      event: 'add',
      marks: { insertedMark: null, deletionMark: null, formatMark },
      deletionNodes: [],
      nodes,
      newEditorState: state,
      documentId: 'doc-1',
    });

    expect(payload).toMatchObject({
      trackedChangeType: TrackFormatMarkName,
      trackedChangeText: 'https://example.com',
      trackedChangeDisplayType: 'hyperlinkAdded',
    });
  });

  it('createOrUpdateTrackedChangeComment prefers the live format mark when transaction meta is stale', () => {
    const schema = createCommentSchema();
    const staleFormatMark = schema.marks[TrackFormatMarkName].create({
      id: 'format-link-2',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
      before: [],
      after: [{ type: 'underline', attrs: {} }],
    });
    const liveFormatMark = schema.marks[TrackFormatMarkName].create({
      id: 'format-link-2',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
      before: [],
      after: [{ type: 'underline', attrs: {} }],
    });
    const nodes = [schema.text('website', [liveFormatMark, schema.marks.link.create({ href: 'https://example.com' })])];
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, nodes)]),
    });

    const payload = createOrUpdateTrackedChangeComment({
      event: 'add',
      marks: { insertedMark: null, deletionMark: null, formatMark: staleFormatMark },
      deletionNodes: [],
      nodes,
      newEditorState: state,
      documentId: 'doc-1',
    });

    expect(payload).toMatchObject({
      trackedChangeType: TrackFormatMarkName,
      trackedChangeText: 'https://example.com',
      trackedChangeDisplayType: 'hyperlinkAdded',
    });
  });

  it('findRangeById returns ranges for comment and tracked marks', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'comment-range' });
    const trackedMark = schema.marks[TrackInsertMarkName].create({ id: 'tracked-range' });
    const paragraph = schema.node('paragraph', null, [
      schema.text('Comment', [commentMark]),
      schema.text('Tracked', [trackedMark]),
    ]);
    const doc = schema.node('doc', null, [paragraph]);

    const commentRange = findRangeById(doc, 'comment-range');
    expect(commentRange).toEqual(expect.objectContaining({ from: expect.any(Number), to: expect.any(Number) }));

    const trackedRange = findRangeById(doc, 'tracked-range');
    expect(trackedRange).toEqual(expect.objectContaining({ from: expect.any(Number), to: expect.any(Number) }));

    expect(findRangeById(doc, 'missing-id')).toBeNull();
  });

  it('createOrUpdateTrackedChangeComment returns early when nodes array is empty (IT-250)', () => {
    // Regression test for IT-250: deleting tracked changes caused
    // "Cannot read properties of undefined (reading 'marks')" error
    // because nodes[0] was undefined when the array was empty
    const schema = createCommentSchema();
    const insertMark = schema.marks[TrackInsertMarkName].create({
      id: 'empty-nodes-test',
      author: 'Author',
      authorEmail: 'author@example.com',
      date: 'today',
    });

    const emptyState = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Plain')])]),
    });

    // This should not throw - it should return undefined gracefully
    const result = createOrUpdateTrackedChangeComment({
      event: 'add',
      marks: { insertedMark: insertMark, deletionMark: null, formatMark: null },
      deletionNodes: [],
      nodes: [], // Empty nodes array - the IT-250 bug condition
      newEditorState: emptyState,
      documentId: 'doc-1',
    });

    expect(result).toBeUndefined();
  });
});

describe('getActiveCommentId - nested comments and TC precedence', () => {
  it('returns innermost comment when cursor is in nested range', () => {
    // Doc: "Hello [outer: world [inner: !]]"
    const schema = createCommentSchema();
    const outerMark = schema.marks[CommentMarkName].create({ commentId: 'outer-comment' });
    const innerMark = schema.marks[CommentMarkName].create({ commentId: 'inner-comment' });
    const paragraph = schema.node('paragraph', null, [
      schema.text('Hello '),
      schema.text('world ', [outerMark]),
      schema.text('!', [outerMark, innerMark]),
    ]);
    const doc = schema.node('doc', null, [paragraph]);

    // Position 13 is on "!" (0=doc, 1=paragraph start, then "Hello " is 6 chars, "world " is 6 chars = pos 13)
    const selection = TextSelection.create(doc, 13);
    expect(getActiveCommentId(doc, selection)).toBe('inner-comment');
  });

  it('returns outer comment when cursor is outside inner range', () => {
    // Doc: "Hello [outer: world [inner: !]]"
    const schema = createCommentSchema();
    const outerMark = schema.marks[CommentMarkName].create({ commentId: 'outer-comment' });
    const innerMark = schema.marks[CommentMarkName].create({ commentId: 'inner-comment' });
    const paragraph = schema.node('paragraph', null, [
      schema.text('Hello '),
      schema.text('world ', [outerMark]),
      schema.text('!', [outerMark, innerMark]),
    ]);
    const doc = schema.node('doc', null, [paragraph]);

    // Position 8 is on "world" (outside inner range)
    const selection = TextSelection.create(doc, 8);
    expect(getActiveCommentId(doc, selection)).toBe('outer-comment');
  });

  it('returns comment ID when both comment and TC exist at cursor position', () => {
    // Doc: text has both TC and comment marks - comment should take precedence
    const schema = createCommentSchema();
    const tcMark = schema.marks[TrackInsertMarkName].create({ id: 'tc-1' });
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'comment-1' });
    const paragraph = schema.node('paragraph', null, [schema.text('lorem ipsum', [tcMark, commentMark])]);
    const doc = schema.node('doc', null, [paragraph]);

    const selection = TextSelection.create(doc, 3);
    expect(getActiveCommentId(doc, selection)).toBe('comment-1'); // NOT 'tc-1'
  });

  it('returns TC ID when only TC exists at cursor position', () => {
    const schema = createCommentSchema();
    const tcMark = schema.marks[TrackInsertMarkName].create({ id: 'tc-only' });
    const paragraph = schema.node('paragraph', null, [schema.text('TC only text', [tcMark])]);
    const doc = schema.node('doc', null, [paragraph]);

    const selection = TextSelection.create(doc, 3);
    expect(getActiveCommentId(doc, selection)).toBe('tc-only');
  });

  it('returns comment ID on overlapping text, TC ID on TC-only text', () => {
    // Doc: "[TC: Hello [comment: world]]"
    const schema = createCommentSchema();
    const tcMark = schema.marks[TrackInsertMarkName].create({ id: 'tc-2' });
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'comment-2' });
    const paragraph = schema.node('paragraph', null, [
      schema.text('Hello ', [tcMark]),
      schema.text('world', [tcMark, commentMark]),
    ]);
    const doc = schema.node('doc', null, [paragraph]);

    // Cursor on "Hello" (TC only) - position 3
    expect(getActiveCommentId(doc, TextSelection.create(doc, 3))).toBe('tc-2');
    // Cursor on "world" (both TC and comment) - position 8
    expect(getActiveCommentId(doc, TextSelection.create(doc, 8))).toBe('comment-2');
  });

  it('handles three levels of nested comments', () => {
    const schema = createCommentSchema();
    const outerMark = schema.marks[CommentMarkName].create({ commentId: 'outer' });
    const middleMark = schema.marks[CommentMarkName].create({ commentId: 'middle' });
    const innerMark = schema.marks[CommentMarkName].create({ commentId: 'inner' });
    const paragraph = schema.node('paragraph', null, [
      schema.text('Outer ', [outerMark]),
      schema.text('Middle ', [outerMark, middleMark]),
      schema.text('Inner', [outerMark, middleMark, innerMark]),
    ]);
    const doc = schema.node('doc', null, [paragraph]);

    // Position on "Inner" text (pos 14) - should return innermost
    expect(getActiveCommentId(doc, TextSelection.create(doc, 14))).toBe('inner');
    // Position on "Middle" text (pos 8) - should return middle
    expect(getActiveCommentId(doc, TextSelection.create(doc, 8))).toBe('middle');
    // Position on "Outer" text (pos 3) - should return outer
    expect(getActiveCommentId(doc, TextSelection.create(doc, 3))).toBe('outer');
  });

  it('returns null when cursor is outside all comments', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'c-1' });
    const paragraph = schema.node('paragraph', null, [
      schema.text('No comment. '),
      schema.text('Has comment.', [commentMark]),
    ]);
    const doc = schema.node('doc', null, [paragraph]);

    // Position 5 is on "No comment." (no marks)
    expect(getActiveCommentId(doc, TextSelection.create(doc, 5))).toBeNull();
  });

  it('correctly identifies adjacent non-overlapping comments', () => {
    const schema = createCommentSchema();
    const markA = schema.marks[CommentMarkName].create({ commentId: 'a' });
    const markB = schema.marks[CommentMarkName].create({ commentId: 'b' });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [markA]), schema.text('World', [markB])]);
    const doc = schema.node('doc', null, [paragraph]);

    // Position 3 is on "Hello" (mark A)
    expect(getActiveCommentId(doc, TextSelection.create(doc, 3))).toBe('a');
    // Position 8 is on "World" (mark B)
    expect(getActiveCommentId(doc, TextSelection.create(doc, 8))).toBe('b');
  });
});

describe('SD-1940: no recursive dispatch from apply() on selection change', () => {
  it('does not dispatch from apply() when selection moves onto a comment', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'c-1' });
    const paragraph = schema.node('paragraph', null, [
      schema.text('Plain text. '),
      schema.text('Commented text.', [commentMark]),
    ]);
    const doc = schema.node('doc', null, [paragraph]);

    const { editor, view, extension } = createEditorEnvironment(schema, doc);
    const plugins = extension.addPmPlugins();

    // Create state WITH the comments plugin so apply() runs
    const initialState = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 3),
      plugins,
    });
    view.state = initialState;

    // Track dispatch calls
    const dispatchSpy = vi.fn((tr) => {
      view.state = view.state.apply(tr);
    });
    view.dispatch = dispatchSpy;

    // Move selection onto commented text (pos 14) — triggers active thread change in apply()
    const tr = initialState.tr.setSelection(TextSelection.create(doc, 14));
    const newState = initialState.apply(tr);
    view.state = newState;

    // apply() should NOT have called view.dispatch() (the old bug dispatched a 'force' transaction)
    expect(dispatchSpy).not.toHaveBeenCalled();

    // But the commentsUpdate event should still have been emitted
    expect(editor.emit).toHaveBeenCalledWith(
      'commentsUpdate',
      expect.objectContaining({
        type: comments_module_events.SELECTED,
        activeCommentId: 'c-1',
      }),
    );
  });

  it('handles programmatic selection + addComment without recursive dispatch', () => {
    const schema = createCommentSchema();
    const paragraph = schema.node('paragraph', null, [schema.text('Hello world')]);
    const doc = schema.node('doc', null, [paragraph]);

    const { editor, commands, view, extension } = createEditorEnvironment(schema, doc);
    const plugins = extension.addPmPlugins();

    const initialState = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1, 1),
      plugins,
    });
    view.state = initialState;

    let dispatchCount = 0;
    view.dispatch = vi.fn((tr) => {
      dispatchCount++;
      if (dispatchCount > 10) throw new Error('Dispatch loop detected — exceeded 10 dispatches');
      view.state = view.state.apply(tr);
    });

    // Step 1: Programmatically select text (like the customer's code)
    const selTr = view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6));
    view.dispatch(selTr);

    // Step 2: Immediately add a comment (like the customer's code)
    const addCommentCmd = commands.addComment({ content: 'Test comment' });
    const addTr = view.state.tr;
    addCommentCmd({ tr: addTr, state: view.state, dispatch: view.dispatch, editor });

    // Should complete without loop — max 2-3 dispatches (selection + addComment + maybe decoration)
    expect(dispatchCount).toBeLessThanOrEqual(3);
  });
});

// Issue #2861: clicking a comment whose range overlaps a tracked change inside an inline
// SDT triggers `presentation.navigateTo`, which dispatches a collapsed cursor placement
// followed by a non-collapsed NodeSelection on the SDT wrapper. `getActiveCommentId` early-
// returns `undefined` for any non-collapsed selection, and the plugin used to coerce that
// `undefined` into `commentsUpdate({activeCommentId: null})`, clearing the just-activated
// comment. The host's `commentsUpdate` listener then re-asserts the comment, the plugin
// re-emits, and the highlight class flickers ~400 times/second until something else changes.
describe('SD-2861: non-collapsed selection does not clear active comment', () => {
  it('preserves activeThreadId when a non-collapsed selection follows explicit activation', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'thread-1', internal: true });
    // "Hello" (1..6) carries the comment, " World" (6..12) does not.
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark]), schema.text(' World')]);
    const doc = schema.node('doc', null, [paragraph]);
    const { view, editor } = createPluginStateEnvironment({ schema, doc });

    // Step 1: Explicitly activate the comment (mirrors the sidebar click path).
    view.dispatch(
      view.state.tr.setMeta(CommentsPluginKey, {
        type: 'setActiveComment',
        activeThreadId: 'thread-1',
        forceUpdate: true,
      }),
    );
    expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('thread-1');
    editor.emit.mockClear();

    // Step 2: Non-collapsed selection that straddles the comment boundary, mimicking the
    // NodeSelection that `presentation.navigateTo` produces on the SDT wrapper.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)));

    // The active comment must survive. `getActiveCommentId` returned undefined (because the
    // selection was non-collapsed); the plugin used to treat that as "no comment" and emit
    // commentsUpdate({activeCommentId: null}). It must not.
    expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('thread-1');
    expect(editor.emit).not.toHaveBeenCalledWith('commentsUpdate', expect.objectContaining({ activeCommentId: null }));
  });

  it('preserves activeThreadId when a follow-up non-collapsed selection sits entirely within the comment range', () => {
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'thread-1', internal: true });
    const trackedMark = schema.marks[TrackInsertMarkName].create({ id: 'tc-1' });
    // The repro case from #2861: text carries both a comment mark and a tracked-change mark.
    const paragraph = schema.node('paragraph', null, [schema.text('WYSIWYG', [commentMark, trackedMark])]);
    const doc = schema.node('doc', null, [paragraph]);
    const { view, editor } = createPluginStateEnvironment({ schema, doc });

    view.dispatch(
      view.state.tr.setMeta(CommentsPluginKey, {
        type: 'setActiveComment',
        activeThreadId: 'thread-1',
        forceUpdate: true,
      }),
    );
    editor.emit.mockClear();

    // Non-collapsed selection that wraps the entire comment range — what navigateTo
    // produces when it lands a NodeSelection on the SDT containing the tracked change.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)));

    expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('thread-1');
    expect(editor.emit).not.toHaveBeenCalledWith('commentsUpdate', expect.objectContaining({ activeCommentId: null }));
  });

  it('still clears activeThreadId when a collapsed cursor moves outside the comment range', () => {
    // Regression guard: the fix only suppresses clears for non-collapsed selections.
    // A real "user moved off the comment" interaction (collapsed cursor outside any comment)
    // must still propagate.
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'thread-1', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark]), schema.text(' World')]);
    const doc = schema.node('doc', null, [paragraph]);
    const { view, editor } = createPluginStateEnvironment({ schema, doc });

    view.dispatch(
      view.state.tr.setMeta(CommentsPluginKey, {
        type: 'setActiveComment',
        activeThreadId: 'thread-1',
        forceUpdate: true,
      }),
    );
    editor.emit.mockClear();

    // Collapsed cursor at pos 9 lands inside " World", which has no comment mark.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)));

    expect(CommentsPluginKey.getState(view.state).activeThreadId).toBeNull();
    expect(editor.emit).toHaveBeenCalledWith('commentsUpdate', expect.objectContaining({ activeCommentId: null }));
  });

  it('does not enter a dispatch loop when a host listener re-asserts after each commentsUpdate', () => {
    // Models the live system: SuperDoc.vue's onEditorCommentsUpdate calls
    // commentsStore.setActiveComment(superdoc, payload.activeCommentId), which dispatches
    // another setActiveComment meta back into the editor. Before the fix, the cursor + range
    // tx pair from navigateTo emitted (id, null) which the listener echoed back, looping.
    const schema = createCommentSchema();
    const commentMark = schema.marks[CommentMarkName].create({ commentId: 'thread-1', internal: true });
    const paragraph = schema.node('paragraph', null, [schema.text('Hello', [commentMark])]);
    const doc = schema.node('doc', null, [paragraph]);

    const { editor, view, extension } = createEditorEnvironment(schema, doc);
    const plugins = extension.addPmPlugins();
    view.state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1), plugins });

    let dispatchCount = 0;
    const originalDispatch = (tr) => {
      view.state = view.state.apply(tr);
    };
    view.dispatch = vi.fn((tr) => {
      dispatchCount += 1;
      if (dispatchCount > 10) throw new Error('Dispatch loop detected — exceeded 10 dispatches');
      originalDispatch(tr);
    });

    // Mirror the host's reaction: every commentsUpdate triggers a setActiveComment meta back
    // into the editor. The store does this even when the payload's activeCommentId === null.
    editor.emit = vi.fn((eventName, payload) => {
      if (eventName !== 'commentsUpdate') return;
      view.dispatch(
        view.state.tr.setMeta(CommentsPluginKey, {
          type: 'setActiveComment',
          activeThreadId: payload?.activeCommentId ?? null,
          forceUpdate: true,
        }),
      );
    });

    // Tx 1: cursor placement at pos 3 inside the comment.
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, 3))
        .setMeta(CommentsPluginKey, { type: 'setCursorById', preferredActiveThreadId: 'thread-1' }),
    );
    // Tx 2: non-collapsed selection — the SDT-wrapper case from navigateTo.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));

    // Without the fix, dispatchCount would explode (each clear emit triggers another
    // setActiveComment dispatch). The non-collapsed-clear suppression keeps it bounded.
    expect(dispatchCount).toBeLessThanOrEqual(5);
    expect(CommentsPluginKey.getState(view.state).activeThreadId).toBe('thread-1');
  });
});

describe('Headless mode plugin behavior', () => {
  it('creates a state-only plugin in headless mode (no props or view)', () => {
    const editor = {
      options: { isHeadless: true, comments: {} },
      emit: vi.fn(),
    };

    const extension = Extension.create(CommentsPlugin.config);
    extension.editor = editor;
    const plugins = CommentsPlugin.config.addPmPlugins.call(extension);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].spec.props).toBeUndefined();
    expect(plugins[0].spec.view).toBeUndefined();
    // State spec should exist
    expect(plugins[0].spec.state).toBeDefined();
    expect(plugins[0].spec.state.init).toBeDefined();
    expect(plugins[0].spec.state.apply).toBeDefined();
  });

  it('creates a full plugin in browser mode (with props and view)', () => {
    const editor = {
      options: { isHeadless: false, comments: {} },
      emit: vi.fn(),
    };

    const extension = Extension.create(CommentsPlugin.config);
    extension.editor = editor;
    const plugins = CommentsPlugin.config.addPmPlugins.call(extension);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].spec.props).toBeDefined();
    expect(plugins[0].spec.view).toBeDefined();
  });

  it('provides valid plugin state via CommentsPluginKey in headless mode', () => {
    const schema = createCommentSchema();
    const editor = {
      options: { isHeadless: true, comments: { highlightColors: { external: '#aaa', internal: '#bbb' } } },
      emit: vi.fn(),
    };

    const extension = Extension.create(CommentsPlugin.config);
    extension.editor = editor;
    const plugins = CommentsPlugin.config.addPmPlugins.call(extension);

    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Hello')])]);
    const state = EditorState.create({ schema, doc, plugins });
    const pluginState = CommentsPluginKey.getState(state);

    expect(pluginState).toBeDefined();
    expect(pluginState.trackedChanges).toEqual({});
    expect(pluginState.activeThreadId).toBeNull();
    expect(pluginState.allCommentPositions).toEqual({});
    expect(pluginState.externalColor).toBe('#aaa');
    expect(pluginState.internalColor).toBe('#bbb');
  });
});
