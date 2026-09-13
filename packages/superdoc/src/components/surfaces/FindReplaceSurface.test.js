// @ts-nocheck
import { describe, it, expect, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick, ref, computed } from 'vue';
import FindReplaceSurface from './FindReplaceSurface.vue';

const DEFAULT_TEXTS = {
  findPlaceholder: 'Find',
  findAriaLabel: 'Find text',
  replacePlaceholder: 'Replace',
  replaceAriaLabel: 'Replace text',
  noResultsLabel: 'No results',
  previousMatchLabel: 'Previous',
  previousMatchAriaLabel: 'Previous',
  nextMatchLabel: 'Next',
  nextMatchAriaLabel: 'Next',
  closeLabel: 'Close',
  closeAriaLabel: 'Close',
  replaceLabel: 'Replace',
  replaceAllLabel: 'All',
  toggleReplaceLabel: 'Toggle replace',
  toggleReplaceAriaLabel: 'Toggle replace',
  matchCaseLabel: 'Aa',
  matchCaseAriaLabel: 'Match case',
  ignoreDiacriticsLabel: 'ä≡a',
  ignoreDiacriticsAriaLabel: 'Ignore diacritics',
};

/**
 * Build a ref-shaped findReplace handle that mirrors what useFindReplace provides.
 * goNext / goPrev simulate the real Search extension behaviour of focusing the
 * editor view (which is what causes SD-3045 in production) by moving focus to a
 * detached element supplied via `stealFocusInto`.
 */
function createHandle(overrides = {}) {
  const findQuery = ref('Lorem');
  const replaceText = ref('');
  const caseSensitive = ref(false);
  const ignoreDiacritics = ref(false);
  const showReplace = ref(false);
  const matchCount = ref(16);
  const activeMatchIndex = ref(0);

  return {
    findQuery,
    replaceText,
    caseSensitive,
    ignoreDiacritics,
    showReplace,
    matchCount,
    activeMatchIndex,
    matchLabel: computed(() => `${activeMatchIndex.value + 1} of ${matchCount.value}`),
    hasMatches: computed(() => matchCount.value > 0),
    replaceEnabled: true,
    texts: { ...DEFAULT_TEXTS },
    goNext: vi.fn(() => overrides.stealFocusInto?.focus()),
    goPrev: vi.fn(() => overrides.stealFocusInto?.focus()),
    replaceCurrent: vi.fn(),
    replaceAll: vi.fn(),
    registerFocusFn: vi.fn(),
    close: vi.fn(),
    ...overrides.handle,
  };
}

function mountSurface(handle) {
  return mount(FindReplaceSurface, {
    attachTo: document.body,
    props: {
      surfaceId: 'fr-1',
      mode: 'floating',
      request: {},
      resolve: vi.fn(),
      close: vi.fn(),
      findReplace: handle,
    },
  });
}

