import * as Vue from 'vue';
import { isPlainObject } from '../../helpers/object-guards.js';

export const SUPERDOC_V2_BROWSER_RUNTIME_GLOBAL_KEY = '__SUPERDOC_V2_BROWSER_RUNTIME__';

type SuperDocV2BrowserRuntime = Record<string, unknown>;

function readInstalledRuntime(globalObject: object = globalThis): SuperDocV2BrowserRuntime | null {
  const installed: unknown = Reflect.get(globalObject, SUPERDOC_V2_BROWSER_RUNTIME_GLOBAL_KEY);
  return isPlainObject(installed) ? installed : null;
}

export function readSuperDocV2BrowserRuntime(globalObject: object = globalThis): SuperDocV2BrowserRuntime | null {
  return readInstalledRuntime(globalObject);
}

export function installSuperDocV2BrowserRuntime(
  runtime: SuperDocV2BrowserRuntime = {},
  globalObject: object = globalThis,
): SuperDocV2BrowserRuntime {
  const installed = readInstalledRuntime(globalObject) ?? {};
  const nextRuntime = {
    ...installed,
    ...runtime,
    vue: runtime.vue ?? installed.vue ?? Vue,
  };
  Reflect.set(globalObject, SUPERDOC_V2_BROWSER_RUNTIME_GLOBAL_KEY, nextRuntime);
  return nextRuntime;
}

installSuperDocV2BrowserRuntime();
