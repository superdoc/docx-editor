'use client';

import runtime from '@/config/editor-demo-runtime.json';
import type { Config } from 'superdoc';

/**
 * Loading the pinned SuperDoc runtime for documentation embeds.
 *
 * Extracted from `editor-demo.tsx` when a second embed needed the same thing.
 * The scope is deliberately narrow: fetch the CDN runtime, its stylesheet, the
 * engine workers, and the UI module, and hand back the constructor. Presentation,
 * fixtures, reset, and fullscreen stay with each embed, because those are where
 * the embeds actually differ.
 *
 * The module-level promises are the reason this is shared rather than copied:
 * two embeds on one page must not race to load the same assets.
 */

const runtimePackageUrl = `${runtime.cdnOrigin}/${runtime.runtimePackage}@${runtime.runtimeVersion}`;
const runtimeBaseUrl = `${runtimePackageUrl}/dist-cdn`;
const localEngineUrl =
  process.env.NODE_ENV === 'development' ? process.env.NEXT_PUBLIC_DOCS_ENGINE_URL?.replace(/\/+$/, '') : undefined;
const engineBaseUrl = `${localEngineUrl || `${runtime.cdnOrigin}/${runtime.enginePackage}@${runtime.engineVersion}`}/dist-cdn`;
const uiModuleUrl = `${runtimePackageUrl}${runtime.uiModulePath}`;

export type SuperDocConstructor = typeof import('superdoc').SuperDoc &
  Pick<typeof import('superdoc'), 'BlankDOCX' | 'createTheme' | 'defineSuperDocExtension'>;
export type SuperDocInstance = InstanceType<SuperDocConstructor>;
export type SuperDocUIModule = Pick<typeof import('superdoc/ui'), 'createSuperDocUI'>;

declare global {
  interface Window {
    SuperDoc?: SuperDocConstructor;
    __SUPERDOC_V2_BROWSER_WORKER_URL__?: string;
    SUPERDOC_ENGINE_CDN_BASE_URL?: string;
  }
}

let runtimePromise: Promise<SuperDocConstructor> | null = null;
let uiModulePromise: Promise<SuperDocUIModule> | null = null;
let runtimeWorkerUrls: NonNullable<Config['workerUrls']> | null = null;
let workerConfigurationPromise: Promise<void> | null = null;
let workerObjectUrls: string[] = [];

const workerAssetPrefixes = {
  document: 'assets/browser-worker-entry-',
  collaboration: 'assets/collaboration-worker-entry-',
  reviewIndex: 'assets/review-index-worker-entry-',
} as const satisfies Record<keyof NonNullable<Config['workerUrls']>, string>;

function hasPath(value: unknown): value is { path: string } {
  return typeof value === 'object' && value !== null && 'path' in value && typeof value.path === 'string';
}

async function configureWorkersOnce() {
  const response = await fetch(`${engineBaseUrl}/manifest.json`);
  if (!response.ok) throw new Error(`Engine manifest request failed with ${response.status}.`);

  const manifest: unknown = await response.json();
  if (typeof manifest !== 'object' || manifest === null || !('files' in manifest) || !Array.isArray(manifest.files)) {
    throw new Error('The engine manifest has an unsupported shape.');
  }
  const files: unknown[] = manifest.files;

  runtimeWorkerUrls = Object.fromEntries(
    Object.entries(workerAssetPrefixes).map(([kind, prefix]) => {
      const worker = files.find((file) => hasPath(file) && file.path.startsWith(prefix));
      if (!hasPath(worker)) throw new Error(`The engine manifest does not include its ${kind} worker.`);

      const workerModuleUrl = new URL(worker.path, `${engineBaseUrl}/`).href;
      const objectUrl = URL.createObjectURL(
        new Blob([`import ${JSON.stringify(workerModuleUrl)};`], { type: 'application/javascript' }),
      );
      workerObjectUrls.push(objectUrl);
      return [kind, objectUrl];
    }),
  ) as NonNullable<Config['workerUrls']>;
  window.__SUPERDOC_V2_BROWSER_WORKER_URL__ = runtimeWorkerUrls.document?.toString();
}

function configureWorkers() {
  if (runtimeWorkerUrls) return Promise.resolve();
  if (workerConfigurationPromise) return workerConfigurationPromise;

  workerConfigurationPromise = configureWorkersOnce()
    .catch((error: unknown) => {
      resetConfiguredWorkers();
      throw error;
    })
    .finally(() => {
      workerConfigurationPromise = null;
    });
  return workerConfigurationPromise;
}

function resetConfiguredWorkers() {
  for (const objectUrl of workerObjectUrls) URL.revokeObjectURL(objectUrl);
  if (window.__SUPERDOC_V2_BROWSER_WORKER_URL__ === runtimeWorkerUrls?.document) {
    window.__SUPERDOC_V2_BROWSER_WORKER_URL__ = undefined;
  }
  workerObjectUrls = [];
  runtimeWorkerUrls = null;
}

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
  if (window.SuperDoc) return configureWorkers().then(() => window.SuperDoc!);

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = `${runtimeBaseUrl}/superdoc.min.css`;

  const script = document.createElement('script');
  script.src = `${runtimeBaseUrl}/superdoc.min.js`;
  script.async = true;

  runtimePromise = Promise.all([loadRuntimeAsset(stylesheet), loadRuntimeAsset(script)])
    .then(() => configureWorkers())
    .then(() => {
      if (!window.SuperDoc) throw new Error('The SuperDoc runtime did not initialize.');
      return window.SuperDoc;
    })
    .catch((error: unknown) => {
      // Clear every cached handle so a retry re-attempts the whole load rather
      // than resolving against a half-initialized runtime.
      runtimePromise = null;
      stylesheet.remove();
      script.remove();
      window.SuperDoc = undefined;
      resetConfiguredWorkers();
      throw error;
    });

  return runtimePromise;
}

/** Same-origin-safe worker URLs prepared for the pinned cross-origin engine. */
export function getRuntimeWorkerUrls(): NonNullable<Config['workerUrls']> {
  if (!runtimeWorkerUrls) throw new Error('The SuperDoc runtime workers are not ready.');
  return runtimeWorkerUrls;
}

/** Construct an embed with the worker URLs prepared by {@link loadRuntime}. */
export function createRuntimeEditor(SuperDoc: SuperDocConstructor, config: Config): SuperDocInstance {
  return new SuperDoc({ ...config, workerUrls: getRuntimeWorkerUrls() });
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
