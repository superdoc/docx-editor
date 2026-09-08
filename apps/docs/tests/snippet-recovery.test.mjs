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
