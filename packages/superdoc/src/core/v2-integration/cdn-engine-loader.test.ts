import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const configureDefaultV2IntegrationLoader = vi.fn();

vi.mock('./v2-integration.js', () => ({ configureDefaultV2IntegrationLoader }));

const { configureCdnEngineLoader, loadStylesheetOnce, resolveDocxEngineCdnBaseUrl } =
  await import('./cdn-engine-loader.js');
const loadStateKey = Symbol.for('superdoc.docx-engine.cdn-load-state');

describe('DOCX Engine CDN loader', () => {
  beforeEach(() => {
    configureDefaultV2IntegrationLoader.mockClear();
    delete globalThis[loadStateKey];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.querySelectorAll('link[rel~="stylesheet"]').forEach((link) => link.remove());
  });

  it('accepts self-hosted HTTP and relative base URLs', () => {
    expect(resolveDocxEngineCdnBaseUrl({}, '0.1.0', 'https://cdn.example.test/engine/')).toBe(
      'https://cdn.example.test/engine',
    );
    expect(resolveDocxEngineCdnBaseUrl({}, '0.1.0', './docx-engine/')).toBe('./docx-engine');
  });

  it.each(['data:text/javascript,export default 1', 'javascript:alert(1)', 'file:///tmp/engine'])(
    'rejects the unsupported %s URL scheme',
    (baseUrl) => {
      expect(() => resolveDocxEngineCdnBaseUrl({}, '0.1.0', baseUrl)).toThrow(
        /unsupported DOCX Engine CDN URL scheme/u,
      );
    },
  );

  it('replaces an invalid shared cache value with a Map', async () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
      return node;
    });
    globalThis[loadStateKey] = { polluted: true };
    configureCdnEngineLoader({ engineVersion: '0.1.0', buildBaseUrl: 'https://cdn.example.test/engine' });
    const loader = configureDefaultV2IntegrationLoader.mock.calls[0][0];

    const result = loader();
    expect(globalThis[loadStateKey]).toBeInstanceOf(Map);
    await expect(result).rejects.toThrow();
  });

  it('replaces an unmanaged matching stylesheet link that can no longer report its result', async () => {
    const url = 'https://cdn.example.test/engine/dist-cdn/style.css';
    const staleLink = document.createElement('link');
    staleLink.rel = 'stylesheet';
    staleLink.href = url;
    const removeStaleLink = vi.spyOn(staleLink, 'remove');
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([staleLink]);
    let replacement;
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      replacement = node;
      return node;
    });

    const result = loadStylesheetOnce(url);

    expect(removeStaleLink).toHaveBeenCalledOnce();
    expect(replacement).not.toBe(staleLink);
    expect(replacement.dataset.superdocDocxEngineStatus).toBe('loading');
    replacement.dispatchEvent(new Event('load'));

    await expect(result).resolves.toBeUndefined();
    expect(replacement.dataset.superdocDocxEngineStatus).toBe('loaded');
  });

  it('shares a managed stylesheet request that is still loading', async () => {
    const url = 'https://cdn.example.test/engine/dist-cdn/style.css';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.superdocDocxEngineStatus = 'loading';
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([link]);

    const first = loadStylesheetOnce(url);
    const second = loadStylesheetOnce(url);

    link.dispatchEvent(new Event('load'));

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('retries a managed stylesheet request after a transient failure', async () => {
    const url = 'https://cdn.example.test/engine/dist-cdn/style.css';
    const links = [];
    vi.spyOn(document, 'querySelectorAll').mockImplementation(() => links);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      links.push(node);
      vi.spyOn(node, 'remove').mockImplementation(() => {
        links.splice(links.indexOf(node), 1);
      });
      return node;
    });

    const first = loadStylesheetOnce(url);
    const failedLink = links[0];
    failedLink.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow(/failed to load DOCX Engine styles/u);

    const second = loadStylesheetOnce(url);
    const retryLink = links[0];
    expect(retryLink).not.toBe(failedLink);
    retryLink.dispatchEvent(new Event('load'));

    await expect(second).resolves.toBeUndefined();
  });

  it('clears a rejected engine load so a later initialization can retry', async () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
      return node;
    });
    configureCdnEngineLoader({ engineVersion: '0.1.0', buildBaseUrl: 'https://cdn.example.test/engine' });
    const loader = configureDefaultV2IntegrationLoader.mock.calls[0][0];

    const first = loader();
    await expect(first).rejects.toThrow();
    expect(globalThis[loadStateKey].size).toBe(0);

    const second = loader();
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow();
  });

  it('rejects a loading stylesheet that is removed before it settles', async () => {
    const url = 'https://cdn.example.test/engine/dist-cdn/style.css';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.superdocDocxEngineStatus = 'loading';
    let connected = true;
    vi.spyOn(link, 'isConnected', 'get').mockImplementation(() => connected);
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([link]);

    const result = loadStylesheetOnce(url);
    connected = false;
    const mutation = document.createElement('meta');
    document.head.appendChild(mutation);

    await expect(result).rejects.toThrow(/stylesheet was removed while loading/u);
    mutation.remove();
  });
});
