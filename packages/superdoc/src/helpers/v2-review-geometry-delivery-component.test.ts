import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';
import { globalPropertiesWith } from '../test-support/global-properties.js';

const publisher = vi.hoisted(() => ({
  last: null as { epoch?: number } | null,
  epoch: null as number | null,
  options: null as {
    onCommittedPagePaint?: (event: { payload: unknown }) => void;
    setGeometryAvailable?: (value: boolean) => void;
  } | null,
  notes: [] as unknown[],
  recollects: 0,
}));

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'ReviewDeliveryFixture',
        props: ['options', 'documentId'],
        emits: ['v2-render', 'v2-render-cleared'],
        setup: () => () => h('div'),
      }),
      createGeometryPublisher: (options: typeof publisher.options) => {
        publisher.options = options;
        return {
          async publish(value: typeof publisher.last) {
            await Promise.resolve();
            publisher.last = value;
            publisher.epoch = value?.epoch ?? null;
            options?.setGeometryAvailable?.(value != null);
          },
          async recollect() {
            await Promise.resolve();
            publisher.recollects++;
          },
          noteCommittedPageWindow(value: unknown) {
            publisher.notes.push(value);
          },
          getLastPayload: () => publisher.last,
          getLastEpoch: () => publisher.epoch,
          reset() {
            publisher.last = null;
            publisher.epoch = null;
          },
        };
      },
    }),
  };
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  publisher.last = null;
  publisher.epoch = null;
  publisher.options = null;
  publisher.notes = [];
  publisher.recollects = 0;
  vi.unstubAllGlobals();
});

async function mountShell() {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = ['a', 'b'].map((id) => ({
    id,
    type: DOCX,
    data: new Blob([]),
    editorMountNonce: 0,
    isReady: false,
    pageContainers: [],
    getEditor: () => null,
    getDocumentRuntime: () => null,
  }));
  const config = { modules: { comments: {} }, documentMode: 'editing' };
  Object.assign(store.modules, config.modules);
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: { editorVersion: 2, documentId: 'a' },
    user: { name: 'Reviewer' },
    users: [],
    colors: [],
    broadcastSidebarToggle() {},
    setActiveEditor() {},
  });
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: globalPropertiesWith({ $superdoc: superdoc }) },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  superdoc.emit('active-editor-change');
  await nextTick();
  const editors = wrapper.findAllComponents({ name: 'ReviewDeliveryFixture' });
  const editor = (id: string) => editors.find((item) => item.props('documentId') === id)!;
  const stage = (id: string) => {
    const element = document.createElement('div');
    element.dataset.superdocV2DocumentId = id;
    return element;
  };
  const runFrames = async () => {
    for (let turn = 0; turn < 10 && frames.size; turn++) {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
      await flushPromises();
    }
    expect(frames.size).toBe(0);
  };
  return { editor, stage, runFrames };
}

const packet = (paintEpoch: number, documentEpoch = 'doc-a') => ({
  documentEpoch,
  paintEpoch,
  commitSequence: paintEpoch,
  pageIndices: [0],
  zoomScale: 1,
  reviewGeometry: { coordinateSpace: 'paint-wrapper-css-px', complete: true, entries: [] },
});

describe('review geometry delivery in SuperDoc', () => {
  it('flushes an early packet only after asynchronous publication establishes its paint', async () => {
    const { editor, stage, runFrames } = await mountShell();
    const render = { documentId: 'a', epoch: 7, mountContainer: stage('a'), mount: { getRenderEpoch: () => 7 } };
    const options = editor('a').props('options') as { onReviewWindowCommitted(value: unknown): void };
    options.onReviewWindowCommitted(packet(7));
    expect(publisher.notes).toHaveLength(0);
    editor('a').vm.$emit('v2-render', render);
    await runFrames();
    expect(publisher.notes).toEqual([packet(7)]);
  });

  it('replays after scroll and an internal route recollect without a feedback loop', async () => {
    const { editor, stage, runFrames } = await mountShell();
    const render = { documentId: 'a', epoch: 7, mountContainer: stage('a'), mount: { getRenderEpoch: () => 7 } };
    editor('a').vm.$emit('v2-render', render);
    await runFrames();
    const options = editor('a').props('options') as { onReviewWindowCommitted(value: unknown): void };
    options.onReviewWindowCommitted(packet(7));
    await runFrames();
    window.dispatchEvent(new Event('scroll'));
    await runFrames();
    expect(publisher.recollects).toBe(1);
    expect(publisher.notes).toHaveLength(2);
    publisher.options?.onCommittedPagePaint?.({ payload: render });
    await runFrames();
    expect(publisher.notes).toHaveLength(3);
    publisher.options?.onCommittedPagePaint?.({ payload: render });
    editor('a').vm.$emit('v2-render-cleared', { documentId: 'a' });
    await runFrames();
    expect(publisher.notes).toHaveLength(3);
  });

  it('defers a new paint and an early second document until their matching frames', async () => {
    const { editor, stage, runFrames } = await mountShell();
    let epoch = 7;
    const a = { documentId: 'a', epoch, mountContainer: stage('a'), mount: { getRenderEpoch: () => epoch } };
    editor('a').vm.$emit('v2-render', a);
    await runFrames();
    const optionsA = editor('a').props('options') as { onReviewWindowCommitted(value: unknown): void };
    const optionsB = editor('b').props('options') as { onReviewWindowCommitted(value: unknown): void };
    epoch = 8;
    optionsA.onReviewWindowCommitted(packet(8));
    optionsB.onReviewWindowCommitted(packet(9, 'doc-b'));
    expect(publisher.notes).toHaveLength(0);
    editor('a').vm.$emit('v2-render', { ...a, epoch: 8 });
    await runFrames();
    expect(publisher.notes).toEqual([packet(8)]);
    const b = { documentId: 'b', epoch: 9, mountContainer: stage('b'), mount: { getRenderEpoch: () => 9 } };
    editor('b').vm.$emit('v2-render', b);
    await runFrames();
    expect(publisher.notes).toEqual([packet(8), packet(9, 'doc-b')]);
  });
});
