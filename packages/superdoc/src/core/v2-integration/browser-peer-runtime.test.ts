import { describe, it, expect } from 'vite-plus/test';
import * as Vue from 'vue';

import {
  installSuperDocV2BrowserRuntime,
  readSuperDocV2BrowserRuntime,
  SUPERDOC_V2_BROWSER_RUNTIME_GLOBAL_KEY,
} from './browser-peer-runtime.js';

describe('browser peer runtime', () => {
  it('installs the host Vue runtime on a well-known global', () => {
    const runtime = installSuperDocV2BrowserRuntime();
    expect(runtime.vue).toBe(Vue);
    expect(readSuperDocV2BrowserRuntime()).toBe(runtime);
    expect(globalThis[SUPERDOC_V2_BROWSER_RUNTIME_GLOBAL_KEY]).toBe(runtime);
  });

  it('merges explicit fields without dropping the shared Vue runtime', () => {
    const runtime = installSuperDocV2BrowserRuntime({ custom: { ok: true } });
    expect(runtime.custom).toEqual({ ok: true });
    expect(runtime.vue).toBe(Vue);
  });

  it.each([
    ['an array', []],
    ['a string', 'runtime'],
  ])('treats %s on the runtime global as no installed runtime', (_label, stored) => {
    const globalObject = { [SUPERDOC_V2_BROWSER_RUNTIME_GLOBAL_KEY]: stored };
    expect(readSuperDocV2BrowserRuntime(globalObject)).toBeNull();
    const runtime = installSuperDocV2BrowserRuntime({}, globalObject);
    expect(Object.keys(runtime)).toEqual(['vue']);
    expect(runtime.vue).toBe(Vue);
    expect(globalObject[SUPERDOC_V2_BROWSER_RUNTIME_GLOBAL_KEY]).toBe(runtime);
  });
});
