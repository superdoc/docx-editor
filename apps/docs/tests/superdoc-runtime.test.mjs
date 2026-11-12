import assert from 'node:assert/strict';
import { test } from 'node:test';

function installRuntimePage(context, { failScriptAttempts = 0 } = {}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  context.after(() => {
    restore(globalThis, 'window', originalWindow);
    restore(globalThis, 'document', originalDocument);
    restore(globalThis, 'fetch', originalFetch);
  });

  const page = { window: {}, appended: [], removed: [], fetchCount: 0, scriptAttempts: 0 };

  Object.defineProperty(globalThis, 'window', { configurable: true, value: page.window });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      page.fetchCount += 1;
      throw new Error('The runtime loader must not fetch anything.');
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tagName) {
        const listeners = new Map();
        return {
          tagName: tagName.toUpperCase(),
          addEventListener(type, listener) {
            listeners.set(type, listener);
          },
          dispatch(type) {
            listeners.get(type)?.();
          },
          remove() {
            page.removed.push(tagName);
          },
        };
      },
      head: {
        append(element) {
          page.appended.push(element.tagName);
          if (element.tagName === 'LINK') {
            queueMicrotask(() => element.dispatch('load'));
            return;
          }

          page.scriptAttempts += 1;
          if (page.scriptAttempts <= failScriptAttempts) {
            setTimeout(() => element.dispatch('error'), 0);
            return;
          }

          page.window.SuperDoc = class SuperDoc {};
          setTimeout(() => element.dispatch('load'), 0);
        },
      },
    },
  });

  return page;
}

test('a failed runtime script is removed and the next load retries it without fetching an engine manifest', async (context) => {
  const page = installRuntimePage(context, { failScriptAttempts: 1 });
  const { loadRuntime } = await import('../components/embeds/superdoc-runtime.ts?retry');

  await assert.rejects(loadRuntime(), /Could not load script/u);
  assert.equal(page.window.SuperDoc, undefined);
  assert.deepEqual(page.removed.sort(), ['link', 'script']);

  const constructor = await loadRuntime();
  assert.equal(constructor, page.window.SuperDoc);
  assert.equal(page.scriptAttempts, 2);
  assert.equal(page.fetchCount, 0);
});

test('concurrent embeds share one runtime load', async (context) => {
  const page = installRuntimePage(context);
  const { loadRuntime } = await import('../components/embeds/superdoc-runtime.ts?concurrent');

  const [first, second] = await Promise.all([loadRuntime(), loadRuntime()]);

  assert.equal(first, page.window.SuperDoc);
  assert.equal(second, page.window.SuperDoc);
  assert.deepEqual(page.appended, ['LINK', 'SCRIPT']);
  assert.equal(page.fetchCount, 0);
});

test('a runtime already on the page is reused without loading assets', async (context) => {
  const page = installRuntimePage(context);
  page.window.SuperDoc = class SuperDoc {};
  const { loadRuntime } = await import('../components/embeds/superdoc-runtime.ts?existing');

  assert.equal(await loadRuntime(), page.window.SuperDoc);
  assert.deepEqual(page.appended, []);
  assert.equal(page.fetchCount, 0);
});

function restore(target, property, descriptor) {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else delete target[property];
}
