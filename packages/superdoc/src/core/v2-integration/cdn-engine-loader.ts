import { configureDefaultV2IntegrationLoader } from './v2-integration.js';

const ENGINE_CDN_OVERRIDE = 'SUPERDOC_ENGINE_CDN_BASE_URL';
const ENGINE_CDN_LOAD_STATE = Symbol.for('superdoc.docx-engine.cdn-load-state');
const ENGINE_STYLESHEET_STATUS = 'superdocDocxEngineStatus';

export function resolveDocxEngineCdnBaseUrl(
  globalObject: object,
  engineVersion: string,
  buildOverride: string | null = null,
): string {
  const runtimeOverride: unknown = Reflect.get(globalObject, ENGINE_CDN_OVERRIDE);
  const override = typeof runtimeOverride === 'string' && runtimeOverride.trim() ? runtimeOverride : buildOverride;
  if (typeof override === 'string' && override.trim()) return normalizeCdnBaseUrl(override);
  if (!engineVersion) throw new Error('SuperDoc: the CDN build is missing its exact DOCX Engine version');
  return `https://cdn.jsdelivr.net/npm/@superdoc/docx-engine@${engineVersion}`;
}

function normalizeCdnBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  const scheme = normalized.match(/^([a-z][a-z\d+.-]*):/iu)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    throw new TypeError(`SuperDoc: unsupported DOCX Engine CDN URL scheme ${scheme}:`);
  }
  return normalized;
}

export function configureCdnEngineLoader({
  engineVersion,
  buildBaseUrl,
}: {
  engineVersion: string;
  buildBaseUrl: string | null;
}): void {
  configureDefaultV2IntegrationLoader(() => {
    const baseUrl = resolveDocxEngineCdnBaseUrl(globalThis, engineVersion, buildBaseUrl);
    const existingState: unknown = Reflect.get(globalThis, ENGINE_CDN_LOAD_STATE);
    const state: Map<string, Promise<unknown>> = existingState instanceof Map ? existingState : new Map();
    Reflect.set(globalThis, ENGINE_CDN_LOAD_STATE, state);
    const existingLoad = state.get(baseUrl);
    if (existingLoad) return existingLoad;
    const load: Promise<unknown> = Promise.all([
      import(/* @vite-ignore */ `${baseUrl}/dist-cdn/docx-engine.es.js`),
      loadStylesheetOnce(`${baseUrl}/dist-cdn/style.css`),
    ]).then(([engineModule]) => engineModule);
    state.set(baseUrl, load);
    void load.catch(() => {
      if (state.get(baseUrl) === load) state.delete(baseUrl);
    });
    return load;
  });
}

export function loadStylesheetOnce(url: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const absoluteUrl = new URL(url, document.baseURI).href;
  const existing = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')).find(
    (link) => link.href === absoluteUrl,
  );
  if (existing?.sheet || existing?.dataset[ENGINE_STYLESHEET_STATUS] === 'loaded') {
    return Promise.resolve();
  }
  const reusableLink = existing?.dataset[ENGINE_STYLESHEET_STATUS] === 'loading' ? existing : null;
  if (existing && !reusableLink) existing.remove();

  return new Promise((resolve, reject) => {
    const link = reusableLink ?? document.createElement('link');
    let settled = false;
    let observer: MutationObserver | undefined;
    const settle = (status: 'loaded' | 'error', callback: () => void) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      link.dataset[ENGINE_STYLESHEET_STATUS] = status;
      callback();
    };
    const handleLoad = () => settle('loaded', resolve);
    const handleError = () =>
      settle('error', () => reject(new Error(`SuperDoc: failed to load DOCX Engine styles from ${absoluteUrl}`)));
    const handleRemoval = () => {
      if (!link.isConnected) {
        settle('error', () =>
          reject(new Error(`SuperDoc: DOCX Engine stylesheet was removed while loading from ${absoluteUrl}`)),
        );
      }
    };
    link.addEventListener('load', handleLoad, { once: true });
    link.addEventListener('error', handleError, { once: true });
    if (typeof globalThis.MutationObserver === 'function') {
      observer = new globalThis.MutationObserver(handleRemoval);
      observer.observe(document.head, { childList: true });
    }
    if (!reusableLink) {
      link.rel = 'stylesheet';
      link.href = absoluteUrl;
      link.dataset.superdocDocxEngine = 'true';
      link.dataset[ENGINE_STYLESHEET_STATUS] = 'loading';
      document.head.appendChild(link);
    }
  });
}
