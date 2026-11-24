import { describe, expect, it, vi } from 'vite-plus/test';

import {
  registerCommentComposerBridge,
  type CommentComposerBridge,
  type CommentComposerResult,
} from '../../helpers/comment-composer-bridge.js';
import { createSuperDocUI } from './create-super-doc-ui.js';

function mount({
  readOnly = false,
  editor = true,
  composer = (async () => ({ ok: true })) as () => Promise<CommentComposerResult>,
  bridge = true,
} = {}) {
  const superdoc = {
    interactionConfig: { comments: { readOnly, allowResolve: true } },
    config: { modules: { comments: {} } },
    activeEditor: editor ? { editorVersion: 2, doc: { comments: {} } } : null,
  };
  const open = vi.fn(composer);
  const close = vi.fn();
  const shell: CommentComposerBridge = { open, close };
  if (bridge) registerCommentComposerBridge(superdoc, shell);
  const ui = createSuperDocUI({ superdoc });
  return { ui, open, close };
}

describe('ui.comments.openComposer', () => {
  it('opens the shell composer and reports success', async () => {
    const { ui, open } = mount();

    expect(await ui.comments.openComposer()).toStrictEqual({ ok: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['editing-range-required', 'range-selection-required'],
    ['review-surface-read-only', 'document-readonly'],
    ['read-only', 'document-readonly'],
    ['document-replaced', 'not-ready'],
    ['comments-disabled', 'operation-unavailable'],
    [undefined, 'operation-unavailable'],
  ])('maps the shell refusal %s to %s', async (shellReason, reason) => {
    const { ui } = mount({ composer: async () => ({ ok: false, reason: shellReason }) });

    expect(await ui.comments.openComposer()).toStrictEqual({ ok: false, reason });
  });

  it('refuses read-only comments without opening the composer', async () => {
    const { ui, open } = mount({ readOnly: true });

    expect(await ui.comments.openComposer()).toStrictEqual({ ok: false, reason: 'document-readonly' });
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses before an Editor is mounted', async () => {
    const { ui, open } = mount({ editor: false });

    expect(await ui.comments.openComposer()).toStrictEqual({ ok: false, reason: 'not-ready' });
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses when no built-in comments UI is mounted', async () => {
    const { ui } = mount({ bridge: false });

    expect(await ui.comments.openComposer()).toStrictEqual({ ok: false, reason: 'operation-unavailable' });
  });

  it('turns a throwing shell into a refusal', async () => {
    const { ui } = mount({
      composer: async () => {
        throw new Error('shell failed');
      },
    });

    expect(await ui.comments.openComposer()).toStrictEqual({ ok: false, reason: 'operation-unavailable' });
  });

  it('refuses after the controller is destroyed', async () => {
    const { ui, open, close } = mount();
    ui.destroy();

    expect(await ui.comments.openComposer()).toStrictEqual({ ok: false, reason: 'not-ready' });
    ui.comments.closeComposer();
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('ui.comments.closeComposer', () => {
  it('discards the shell draft', () => {
    const { ui, close } = mount();

    ui.comments.closeComposer();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('is safe without a built-in comments UI', () => {
    const { ui } = mount({ bridge: false });

    expect(() => ui.comments.closeComposer()).not.toThrow();
  });
});
