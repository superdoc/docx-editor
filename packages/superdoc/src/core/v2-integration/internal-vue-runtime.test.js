import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as Vue from 'vue';

const key = '__SUPERDOC_V2_BROWSER_RUNTIME__';
const prior = globalThis[key];
afterEach(() => {
  if (prior === undefined) delete globalThis[key];
  else globalThis[key] = prior;
  vi.resetModules();
});

describe('packaged internal Vue selection', () => {
  it('imports UI component definitions without loading Vue or requiring main entry initialization', async () => {
    delete globalThis[key];
    const runtime = await import('./internal-vue-runtime.js');
    const options = { setup: () => null };
    expect(runtime.defineComponent(options)).toBe(options);
    expect(globalThis[key]).toBeUndefined();
    expect(() => runtime.ref('value')).toThrow(/initialize SuperDoc/);
  });

  it('forwards effects to the installed runtime without replacing registry peers', async () => {
    const peer = {};
    globalThis[key] = { vue: Vue, peer };
    const runtime = await import('./internal-vue-runtime.js');
    const ref = runtime.ref(1);
    const values = [];
    const stop = Vue.watch(ref, (value) => values.push(value), { flush: 'sync' });
    ref.value = 2;
    expect(values).toEqual([2]);
    stop();
    expect(globalThis[key].vue).toBe(Vue);
    expect(globalThis[key].peer).toBe(peer);
  });

  it('forwards readonly refs while requiring an installed runtime for calls', async () => {
    delete globalThis[key];
    const runtime = await import('./internal-vue-runtime.js');
    expect(typeof runtime.readonly).toBe('function');
    expect(() => runtime.readonly({ value: false })).toThrow(/initialize SuperDoc/);
    globalThis[key] = { vue: Vue };
    const source = Vue.ref(false);
    const read = runtime.readonly(source);
    expect(Vue.isReadonly(read)).toBe(true);
    source.value = true;
    expect(read.value).toBe(true);
  });

  it('wraps refs as readonly through the installed runtime', async () => {
    globalThis[key] = { vue: Vue };
    const runtime = await import('./internal-vue-runtime.js');
    const source = Vue.ref(false);
    const view = runtime.readonly(source);
    expect(Vue.isReadonly(view)).toBe(true);
    source.value = true;
    expect(view.value).toBe(true);
  });

  it('provides toolbar ownership to children using the installed Vue runtime', async () => {
    globalThis[key] = { vue: Vue };
    const runtime = await import('./internal-vue-runtime.js');
    const child = {
      setup() {
        const owner = Vue.inject('sdToolbarOwnerId');
        return () => Vue.h('span', owner);
      },
    };
    const container = document.createElement('div');
    const errors = [];
    const app = Vue.createApp({
      setup() {
        runtime.provide('sdToolbarOwnerId', 'toolbar-owner');
        return () => Vue.h(child);
      },
    });
    app.config.errorHandler = (error) => errors.push(error);
    try {
      app.mount(container);
      expect(errors).toEqual([]);
      expect(container.textContent).toBe('toolbar-owner');
    } finally {
      app.unmount();
    }
  });

  it('binds checkbox and select v-model and renders static markup through the installed runtime', async () => {
    globalThis[key] = { vue: Vue };
    const runtime = await import('./internal-vue-runtime.js');
    const checked = Vue.ref(false);
    const format = Vue.ref('decimal');
    const container = document.createElement('div');
    const app = Vue.createApp({
      render: () => [
        runtime.createStaticVNode('<b>static</b>', 1),
        Vue.withDirectives(
          Vue.h('input', { type: 'checkbox', 'onUpdate:modelValue': (value) => (checked.value = value) }),
          [[runtime.vModelCheckbox, checked.value]],
        ),
        Vue.withDirectives(
          Vue.h('select', { 'onUpdate:modelValue': (value) => (format.value = value) }, [
            Vue.h('option', { value: 'decimal' }, '1, 2, 3'),
            Vue.h('option', { value: 'lowerRoman' }, 'i, ii, iii'),
          ]),
          [[runtime.vModelSelect, format.value]],
        ),
      ],
    });
    app.mount(container);
    expect(container.querySelector('b')?.textContent).toBe('static');
    const checkbox = container.querySelector('input');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    const select = container.querySelector('select');
    select.value = 'lowerRoman';
    select.dispatchEvent(new Event('change'));
    await Vue.nextTick();
    expect(checked.value).toBe(true);
    expect(format.value).toBe('lowerRoman');
    app.unmount();
  });

  it('renders Transition with native slots and metadata for empty and populated children', async () => {
    globalThis[key] = { vue: Vue };
    const runtime = await import('./internal-vue-runtime.js');
    expect(runtime.Transition.length).toBe(Vue.Transition.length);
    expect(runtime.Transition.props).toBe(Vue.Transition.props);
    for (const child of [null, Vue.h('span', 'visible')]) {
      const container = document.createElement('div');
      const errors = [];
      const app = Vue.createApp({ render: () => Vue.h(runtime.Transition, null, { default: () => child }) });
      app.config.errorHandler = (error) => errors.push(error);
      app.mount(container);
      await Vue.nextTick();
      expect(errors).toEqual([]);
      expect(container.textContent).toBe(child ? 'visible' : '');
      app.unmount();
    }
  });
});
