import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import type { ChangesConfig, User } from '../core/types/index.js';
import SuperDoc from '../SuperDoc.vue';
import { globalPropertiesWith } from '../test-support/global-properties.js';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'ChangeAttributionOptionsFixture',
        props: ['options', 'documentId'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function editorOptions(input: { user: User; changes?: ChangesConfig }) {
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [
    {
      id: 'doc-a',
      type: DOCX,
      data: new Blob([]),
      isReady: false,
      pageContainers: [],
      getEditor: () => null,
      getDocumentRuntime: () => null,
    },
  ];
  const config = { modules: {}, documentMode: 'editing', ...(input.changes ? { changes: input.changes } : {}) };
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: null,
    user: input.user,
    users: [],
    colors: [],
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
  return wrapper.findComponent({ name: 'ChangeAttributionOptionsFixture' }).props('options') as Record<string, unknown>;
}

describe('change attribution editor options', () => {
  it('forwards the user id, the claim function, and change retention to the document editor', async () => {
    const claim = vi.fn(async () => 'signed-claim');
    const options = await editorOptions({
      user: { id: 'user-ada', name: 'Ada', email: 'ada@example.com', claim },
      changes: { retainRecords: 50, retainBytes: 1024 },
    });

    expect(options.user).toMatchObject({ id: 'user-ada', name: 'Ada', email: 'ada@example.com' });
    expect((options.user as User).claim).toBe(claim);
    expect(options.changes).toEqual({ retainRecords: 50, retainBytes: 1024 });
  });

  it('omits change retention when the application does not configure it', async () => {
    const options = await editorOptions({ user: { name: 'Ada', claim: 'signed-claim' } });

    expect((options.user as User).claim).toBe('signed-claim');
    expect(options).not.toHaveProperty('changes');
  });
});
