/**
 * Changing a comment's resolved state is governed by two separate policies.
 *
 * `interaction.comments.readOnly` forbids writing at all;
 * `interaction.comments.allowResolve` forbids only the resolve/reopen
 * transition while leaving ordinary replies alone. Both routes go through
 * `patchCommentStatus`, so guarding each caller individually is how one of
 * them gets missed.
 */
import type { TextTarget } from '@superdoc/document-api';
import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

const written = { success: true };
const readOnly = { success: false, failure: { code: 'DOCUMENT_READONLY', message: 'Comments are read-only.' } };
const resolveDisabled = {
  success: false,
  failure: { code: 'DOCUMENT_READONLY', message: 'Resolving comments is disabled.' },
};
const target: TextTarget = { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 4 } }] };

/** A host whose `comments.patch` records whether the policy let it through. */
function mountWithPolicy(readOnly: boolean, allowResolve: boolean) {
  const patch = vi.fn(async () => written);
  const ui = createSuperDocUI({
    superdoc: {
      interactionConfig: { comments: { readOnly, allowResolve } },
      // `ui: false` leaves `modules.comments === false`, so the legacy block
      // carries no policy — the resolved one has to be read instead.
      config: { modules: { comments: false } },
      activeEditor: { editorVersion: 2, doc: { comments: { patch } } },
    } as never,
  });
  return { ui, patch };
}

describe('comment status changes honor the interaction policy', () => {
  it('refuses resolve and reopen under readOnly', async () => {
    const { ui, patch } = mountWithPolicy(true, true);

    expect(await ui.comments.resolve('c1')).toStrictEqual(readOnly);
    expect(await ui.comments.reopen('c1')).toStrictEqual(readOnly);
    expect(patch).not.toHaveBeenCalled();
  });

  it('refuses them when allowResolve is false, even though writes are permitted', async () => {
    const { ui, patch } = mountWithPolicy(false, false);

    expect(await ui.comments.resolve('c1')).toStrictEqual(resolveDisabled);
    expect(await ui.comments.reopen('c1')).toStrictEqual(resolveDisabled);
    expect(patch).not.toHaveBeenCalled();
  });

  it('reaches the Document API when both policies permit it', async () => {
    const { ui, patch } = mountWithPolicy(false, true);

    expect(await ui.comments.resolve('c1')).toStrictEqual(written);
    expect(await ui.comments.reopen('c1')).toStrictEqual(written);

    expect(patch.mock.calls).toStrictEqual([
      [{ commentId: 'c1', status: 'resolved' }],
      [{ commentId: 'c1', status: 'active' }],
    ]);
  });
});

/** Every write route on the comments controller, with the host ops recorded. */
function mountWithWrites(readOnly: boolean) {
  const create = vi.fn(async () => written);
  const reply = vi.fn(async () => written);
  const remove = vi.fn(async () => written);
  const patch = vi.fn(async () => written);
  const ui = createSuperDocUI({
    superdoc: {
      interactionConfig: { comments: { readOnly, allowResolve: true } },
      config: { modules: { comments: false } },
      activeEditor: { editorVersion: 2, doc: { comments: { create, reply, patch, delete: remove } } },
    } as never,
  });
  return { ui, create, reply, remove, patch };
}

/**
 * `readOnly` has to reach the create/reply/delete routes too.
 *
 * These are the routes a custom comment UI drives, and the Document API they
 * call has no policy of its own, so a missing guard here is a silent write on
 * a document the consumer marked read-only. Gating only the status helper left
 * exactly that hole.
 */
describe('comment writes honor readOnly on every route', () => {
  it('refuses create, reply, edit, and delete under readOnly', async () => {
    const { ui, create, reply, remove, patch } = mountWithWrites(true);

    expect(await ui.comments.createFromCapture({ target }, { text: 'x' })).toStrictEqual(readOnly);
    expect(await ui.comments.reply('c1', { text: 'x' })).toStrictEqual(readOnly);
    expect(await ui.comments.edit('c1', { text: 'x' })).toStrictEqual(readOnly);
    expect(await ui.comments.delete('c1')).toStrictEqual(readOnly);

    expect(create).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses createFromSelection before it asks for a selection', async () => {
    // The refusal has to win over `NO_SELECTION`: the policy answer must not
    // depend on whether something happens to be selected.
    const { ui, create } = mountWithWrites(true);

    expect(await ui.comments.createFromSelection({ text: 'x' })).toStrictEqual(readOnly);
    expect(create).not.toHaveBeenCalled();
  });

  it('lets create, reply, edit, and delete through when the policy permits', async () => {
    const { ui, create, reply, remove, patch } = mountWithWrites(false);

    expect(await ui.comments.createFromCapture({ target }, { text: 'x' })).toStrictEqual(written);
    expect(await ui.comments.reply('c1', { text: 'x' })).toStrictEqual(written);
    expect(await ui.comments.edit('c1', { text: 'x' })).toStrictEqual(written);
    expect(await ui.comments.delete('c1')).toStrictEqual(written);

    expect(create).toHaveBeenCalledWith({ target, text: 'x' });
    expect(reply).toHaveBeenCalledWith({ parentCommentId: 'c1', text: 'x' });
    expect(patch).toHaveBeenCalledWith({ commentId: 'c1', text: 'x' });
    expect(remove).toHaveBeenCalledWith({ commentId: 'c1' });
  });
});

