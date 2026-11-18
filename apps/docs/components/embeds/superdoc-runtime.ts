'use client';

import runtime from '@/config/editor-demo-runtime.json';
import { runtimeCdnBaseUrl as runtimeBaseUrl, runtimePackageUrl } from '@/lib/editor-runtime-url';

/**
 * Loading the pinned SuperDoc runtime for documentation embeds.
 *
 * Extracted from `editor-demo.tsx` when a second embed needed the same thing.
 * The scope is deliberately narrow: fetch the CDN runtime, its stylesheet, and
 * the UI module, and hand back the constructor. Presentation, fixtures, reset,
 * and fullscreen stay with each embed, because those are where the embeds
 * actually differ.
 *
 * The module-level promises are the reason this is shared rather than copied:
 * two embeds on one page must not race to load the same assets.
 */

const localEngineUrl =
  process.env.NODE_ENV === 'development' ? process.env.NEXT_PUBLIC_DOCS_ENGINE_URL?.replace(/\/+$/, '') : undefined;
const uiModuleUrl = `${runtimePackageUrl}${runtime.uiModulePath}`;

export type SuperDocConstructor = typeof import('superdoc').SuperDoc &
  Pick<typeof import('superdoc'), 'BlankDOCX' | 'createTheme' | 'defineSuperDocExtension'>;
export type SuperDocInstance = InstanceType<SuperDocConstructor>;
export type SuperDocUIModule = Pick<typeof import('superdoc/ui'), 'createSuperDocUI'>;

declare global {
  interface Window {
    SuperDoc?: SuperDocConstructor;
    SUPERDOC_ENGINE_CDN_BASE_URL?: string;
  }
}

let runtimePromise: Promise<SuperDocConstructor> | null = null;
let uiModulePromise: Promise<SuperDocUIModule> | null = null;

function loadRuntimeAsset(element: HTMLLinkElement | HTMLScriptElement) {
  return new Promise<void>((resolve, reject) => {
    element.addEventListener('load', () => resolve(), { once: true });
    element.addEventListener('error', () => reject(new Error(`Could not load ${element.tagName.toLowerCase()}.`)), {
      once: true,
    });
    document.head.append(element);
  });
}

/** Load the pinned runtime once per page and resolve with the constructor. */
export function loadRuntime() {
  if (runtimePromise) return runtimePromise;
  if (localEngineUrl) window.SUPERDOC_ENGINE_CDN_BASE_URL = localEngineUrl;
  if (window.SuperDoc) return Promise.resolve(window.SuperDoc);

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = `${runtimeBaseUrl}/superdoc.min.css`;

  const script = document.createElement('script');
  script.src = `${runtimeBaseUrl}/superdoc.min.js`;
  script.async = true;

  runtimePromise = Promise.all([loadRuntimeAsset(stylesheet), loadRuntimeAsset(script)])
    .then(() => {
      if (!window.SuperDoc) throw new Error('The SuperDoc runtime did not initialize.');
      return window.SuperDoc;
    })
    .catch((error: unknown) => {
      runtimePromise = null;
      stylesheet.remove();
      script.remove();
      window.SuperDoc = undefined;
      throw error;
    });

  return runtimePromise;
}

/** Load the public `superdoc/ui` module from the same pinned package. */
export function loadUIModule() {
  if (uiModulePromise) return uiModulePromise;

  uiModulePromise = import(/* webpackIgnore: true */ uiModuleUrl)
    .then((module: unknown) => {
      const candidate = module as Partial<SuperDocUIModule>;
      if (typeof candidate.createSuperDocUI !== 'function') {
        throw new Error('The SuperDoc UI module did not initialize.');
      }
      return candidate as SuperDocUIModule;
    })
    .catch((error: unknown) => {
      uiModulePromise = null;
      throw error;
    });

  return uiModulePromise;
}
