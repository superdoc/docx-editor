import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';

async function loadSnippet(name, imports, globals = {}) {
  const source = await readFile(new URL(`../snippets/editor/${name}`, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const require = (id) => {
    if (id.endsWith('.css')) return {};
    assert.ok(id in imports, `Unexpected snippet import: ${id}`);
    return imports[id];
  };
  new Function('require', 'exports', ...Object.keys(globals), javascript)(
    require, exports, ...Object.values(globals),
  );
  return exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function lifecycleMarkup() {
  const page = await readFile(new URL('../content/docs/editor/lifecycle-and-events.mdx', import.meta.url), 'utf8');
  assert.match(page, /`sample-edited\.docx`/u);
  return page.match(/```html\n([\s\S]*?)```/u)[1];
}

test('lifecycle preview preserves clean exports, dirty exports, and retry navigation', async (t) => {
  const window = new Window();
  const globalNames = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of globalNames) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] ?? window });
  }
  const root = createRoot(window.document.body);
  t.after(async () => {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const { LifecycleJourney } = await loadSnippet('../../components/embeds/lifecycle-journey.tsx', {
    react: React,
    'react/jsx-runtime': await import('react/jsx-runtime'),
    'lucide-react': Object.fromEntries(['Check', 'FileText', 'Play', 'RotateCcw', 'Square'].map((name) => [name, () => null])),
    'fumadocs-ui/components/dynamic-codeblock': { DynamicCodeBlock: () => null },
    '@/lib/lifecycle-journey': await import('../lib/lifecycle-journey.ts'),
  });
  await React.act(async () => root.render(React.createElement(LifecycleJourney)));
  const app = () => window.document.querySelector('.sd-lifecycle-preview');
  const exportButton = () => app().querySelector('button');
  const status = () => app().querySelector('output');
  const choose = async (label) => React.act(async () => [...window.document.querySelectorAll('.sd-lifecycle-nav button')].find((button) => button.querySelector('strong')?.textContent === label).click());
  assert.equal(exportButton().disabled, true);
  await choose('Ready');
  await React.act(async () => exportButton().click());
  assert.equal(status().textContent.trim(), 'Ready');
  assert.equal(status().dataset.tone, 'ready');
  assert.match(app().textContent, /DOCX copy downloaded/u);
  await React.act(async () => exportButton().click());
  assert.equal(status().textContent.trim(), 'Ready');
  await choose('Edit');
  await React.act(async () => exportButton().click());
  assert.equal(status().textContent.trim(), 'Unsaved changes');
  assert.equal(status().dataset.tone, 'dirty');
  assert.match(app().textContent, /DOCX copy downloaded/u);
  assert.doesNotMatch(app().textContent, /Saved to your backend/u);
  await choose('Load fails');
  await React.act(async () => [...app().querySelectorAll('button')].find((button) => button.textContent.includes('Retry')).click());
  assert.equal(exportButton().disabled, true);
  assert.equal(status().textContent.trim(), 'Opening…');
});

test('lifecycle example gates export, preserves edits, and cleans up pending work', async () => {
  const window = new Window();
  window.document.body.innerHTML = await lifecycleMarkup();
  const button = window.document.querySelector('#export-docx');
  const status = window.document.querySelector('#editor-status');
  const pending = deferred();
  let config;
  let exports = 0;
  let destroyed = 0;
  const { unmountEditor } = await loadSnippet('editor-lifecycle.ts', {
    superdoc: {
      SuperDoc: class {
        constructor(value) {
          assert.ok(window.document.querySelector(value.selector));
          config = value;
        }
        export(options) {
          assert.deepEqual(options, { exportedName: 'sample-edited' });
          exports += 1;
          return pending.promise;
        }
        destroy() { destroyed += 1; }
      },
    },
  }, { document: window.document });

  button.dispatchEvent(new window.Event('click'));
  assert.equal(exports, 0);
  config.onReady();
  assert.equal(button.disabled, false);
  config.onEditorUpdate();
  assert.equal(status.value, 'Unsaved changes');
  button.dispatchEvent(new window.Event('click'));
  button.dispatchEvent(new window.Event('click'));
  assert.equal(exports, 1);
  assert.equal(button.disabled, true);
  assert.equal(status.value, 'Unsaved changes');

  unmountEditor();
  config.onReady();
  pending.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(button.disabled, true);
  assert.equal(destroyed, 1);
  button.dispatchEvent(new window.Event('click'));
  assert.equal(exports, 1);
  window.close();
});