describe('FindReplaceSurface — keyboard focus (SD-3045)', () => {
  it('keeps focus on the find input after pressing Enter, even when goNext steals focus to another element', async () => {
    // The editor view focus steal is the real-world cause of SD-3045 — simulate it
    // with a detached div that goNext focuses synchronously, matching the Search
    // extension's editor.view.focus() side effect.
    const stealTarget = document.createElement('div');
    stealTarget.tabIndex = -1;
    document.body.appendChild(stealTarget);

    try {
      const handle = createHandle({ stealFocusInto: stealTarget });
      const wrapper = mountSurface(handle);
      const input = wrapper.find('.sd-find-replace__input').element;
      input.focus();
      expect(document.activeElement).toBe(input);

      await wrapper.find('.sd-find-replace__input').trigger('keydown', { key: 'Enter' });
      await nextTick();

      expect(handle.goNext).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);

      wrapper.unmount();
    } finally {
      stealTarget.remove();
    }
  });

  it('keeps focus on the find input after Shift+Enter (previous match)', async () => {
    const stealTarget = document.createElement('div');
    stealTarget.tabIndex = -1;
    document.body.appendChild(stealTarget);

    try {
      const handle = createHandle({ stealFocusInto: stealTarget });
      const wrapper = mountSurface(handle);
      const input = wrapper.find('.sd-find-replace__input').element;
      input.focus();

      await wrapper.find('.sd-find-replace__input').trigger('keydown', { key: 'Enter', shiftKey: true });
      await nextTick();

      expect(handle.goPrev).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);

      wrapper.unmount();
    } finally {
      stealTarget.remove();
    }
  });

  it('prevents the default Enter behaviour so the editor never receives the keystroke', () => {
    const handle = createHandle();
    const wrapper = mountSurface(handle);
    const input = wrapper.find('.sd-find-replace__input').element;
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    wrapper.unmount();
  });

  // SD-3045 follow-up (Luccas's PR review comment on #3240): pressing Enter
  // when the next match is on a different page must not undo the
  // document renderer scroll that goNext just performed. The
  // surface is rendered in the normal document flow, so the browser's
  // default "scroll input into view" behaviour on .focus() snaps the
  // document back to wherever the find input is, hiding the new match. The
  // fix is to restore focus with { preventScroll: true } so the document
  // scroll stays where goNext placed it.
  it('restores focus without scrolling the document back to the find input', async () => {
    const stealTarget = document.createElement('div');
    stealTarget.tabIndex = -1;
    document.body.appendChild(stealTarget);

    try {
      const handle = createHandle({ stealFocusInto: stealTarget });
      const wrapper = mountSurface(handle);
      const input = wrapper.find('.sd-find-replace__input').element;

      const focusSpy = vi.spyOn(input, 'focus');
      input.focus();

      await wrapper.find('.sd-find-replace__input').trigger('keydown', { key: 'Enter' });
      await nextTick();

      // After Enter, the surface restores focus to the input. That focus call
      // must pass preventScroll so the browser does not scroll the document
      // back to the input — otherwise the goNext scroll is undone for any
      // match on a different page.
      const calls = focusSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const restoreCall = calls[calls.length - 1];
      expect(restoreCall[0]).toEqual(expect.objectContaining({ preventScroll: true }));

      focusSpy.mockRestore();
      wrapper.unmount();
    } finally {
      stealTarget.remove();
    }
  });

  it('uses preventScroll on Shift+Enter focus restore too', async () => {
    const stealTarget = document.createElement('div');
    stealTarget.tabIndex = -1;
    document.body.appendChild(stealTarget);

    try {
      const handle = createHandle({ stealFocusInto: stealTarget });
      const wrapper = mountSurface(handle);
      const input = wrapper.find('.sd-find-replace__input').element;

      const focusSpy = vi.spyOn(input, 'focus');
      input.focus();

      await wrapper.find('.sd-find-replace__input').trigger('keydown', { key: 'Enter', shiftKey: true });
      await nextTick();

      const calls = focusSpy.mock.calls;
      const restoreCall = calls[calls.length - 1];
      expect(restoreCall[0]).toEqual(expect.objectContaining({ preventScroll: true }));

      focusSpy.mockRestore();
      wrapper.unmount();
    } finally {
      stealTarget.remove();
    }
  });

  // SD-3045 holistic: clicking the next/prev buttons must also restore focus to
  // the input — otherwise the button receives focus and the browser scrolls
  // the document back to the (off-screen) find bar, undoing the goNext scroll
  // exactly the same way pressing Enter without focus restore did.
  it('restores focus to the find input after clicking the next-match button', async () => {
    const stealTarget = document.createElement('div');
    stealTarget.tabIndex = -1;
    document.body.appendChild(stealTarget);

    try {
      const handle = createHandle({ stealFocusInto: stealTarget });
      const wrapper = mountSurface(handle);
      const input = wrapper.find('.sd-find-replace__input').element;
      const focusSpy = vi.spyOn(input, 'focus');

      const buttons = wrapper.findAll('.sd-find-replace__btn--icon');
      // First two icon buttons are prev (▲) and next (▼); third is close.
      const nextBtn = buttons[1];
      expect(nextBtn.exists()).toBe(true);

      await nextBtn.trigger('click');
      await nextTick();

      expect(handle.goNext).toHaveBeenCalledTimes(1);
      const focusCall = focusSpy.mock.calls.find((args) => args[0]?.preventScroll === true);
      expect(focusCall).toBeDefined();

      focusSpy.mockRestore();
      wrapper.unmount();
    } finally {
      stealTarget.remove();
    }
  });

  it('disables replace controls when canReplace is false (read-only) and hides the unsupported diacritics toggle', () => {
    const handle = createHandle({
      handle: {
        showReplace: ref(true),
        canReplace: computed(() => false),
        replacePending: ref(false),
        ignoreDiacriticsSupported: ref(false),
      },
    });
    const wrapper = mountSurface(handle);

    const actionButtons = wrapper.findAll('.sd-find-replace__btn--action');
    expect(actionButtons.length).toBe(2);
    for (const btn of actionButtons) {
      expect(btn.attributes('disabled')).toBeDefined();
    }
    // The ignore-diacritics toggle button is hidden for the V2 driver.
    const toggleButtons = wrapper.findAll('.sd-find-replace__btn--toggle');
    const labels = toggleButtons.map((b) => b.text());
    expect(labels).not.toContain('ä≡a');

    wrapper.unmount();
  });

  it('disables only Replace all when the session is truncated', () => {
    const handle = createHandle({
      handle: {
        showReplace: ref(true),
        canReplace: computed(() => true),
        canReplaceAll: computed(() => false),
        replacePending: ref(false),
      },
    });
    const wrapper = mountSurface(handle);

    const [replaceButton, replaceAllButton] = wrapper.findAll('.sd-find-replace__btn--action');
    expect(replaceButton.attributes('disabled')).toBeUndefined();
    expect(replaceAllButton.attributes('disabled')).toBeDefined();

    wrapper.unmount();
  });

  it('hides the replace expander and row entirely when the session cannot mutate (SD-3569)', () => {
    const handle = createHandle({
      handle: {
        showReplace: ref(true),
        canReplace: computed(() => false),
        replaceCanMutate: ref(false),
        replacePending: ref(false),
      },
    });
    const wrapper = mountSurface(handle);

    expect(wrapper.find('.sd-find-replace__btn--expander').exists()).toBe(false);
    expect(wrapper.findAll('.sd-find-replace__btn--action').length).toBe(0);
    expect(wrapper.findAll('input').length).toBe(1);

    wrapper.unmount();
  });

  it('disables replace controls while a replace is pending', () => {
    const handle = createHandle({
      handle: {
        showReplace: ref(true),
        canReplace: computed(() => true),
        replacePending: ref(true),
        ignoreDiacriticsSupported: ref(true),
      },
    });
    const wrapper = mountSurface(handle);
    const actionButtons = wrapper.findAll('.sd-find-replace__btn--action');
    for (const btn of actionButtons) {
      expect(btn.attributes('disabled')).toBeDefined();
    }
    wrapper.unmount();
  });

  it('restores focus to the find input after clicking the previous-match button', async () => {
    const stealTarget = document.createElement('div');
    stealTarget.tabIndex = -1;
    document.body.appendChild(stealTarget);

    try {
      const handle = createHandle({ stealFocusInto: stealTarget });
      const wrapper = mountSurface(handle);
      const input = wrapper.find('.sd-find-replace__input').element;
      const focusSpy = vi.spyOn(input, 'focus');

      const buttons = wrapper.findAll('.sd-find-replace__btn--icon');
      const prevBtn = buttons[0];

      await prevBtn.trigger('click');
      await nextTick();

      expect(handle.goPrev).toHaveBeenCalledTimes(1);
      const focusCall = focusSpy.mock.calls.find((args) => args[0]?.preventScroll === true);
      expect(focusCall).toBeDefined();

      focusSpy.mockRestore();
      wrapper.unmount();
    } finally {
      stealTarget.remove();
    }
  });
});
