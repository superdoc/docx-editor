#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { npmDistRoot } = require('./build-output-paths.cjs');

const dom = new JSDOM('<!doctype html><div id="host"></div>', { pretendToBeVisual: true });
dom.window.HTMLCanvasElement.prototype.getContext = function getInertCanvas2dContext(contextType) {
  return contextType === '2d' ? createInertCanvas2dContext(this) : null;
};
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = dom.window[key];
    } catch {}
  }
}

const entries = {
  es: () => import(pathToFileURL(path.join(npmDistRoot, 'superdoc.es.js')).href),
  cjs: async () => require(path.join(npmDistRoot, 'superdoc.cjs')),
};

const failures = [];
for (const [format, load] of Object.entries(entries)) {
  try {
    const { SuperDoc } = await load();
    const superdoc = new SuperDoc({ selector: '#host', documents: [], modules: { whiteboard: { enabled: true } } });
    const whiteboard = await waitFor(() => superdoc.whiteboard);
    whiteboard.setPageSize(0, { width: 20, height: 20 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    whiteboard.getPage(0).mount(container);
    if (!container.querySelector('.konvajs-content canvas')) throw new Error('mount produced no Konva canvas');
  } catch (error) {
    failures.push(`${format}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error('[smoke-npm-whiteboard] whiteboard page did not mount:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[smoke-npm-whiteboard] ES and CommonJS builds mount a whiteboard page');
process.exit(0);

function createInertCanvas2dContext(canvas) {
  const ignoreDrawingCall = () => undefined;
  return new Proxy(
    { canvas },
    {
      get: (state, key) => (key in state || typeof key !== 'string' ? state[key] : ignoreDrawingCall),
    },
  );
}

async function waitFor(read) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('SuperDoc did not create its whiteboard');
}