test('lifecycle example reports opening and export failures without claiming a save', async () => {
  const window = new Window();
  window.document.body.innerHTML = await lifecycleMarkup();
  let config;
  const errors = [];
  const { unmountEditor } = await loadSnippet('editor-lifecycle.ts', {
    superdoc: { SuperDoc: class {
      constructor(value) { config = value; }
      async export() { throw new Error('Export rejected'); }
      destroy() {}
    } },
  }, { document: window.document, console: { error: (...args) => errors.push(args) } });
  const button = window.document.querySelector('#export-docx');
  const status = window.document.querySelector('#editor-status');
  for (const callback of [config.onContentError, config.onException]) {
    callback({ error: new Error('Missing document') });
    assert.equal(status.value, 'Could not open the document');
    assert.equal(button.disabled, true);
  }
  config.onReady();
  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.value, 'Export failed. Try again.');
  assert.equal(button.disabled, false);
  assert.equal(errors.length, 3);
  unmountEditor();
  window.close();
});

test('lifecycle export retries restore the current document state', async () => {
  for (const editTiming of ['never', 'before-failure', 'during-retry']) {
    const window = new Window();
    window.document.body.innerHTML = await lifecycleMarkup();
    const button = window.document.querySelector('#export-docx');
    const status = window.document.querySelector('#editor-status');
    const pending = deferred();
    let config;
    let exports = 0;
    const { unmountEditor } = await loadSnippet('editor-lifecycle.ts', {
      superdoc: { SuperDoc: class {
        constructor(value) { config = value; }
        async export() {
          if (++exports === 1) throw new Error('Export rejected');
          return pending.promise;
        }
        destroy() {}
      } },
    }, { document: window.document, console: { error() {} } });
    config.onReady();
    if (editTiming === 'before-failure') config.onEditorUpdate();
    button.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(status.value, 'Export failed. Try again.');
    button.click();
    if (editTiming === 'during-retry') config.onEditorUpdate();
    pending.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(status.value, editTiming === 'never' ? 'Ready' : 'Unsaved changes', editTiming);
    assert.equal(button.disabled, false);
    assert.equal(exports, 2);
    unmountEditor();
    window.close();
  }
});

test('export guide examples select download, bytes, and paired attachments', async () => {
  const page = await readFile(new URL('../content/docs/editor/export-options.mdx', import.meta.url), 'utf8');
  const examples = [...page.matchAll(/```ts\n([\s\S]*?)```/gu)].map((match) => match[1]);
  assert.equal(examples.length, 4);
  const allCalls = [];
  const superdoc = { export: async (options) => { allCalls.push(options); return new Blob(['docx']); } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const example of examples.slice(1)) {
    await new AsyncFunction('superdoc', example)(superdoc);
    await new AsyncFunction('editorRef', `${examples[0]}\n${example}`)({ current: { getInstance: () => superdoc } });
    await new AsyncFunction('editorRef', `${examples[0]}\n${example}`)({ current: null });
  }
  assert.equal(allCalls.length, 6);
  assert.deepEqual(allCalls[0], allCalls[1]);
  assert.deepEqual(allCalls[2], allCalls[3]);
  assert.deepEqual(allCalls[4], allCalls[5]);
  const calls = allCalls.filter((_, index) => index % 2 === 0);
  assert.deepEqual(calls.slice(0, 2), [
    { exportedName: 'sample-edited' },
    { triggerDownload: false },
  ]);
  const bundle = calls[2];
  assert.equal(bundle.exportedName, 'sample-edited');
  assert.equal(bundle.triggerDownload, false);
  assert.deepEqual(bundle.additionalFileNames, ['metadata.json']);
  assert.equal(bundle.additionalFiles.length, 1);
  assert.equal(bundle.additionalFiles[0].type, 'application/json');
  assert.deepEqual(JSON.parse(await bundle.additionalFiles[0].text()), { document: 'sample-edited' });
});

test('version saves reject a stale base and preserve its conflict message', async () => {
  const requests = [];
  const { saveVersion } = await loadSnippet('editor-version-history.ts', { superdoc: { DOCX: 'application/docx' } }, {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(null, { status: 409 });
    },
  });
  const docx = new Blob(['edited snapshot']);
  await assert.rejects(saveVersion({ export: async () => docx }, 'version-1'), /A newer version exists/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers['x-base-version-id'], 'version-1');
  assert.equal(requests[0].options.body, docx);
});

