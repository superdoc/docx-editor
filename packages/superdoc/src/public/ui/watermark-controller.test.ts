import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { SurfaceManager } from '../../core/surface-manager.js';
import SurfaceHost from '../../components/surfaces/SurfaceHost.vue';
import { createWatermarkController } from './watermark-controller.js';

const section = {
  address: { kind: 'section', sectionId: 'section-0' },
  index: 0,
  range: { startParagraphIndex: 0, endParagraphIndex: 0 },
};
function harness(container?: HTMLElement) {
  const listeners = new Set<(event: { type: string }) => void>();
  const watermarks = {
    list: vi.fn(async () => ({ evaluatedRevision: '4', items: [], total: 0 })),
    apply: vi.fn(async (_input, options) => ({
      success: true,
      watermarks: [],
      affectedSlots: [
        { kind: 'headerFooterSlot', section: section.address, headerFooterKind: 'header', variant: 'default' },
      ],
      preservedSlots: [],
      evaluatedRevision: options.dryRun ? '4' : '5',
    })),
  };
  const editor = {
    doc: { watermarks, sections: { list: async () => ({ items: [section], total: 1 }) } },
    host: {
      watermarkPreview: vi.fn(async () => ({ url: 'data:image/svg+xml,preview', width: 612, height: 792 })),
      events: {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    },
  };
  const announce = vi.fn();
  const manager = new SurfaceManager({ getModuleConfig: () => undefined });
  const controller = createWatermarkController({
    announce,
    getEditor: () => editor,
    getMode: () => 'editing',
    getFonts: () => [],
    getContainer: () => container ?? null,
    openSurface: (request) => manager.open(request),
  });
  const model = () => manager.activeDialog.value?.props?.model;
  return { controller, manager, model, editor, watermarks, listeners, announce };
}
async function openText(h) {
  expect(h.controller.open()).toEqual({ ok: true });
  await vi.waitFor(() => expect(h.model().getSnapshot().phase).toBe('editing'));
  h.model().patchDraft({ kind: 'text', text: 'CONFIDENTIAL' });
  await vi.waitFor(() => expect(h.model().getSnapshot().canApply).toBe(true));
}

function scopeItem(id, variant, watermark = { kind: 'text', text: id }) {
  return {
    watermarkId: id,
    owner: { refId: id, partPath: `/word/${id}.xml` },
    effectiveIn: [{ kind: 'headerFooterSlot', section: section.address, headerFooterKind: 'header', variant }],
    watermark,
  };
}

async function openDefaultScope(h, items) {
  h.watermarks.list.mockResolvedValue({ evaluatedRevision: '4', items, total: items.length });
  h.controller.open();
  await vi.waitFor(() => expect(h.model().getSnapshot().phase).toBe('editing'));
  h.model().setScope(null, 'default');
  await vi.waitFor(() => expect(h.model().getSnapshot().phase).toBe('editing'));
}

describe('watermark dialog workflow', () => {
  it('summarizes large impacts while retaining every affected location for review', async () => {
    const h = harness();
    const affectedSlots = Array.from({ length: 20 }, (_, index) => ({
      kind: 'headerFooterSlot',
      section: { kind: 'section', sectionId: `section-${index}` },
      headerFooterKind: 'header',
      variant: 'default',
    }));
    h.editor.doc.sections.list = async () => ({
      items: affectedSlots.map((slot, index) => ({ ...section, address: slot.section, index })),
      total: 20,
    });
    h.watermarks.apply.mockResolvedValue({
      success: true,
      watermarks: [],
      affectedSlots,
      preservedSlots: [],
      evaluatedRevision: '4',
    });
    await openText(h);
    expect(h.model().getSnapshot().impact).toBe('Changes: 20 page locations. Other locations stay as they are.');
    expect(h.model().getSnapshot().impactDetails).toHaveLength(20);
    expect(h.model().getSnapshot().impactDetails[19]).toBe('Section 20, default pages');
    h.controller.destroy();
  });
  it('reconciles a removal draft with the sole owner in a newly selected scope', async () => {
    const h = harness();
    await openDefaultScope(h, [scopeItem('default-mark', 'default'), scopeItem('first-mark', 'first')]);
    h.model().patchDraft({ kind: 'none' });
    await vi.waitFor(() => expect(h.model().getSnapshot().canApply).toBe(true));
    h.model().setScope(null, 'first');
    await vi.waitFor(() => expect(h.model().getSnapshot().canApply).toBe(true));
    expect(h.model().getSnapshot()).toMatchObject({
      selectedIds: ['first-mark'],
      dirty: true,
      draft: { kind: 'none' },
    });
    expect(h.watermarks.apply.mock.lastCall?.[0]).toMatchObject({
      action: 'remove',
      watermarkIds: ['first-mark'],
      target: { slots: [expect.objectContaining({ variant: 'first' })] },
    });
    h.controller.destroy();
  });

  it('requires explicit selection when a removal scope contains several owners', async () => {
    const h = harness();
    await openDefaultScope(h, [
      scopeItem('default-mark', 'default'),
      scopeItem('first-a', 'first'),
      scopeItem('first-b', 'first'),
    ]);
    h.model().patchDraft({ kind: 'none' });
    h.model().setScope(null, 'first');
    await vi.waitFor(() => expect(h.model().getSnapshot().phase).toBe('editing'));
    expect(h.model().getSnapshot()).toMatchObject({ selectedIds: [], canApply: false, draft: { kind: 'none' } });
    h.controller.destroy();
  });

  it.each([
    [{ kind: 'text', text: 'ORIGINAL' }, { text: 'DRAFT CHANGE' }],
    [{ kind: 'picture', mediaPartPath: 'word/media/image1.png', contentType: 'image/png' }, { transparency: 65 }],
  ])(
    'retains a dirty content draft when its original owner leaves the selected scope: %j',
    async (watermark, patch) => {
      const h = harness();
      await openDefaultScope(h, [scopeItem('default-mark', 'default', watermark), scopeItem('first-mark', 'first')]);
      h.model().patchDraft(patch);
      const draft = h.model().getSnapshot().draft;
      h.model().setScope(null, 'first');
      await vi.waitFor(() => expect(h.model().getSnapshot().phase).toBe('editing'));
      expect(h.model().getSnapshot()).toMatchObject({ selectedIds: [], dirty: true, draft });
      h.controller.destroy();
    },
  );

  it('keeps drafts local and releases the dialog and subscriptions on cancel', async () => {
    const h = harness();
    await openText(h);
    h.controller.close();
    expect(h.manager.activeDialog.value).toBeNull();
    expect(h.watermarks.apply.mock.calls.every(([, options]) => options.dryRun === true)).toBe(true);
    expect(h.listeners.size).toBe(0);
  });

  it('retains a dirty draft and blocks apply after a remote mutation', async () => {
    const h = harness();
    await openText(h);
    h.listeners.forEach((listener) => listener({ type: 'collaboration:remote-changed' }));
    expect(h.model().getSnapshot()).toMatchObject({ stale: true, canApply: false, draft: { text: 'CONFIDENTIAL' } });
    await h.model().apply();
    expect(h.watermarks.apply.mock.calls.every(([, options]) => options.dryRun === true)).toBe(true);
    h.controller.destroy();
  });

  it('keeps the draft visible when the commit loses a revision race', async () => {
    const h = harness();
    await openText(h);
    h.watermarks.apply.mockResolvedValueOnce({
      success: false,
      failure: { code: 'REVISION_MISMATCH', message: 'stale' },
    });
    await h.model().apply();
    expect(h.model().getSnapshot()).toMatchObject({ stale: true, draft: { text: 'CONFIDENTIAL' }, canApply: false });
    expect(h.watermarks.apply.mock.lastCall?.[1]).toEqual({ expectedRevision: '4' });
    h.controller.destroy();
  });

  it.each(['exception', 'revision mismatch'])(
    'keeps the dialog draft after a commit %s and permits reload',
    async (failure) => {
      const h = harness();
      const host = mount(SurfaceHost, {
        global: { provide: { surfaceManager: h.manager }, stubs: { teleport: true } },
      });
      try {
        await openText(h);
        await flushPromises();
        const text = host.get('[aria-label="Watermark text"]');
        await text.setValue('PRIVATE');
        await vi.waitFor(() => expect(h.model().getSnapshot().canApply).toBe(true));
        if (failure === 'exception') h.watermarks.apply.mockRejectedValueOnce(new Error('The commit failed.'));
        else {
          h.watermarks.apply.mockResolvedValueOnce({
            success: false,
            failure: { code: 'REVISION_MISMATCH', message: 'The document changed.' },
          });
        }

        await host.get('form').trigger('submit');
        await flushPromises();

        expect(host.find('[role="dialog"]').exists()).toBe(true);
        expect(host.get('[aria-label="Watermark text"]').element.value).toBe('PRIVATE');
        expect(host.get('[role="alert"]').text()).toContain(
          failure === 'exception' ? 'The commit failed.' : 'The document changed',
        );
        expect(host.get('button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(h.watermarks.apply.mock.calls.filter(([, options]) => !options.dryRun)).toHaveLength(1);

        await host
          .findAll('button')
          .find((button) => button.text() === 'Review latest state')!
          .trigger('click');
        await flushPromises();

        expect(h.watermarks.list).toHaveBeenCalledTimes(2);
        expect(host.find('[role="alert"]').exists()).toBe(false);
        expect(host.find('[role="dialog"]').exists()).toBe(true);
      } finally {
        h.controller.destroy();
        host.unmount();
      }
    },
  );

  it('submits at most once and closing during apply does not pretend to cancel the commit', async () => {
    const h = harness();
    await openText(h);
    let finish;
    h.watermarks.apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const model = h.model();
    const first = model.apply();
    await model.apply();
    expect(model.getSnapshot().phase).toBe('applying');
    h.controller.close();
    finish({ success: true, evaluatedRevision: '5', affectedSlots: [], watermarks: [] });
    await first;
    expect(h.watermarks.apply.mock.calls.filter(([, options]) => !options.dryRun)).toHaveLength(1);
    expect(h.manager.activeDialog.value).toBeNull();
    expect(h.announce).toHaveBeenLastCalledWith('Watermark updated.');
  });

  it('never enables apply when preview fails', async () => {
    const h = harness();
    h.editor.host.watermarkPreview.mockRejectedValue(new Error('The image cannot be previewed.'));
    h.controller.open();
    await vi.waitFor(() => expect(h.model().getSnapshot().phase).toBe('editing'));
    h.model().patchDraft({ kind: 'text' });
    await vi.waitFor(() => expect(h.model().getSnapshot().error).toBe('The image cannot be previewed.'));
    expect(h.model().getSnapshot().canApply).toBe(false);
    h.controller.destroy();
  });

  it('does not resurrect a closed dialog when its initial read finishes late', async () => {
    const h = harness();
    let finish;
    h.watermarks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    h.controller.open();
    h.controller.close();
    finish({ evaluatedRevision: '4', items: [], total: 0 });
    await Promise.resolve();
    expect(h.manager.activeDialog.value).toBeNull();
    expect(h.editor.host.watermarkPreview).not.toHaveBeenCalled();
    h.controller.destroy();
  });

  it('keeps separate editor instances and their cancellation independent', async () => {
    const first = harness();
    const second = harness();
    await openText(first);
    await openText(second);
    first.controller.close();
    expect(second.model().getSnapshot()).toMatchObject({ draft: { text: 'CONFIDENTIAL' }, canApply: true });
    await second.model().apply();
    expect(first.watermarks.apply.mock.calls.every(([, options]) => options.dryRun)).toBe(true);
    expect(second.watermarks.apply.mock.calls.filter(([, options]) => !options.dryRun)).toHaveLength(1);
    first.controller.destroy();
    second.controller.destroy();
  });
});

describe('watermark toolbar focus return', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of cleanup.splice(0).reverse()) dispose();
    document.body.innerHTML = '';
  });

  function toolbarButton(container: HTMLElement, name: string) {
    container.innerHTML = `<div data-sd-part="toolbar"><div data-sd-part="toolbar-item" tabindex="0" role="button"><span data-item="btn-${name}"></span></div></div>`;
    const button = container.querySelector<HTMLElement>('[data-sd-part="toolbar-item"]')!;
    vi.spyOn(button, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 32, 32)] as unknown as DOMRectList);
    return button;
  }

  async function openFromToolbar(name = 'watermark') {
    const container = document.createElement('div');
    const editor = document.createElement('div');
    document.body.append(container, editor);
    const opener = toolbarButton(container, name);
    const h = harness(editor);
    const host = mount(SurfaceHost, {
      attachTo: editor,
      global: { provide: { surfaceManager: h.manager }, stubs: { teleport: true } },
    });
    cleanup.push(
      () => host.unmount(),
      () => h.controller.destroy(),
    );
    opener.focus();
    expect(h.controller.open()).toEqual({ ok: true });
    await nextTick();
    await nextTick();
    expect(host.get('[role="dialog"]').element.contains(document.activeElement)).toBe(true);
    return { h, host, container, opener };
  }

  it.each([
    ['watermark', 'watermark'],
    ['watermark', 'overflow'],
    ['overflow', 'watermark'],
    ['overflow', 'overflow'],
  ])('restores the current %s entry after it is rebuilt as %s', async (before, after) => {
    const unrelated = document.createElement('div');
    document.body.append(unrelated);
    toolbarButton(unrelated, after);
    const { h, container, opener } = await openFromToolbar(before);
    const replacement = toolbarButton(container, after);
    expect(opener.isConnected).toBe(false);
    h.controller.close();
    await flushPromises();
    expect(document.activeElement).toBe(replacement);
  });

  it('does not move intentional focus outside the closed dialog', async () => {
    const { h, container } = await openFromToolbar();
    const replacement = toolbarButton(container, 'watermark');
    const other = document.createElement('button');
    document.body.append(other);
    h.controller.close();
    other.focus();
    await flushPromises();
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(replacement);
  });

  it('does not restore an older dialog after a new one opens', async () => {
    const { h, host, container } = await openFromToolbar();
    toolbarButton(container, 'watermark');
    h.controller.close();
    expect(h.controller.open()).toEqual({ ok: true });
    await flushPromises();
    expect(host.get('[role="dialog"]').element.contains(document.activeElement)).toBe(true);
  });

  it.each(['destroyed', 'removed'])('does not restore focus when its owner is %s', async (reason) => {
    const { h, container } = await openFromToolbar();
    const replacement = toolbarButton(container, 'watermark');
    if (reason === 'destroyed') h.controller.destroy();
    else {
      container.remove();
      h.controller.close();
    }
    await flushPromises();
    expect(document.activeElement).not.toBe(replacement);
  });
});