/**
 * Viewing mode freezes the document body, not the comment permission policy.
 * When `interaction.comments.readOnly` is false, selection-backed create and
 * other comment writes remain available through the public controller (SD-4470).
 */
describe('comment writes stay available in viewing mode when comments are writable', () => {
  function mountViewingWritable() {
    const create = vi.fn(async () => written);
    const reply = vi.fn(async () => written);
    const remove = vi.fn(async () => written);
    const patch = vi.fn(async () => written);
    const ui = createSuperDocUI({
      superdoc: {
        interactionConfig: { comments: { readOnly: false, allowResolve: true } },
        config: { documentMode: 'viewing', modules: { comments: false } },
        activeEditor: {
          editorVersion: 2,
          options: { documentMode: 'viewing' },
          doc: { comments: { create, reply, patch, delete: remove } },
        },
      } as never,
    });
    return { ui, create, reply, remove, patch };
  }

  it('does not refuse comment writes as DOCUMENT_READONLY merely because mode is viewing', async () => {
    const { ui, create, reply, remove, patch } = mountViewingWritable();

    // Empty selection may still refuse with NO_SELECTION; viewing alone must not.
    expect(await ui.comments.createFromSelection({ text: 'viewing comment' })).toMatchObject({
      success: false,
      failure: { code: 'NO_SELECTION' },
    });

    expect(await ui.comments.createFromCapture({ target }, { text: 'x' })).toStrictEqual(written);
    expect(await ui.comments.reply('c1', { text: 'reply' })).toStrictEqual(written);
    expect(await ui.comments.edit('c1', { text: 'edited' })).toStrictEqual(written);
    expect(await ui.comments.resolve('c1')).toStrictEqual(written);
    expect(await ui.comments.delete('c1')).toStrictEqual(written);

    expect(create).toHaveBeenCalledWith({ target, text: 'x' });
    expect(reply).toHaveBeenCalledWith({ parentCommentId: 'c1', text: 'reply' });
    expect(patch.mock.calls).toStrictEqual([
      [{ commentId: 'c1', text: 'edited' }],
      [{ commentId: 'c1', status: 'resolved' }],
    ]);
    expect(remove).toHaveBeenCalledWith({ commentId: 'c1' });
  });
});

/**
 * `edit` and `resolve` both reach `comments.patch`, which is exactly why they
 * must not share a policy gate.
 *
 * `allowResolve: false` is a statement about the resolve/reopen transition, not
 * about authorship. Routing `edit` through `patchCommentStatus`'s guard — the
 * obvious refactor, since both call the same Document API op — would silently
 * stop an author from fixing a typo on any document that merely locks its
 * resolve workflow.
 */
describe('editing a comment body is independent of allowResolve', () => {
  function mountForEdit(allowResolve: boolean) {
    const patch = vi.fn(async (_input: unknown) => written);
    const ui = createSuperDocUI({
      superdoc: {
        interactionConfig: { comments: { readOnly: false, allowResolve } },
        config: { modules: { comments: false } },
        activeEditor: { editorVersion: 2, doc: { comments: { patch } } },
      } as never,
    });
    return { ui, patch };
  }

  it('edits the body while allowResolve is false, though resolve stays refused', async () => {
    const { ui, patch } = mountForEdit(false);

    expect(await ui.comments.edit('c1', { text: 'Corrected wording.' })).toStrictEqual(written);
    expect(patch).toHaveBeenCalledWith({ commentId: 'c1', text: 'Corrected wording.' });

    patch.mockClear();
    expect(await ui.comments.resolve('c1')).toStrictEqual(resolveDisabled);
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends only the text field, so an edit never carries a status transition', async () => {
    const { ui, patch } = mountForEdit(true);

    expect(await ui.comments.edit('c1', { text: 'Corrected wording.' })).toStrictEqual(written);

    expect(patch).toHaveBeenCalledWith({ commentId: 'c1', text: 'Corrected wording.' });
    expect(patch.mock.calls[0]?.[0]).not.toHaveProperty('status');
  });

  it('fails closed when the host exposes no patch operation', async () => {
    const ui = createSuperDocUI({
      superdoc: {
        interactionConfig: { comments: { readOnly: false, allowResolve: true } },
        config: { modules: { comments: false } },
        activeEditor: { editorVersion: 2, doc: { comments: {} } },
      } as never,
    });

    expect(await ui.comments.edit('c1', { text: 'x' })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
  });
});