test('a rejected version restore reloads current server content', async () => {
  const opened = [];
  const requests = [];
  const { restoreVersion } = await loadSnippet('editor-version-history.ts', { superdoc: { DOCX: 'application/docx' } }, {
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (options?.method === 'POST') return new Response(null, { status: 409 });
      return new Response(url.endsWith('/versions/version-1') ? 'version one' : 'current server version');
    },
  });
  const editor = {
    export: async () => new Blob(['active document']),
    replaceFile: async (blob) => {
      opened.push(await blob.text());
      return { state: 'editing-ready' };
    },
  };
  await assert.rejects(restoreVersion(editor, 'version-1', 'version-2'), /A newer version exists/);
  assert.deepEqual(opened, ['version one', 'current server version']);
  assert.equal(requests[1].options.headers['x-restored-from-version-id'], 'version-1');
  assert.equal(requests[1].options.headers['x-base-version-id'], 'version-2');
});

for (const failure of ['network', 'status', 'body']) {
  test(`a rejected restore recovers the active document after a recovery ${failure} failure`, async () => {
    const opened = [];
    const { restoreVersion } = await loadSnippet('editor-version-history.ts', { superdoc: { DOCX: 'application/docx' } }, {
      fetch: async (url, options) => {
        if (options?.method === 'POST') return new Response(null, { status: 409 });
        if (url.endsWith('/versions/version-1')) return new Response('version one');
        if (failure === 'network') throw new Error('Offline');
        if (failure === 'status') return new Response(null, { status: 500 });
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error('Broken stream')); } }));
      },
    });
    const editor = {
      export: async () => new Blob(['active document']),
      replaceFile: async (blob) => {
        opened.push(await blob.text());
        return { state: 'editing-ready' };
      },
    };
    await assert.rejects(restoreVersion(editor, 'version-1', 'version-2'), /A newer version exists/);
    assert.deepEqual(opened, ['version one', 'active document']);
  });
}

async function loadingApp(t) {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  window.document.body.innerHTML = await readFile(new URL('../snippets/editor/custom-loading.html', import.meta.url), 'utf8');
  let config;
  let replacement;
  await loadSnippet('custom-loading.ts', {
    superdoc: { SuperDoc: class {
      constructor(options) { config = options; }
      replaceFile() { return replacement.promise; }
      destroy() {}
    } },
  }, { window, document: window.document, console: { error() {} } });
  const picker = window.document.querySelector('input');
  return {
    config,
    picker,
    editor: window.document.querySelector('#editor'),
    status: window.document.querySelector('#document-status'),
    replace() {
      replacement = deferred();
      Object.defineProperty(picker, 'files', { configurable: true, value: [new window.File(['bad'], 'sample.docx')] });
      picker.dispatchEvent(new window.Event('change'));
      return replacement;
    },
  };
}

test('loading exceptions do not hide a ready Editor or replace progress with a diagnostic', async (t) => {
  const app = await loadingApp(t);
  const runtimeErrors = [
    { itemName: 'bold', error: new Error('Command failed') },
    { source: 'hyperlinks.onActivate', error: new Error('Link failed') },
    { diagnosticCode: 'UNSUPPORTED_FEATURE', severity: 'warn', error: new Error('Warning') },
  ];
  for (const payload of runtimeErrors) {
    app.config.onException(payload);
    assert.equal(app.status.textContent, 'Opening document…');
  }
  app.config.onReady();
  for (const payload of runtimeErrors) {
    app.config.onException(payload);
    assert.equal(app.editor.hidden, false);
    assert.equal(app.picker.disabled, false);
  }
});

test('loading failures report an initial failure and allow retrying a replacement', async (t) => {
  const app = await loadingApp(t);
  app.config.onException({ stage: 'document-init', error: new Error('Fetch failed') });
  assert.match(app.status.textContent, /Reload the page/u);
  app.config.onReady();
  for (const outcome of ['reject', 'failed-state']) {
    const replacement = app.replace();
    assert.equal(app.picker.disabled, true);
    if (outcome === 'reject') replacement.reject(new Error('Invalid ZIP'));
    else replacement.resolve({ state: 'failed' });
    await React.act(async () => {});
    assert.equal(app.picker.disabled, false, 'replacement failure must leave the picker usable');
    assert.match(app.status.textContent, /Choose another DOCX/u);
    const retry = app.replace();
    retry.resolve({ state: 'editing-ready' });
    await React.act(async () => {});
    assert.equal(app.editor.hidden, false);
    assert.equal(app.picker.disabled, false);
  }
});

