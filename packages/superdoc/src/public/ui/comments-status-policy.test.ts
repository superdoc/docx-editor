/**
 * Changing a comment's resolved state is governed by two separate policies.
 *
 * `interaction.comments.readOnly` forbids writing at all;
 * `interaction.comments.allowResolve` forbids only the resolve/reopen
 * transition while leaving ordinary replies alone. Both routes go through
 * `patchCommentStatus`, so guarding each caller individually is how one of
 * them gets missed.
 */
import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

/** A host whose `comments.patch` records whether the policy let it through. */
function mountWithPolicy(readOnly: boolean, allowResolve: boolean) {
  const patch = vi.fn(async () => ({ ok: true }));
  const ui = createSuperDocUI({
    superdoc: {
      interactionConfig: { comments: { readOnly, allowResolve } },
      // `ui: false` leaves `modules.comments === false`, so the legacy block
      // carries no policy — the resolved one has to be read instead.
      config: { modules: { comments: false } },
      activeEditor: { editorVersion: 2, doc: { comments: { patch } } },
    } as never,
  }) as unknown as {
    comments: { resolve: (id: string) => { success: boolean }; reopen: (id: string) => { success: boolean } };
  };
  return { ui, patch };
}

describe('comment status changes honor the interaction policy', () => {
  it('refuses resolve and reopen under readOnly', () => {
    const { ui, patch } = mountWithPolicy(true, true);

    expect(ui.comments.resolve('c1').success).toBe(false);
    expect(ui.comments.reopen('c1').success).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('refuses them when allowResolve is false, even though writes are permitted', () => {
    const { ui, patch } = mountWithPolicy(false, false);

    expect(ui.comments.resolve('c1').success).toBe(false);
    expect(ui.comments.reopen('c1').success).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('reaches the Document API when both policies permit it', () => {
    const { ui, patch } = mountWithPolicy(false, true);

    ui.comments.resolve('c1');

    expect(patch).toHaveBeenCalled();
  });
});

/** Every write route on the comments controller, with the host ops recorded. */
type CommentWrites = {
  createFromCapture: (capture: unknown, input: unknown) => { success: boolean };
  createFromSelection: (input: unknown) => { success: boolean };
  reply: (commentId: string, input: unknown) => { success: boolean };
  edit: (commentId: string, input: unknown) => { success: boolean };
  delete: (commentId: string) => { success: boolean };
};

function mountWithWrites(readOnly: boolean) {
  const create = vi.fn(async () => ({ ok: true }));
  const reply = vi.fn(async () => ({ ok: true }));
  const remove = vi.fn(async () => ({ ok: true }));
  const patch = vi.fn(async () => ({ ok: true }));
  const ui = createSuperDocUI({
    superdoc: {
      interactionConfig: { comments: { readOnly, allowResolve: true } },
      config: { modules: { comments: false } },
      activeEditor: { editorVersion: 2, doc: { comments: { create, reply, patch, delete: remove } } },
    } as never,
  }) as unknown as { comments: CommentWrites };
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
  it('refuses create, reply, edit, and delete under readOnly', () => {
    const { ui, create, reply, remove, patch } = mountWithWrites(true);

    expect(ui.comments.createFromCapture({ target: { type: 'text' } }, { text: 'x' }).success).toBe(false);
    expect(ui.comments.reply('c1', { text: 'x' }).success).toBe(false);
    expect(ui.comments.edit('c1', { text: 'x' }).success).toBe(false);
    expect(ui.comments.delete('c1').success).toBe(false);

    expect(create).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses createFromSelection before it asks for a selection', () => {
    // The refusal has to win over `NO_SELECTION`: the policy answer must not
    // depend on whether something happens to be selected.
    const { ui, create } = mountWithWrites(true);

    expect(ui.comments.createFromSelection({ text: 'x' }).success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('lets create, reply, edit, and delete through when the policy permits', () => {
    const { ui, create, reply, remove, patch } = mountWithWrites(false);

    ui.comments.createFromCapture({ target: { type: 'text' } }, { text: 'x' });
    ui.comments.reply('c1', { text: 'x' });
    ui.comments.edit('c1', { text: 'x' });
    ui.comments.delete('c1');

    expect(create).toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({ commentId: 'c1', text: 'x' });
    expect(remove).toHaveBeenCalled();
  });
});

/**
 * Viewing mode freezes the document body, not the comment permission policy.
 * When `interaction.comments.readOnly` is false, selection-backed create and
 * other comment writes remain available through the public controller (SD-4470).
 */
describe('comment writes stay available in viewing mode when comments are writable', () => {
  function mountViewingWritable() {
    const create = vi.fn(async () => ({ ok: true }));
    const reply = vi.fn(async () => ({ ok: true }));
    const remove = vi.fn(async () => ({ ok: true }));
    const patch = vi.fn(async () => ({ ok: true }));
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
    }) as unknown as {
      comments: CommentWrites & {
        createFromSelection: (input: unknown) => { success: boolean; reason?: string };
        resolve: (id: string) => { success: boolean; reason?: string };
      };
    };
    return { ui, create, reply, remove, patch };
  }

  it('does not refuse comment writes as DOCUMENT_READONLY merely because mode is viewing', () => {
    const { ui, create, reply, remove, patch } = mountViewingWritable();

    const fromSelection = ui.comments.createFromSelection({ text: 'viewing comment' });
    // Empty selection may still refuse with NO_SELECTION; viewing alone must not.
    expect(fromSelection.reason).not.toBe('DOCUMENT_READONLY');

    expect(ui.comments.createFromCapture({ target: { type: 'text' } }, { text: 'x' }).success).not.toBe(false);
    expect(ui.comments.reply('c1', { text: 'reply' }).success).not.toBe(false);
    expect(ui.comments.edit('c1', { text: 'edited' }).success).not.toBe(false);
    expect(ui.comments.resolve('c1').success).not.toBe(false);
    expect(ui.comments.delete('c1').success).not.toBe(false);

    expect(create).toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
    expect(patch).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
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
    const patch = vi.fn(async () => ({ ok: true }));
    const ui = createSuperDocUI({
      superdoc: {
        interactionConfig: { comments: { readOnly: false, allowResolve } },
        config: { modules: { comments: false } },
        activeEditor: { editorVersion: 2, doc: { comments: { patch } } },
      } as never,
    }) as unknown as { comments: CommentWrites };
    return { ui, patch };
  }

  it('edits the body while allowResolve is false, though resolve stays refused', () => {
    const { ui, patch } = mountForEdit(false);

    expect(ui.comments.edit('c1', { text: 'Corrected wording.' }).success).not.toBe(false);
    expect(patch).toHaveBeenCalledWith({ commentId: 'c1', text: 'Corrected wording.' });

    patch.mockClear();
    expect((ui.comments as unknown as { resolve: (id: string) => { success: boolean } }).resolve('c1').success).toBe(
      false,
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends only the text field, so an edit never carries a status transition', () => {
    const { ui, patch } = mountForEdit(true);

    ui.comments.edit('c1', { text: 'Corrected wording.' });

    expect(patch).toHaveBeenCalledWith({ commentId: 'c1', text: 'Corrected wording.' });
    expect(patch.mock.calls[0]?.[0]).not.toHaveProperty('status');
  });

  it('fails closed when the host exposes no patch operation', () => {
    const ui = createSuperDocUI({
      superdoc: {
        interactionConfig: { comments: { readOnly: false, allowResolve: true } },
        config: { modules: { comments: false } },
        activeEditor: { editorVersion: 2, doc: { comments: {} } },
      } as never,
    }) as unknown as { comments: CommentWrites };

    expect(ui.comments.edit('c1', { text: 'x' }).success).toBe(false);
  });
});