async function fieldApp(t, framework) {
  const window = new Window();
  const globalNames = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of globalNames) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] ?? window });
  }
  let cleanup = () => {};
  t.after(async () => {
    await cleanup();
    await window.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const field = { id: 'approval', controlType: 'checkbox', lockMode: 'unlocked', properties: { alias: 'Review', checked: false }, target: {} };
  const snapshot = { status: 'ready', items: [field], total: 1, activeIds: [], activeId: null };
  const reads = [];
  let mutation;
  let observe;
  const ui = { contentControls: {
    getSnapshot: () => snapshot,
    observe(callback) { observe = callback; callback(snapshot); return () => {}; },
  } };
  const host = { ui, activeEditor: { doc: { contentControls: {
    list() { const read = deferred(); reads.push(read); return read.promise; },
    checkbox: { setState: () => mutation?.promise ?? Promise.resolve({ success: true }) },
  } } } };
  if (framework === 'Vanilla') {
    window.document.body.innerHTML = '<p id="fields-count"></p><ul id="field-list"></ul><p id="fields-status"></p>';
    let config;
    await loadSnippet('custom-content-controls.ts', { superdoc: { SuperDoc: class {
      constructor(options) { config = options; }
      destroy() {}
    } } }, { window, document: window.document });
    config.onReady({ superdoc: host });
    cleanup = () => window.dispatchEvent(new window.Event('beforeunload'));
  } else {
    const jsxRuntime = await import('react/jsx-runtime');
    const { default: App } = await loadSnippet('react-custom-content-controls.tsx', {
      react: React,
      'react/jsx-runtime': jsxRuntime,
      '@superdoc/react': { SuperDocEditor: () => null },
      'superdoc/ui/react': {
        SuperDocUIProvider: ({ children }) => children,
        useSetSuperDoc: () => () => {},
        useSuperDocHost: () => host,
        useSuperDocUI: () => ui,
      },
    });
    const root = createRoot(window.document.body);
    await React.act(async () => root.render(React.createElement(App)));
    cleanup = () => React.act(async () => root.unmount());
  }
  await React.act(async () => reads[0].resolve({ items: [field], total: 1 }));
  return {
    reads,
    holdMutation() { mutation = deferred(); return mutation; },
    checkbox: () => window.document.querySelector('input[type="checkbox"]'),
    status: () => window.document.querySelector(framework === 'Vanilla' ? '#fields-status' : '[role="status"]').textContent,
    async update() { await React.act(async () => window.document.querySelector('input').click()); },
    async notify() { await React.act(async () => observe(snapshot)); },
    async finish(read, success) {
      await React.act(async () => {
        if (success) read.resolve({ items: [{ ...field, properties: { ...field.properties, checked: true } }], total: 1 });
        else read.reject(new Error('Catalog unavailable'));
      });
    },
  };
}

for (const framework of ['Vanilla', 'React']) {
  test(`${framework} field controls stay locked until the mutation receipt settles`, async (t) => {
    const app = await fieldApp(t, framework);
    const mutation = app.holdMutation();
    await app.update();
    await app.notify();
    await app.finish(app.reads[1], false);
    assert.equal(app.checkbox().disabled, true);
    await React.act(async () => mutation.resolve({ success: true }));
    await app.finish(app.reads[2], true);
    assert.equal(app.checkbox().disabled, false);
    assert.equal(app.checkbox().checked, true);
  });

  test(`${framework} field controls recover when the newest observer read fails`, async (t) => {
    const app = await fieldApp(t, framework);
    await app.update();
    assert.equal(app.checkbox().disabled, true);
    await app.notify();
    assert.equal(app.reads.length, 3);
    await app.finish(app.reads[2], false);
    await app.finish(app.reads[1], true);
    assert.equal(app.checkbox().disabled, false);
    assert.match(app.status(), /could not be refreshed/u);
    await app.notify();
    await app.finish(app.reads[3], true);
    assert.equal(app.checkbox().checked, true);
  });

  test(`${framework} field controls ignore a superseded failure while a newer read is pending`, async (t) => {
    const app = await fieldApp(t, framework);
    await app.update();
    await app.notify();
    await app.finish(app.reads[1], false);
    assert.equal(app.checkbox().disabled, true);
    assert.match(app.status(), /Updating/u);
    await app.finish(app.reads[2], true);
    assert.equal(app.checkbox().disabled, false);
    assert.equal(app.checkbox().checked, true);
    assert.equal(app.status(), 'Review checked.');
  });
}
