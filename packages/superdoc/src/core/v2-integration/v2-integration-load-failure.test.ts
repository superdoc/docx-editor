import { describe, expect, it, vi } from 'vite-plus/test';

describe('loadDefaultV2IntegrationOrFallback', () => {
  it('keeps the fail-closed stub available when the engine cannot load', async () => {
    vi.resetModules();
    const integrationModule = await import('./v2-integration.js');
    const loadError = new Error('engine unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    integrationModule.configureDefaultV2IntegrationLoader(() => Promise.reject(loadError));

    await expect(integrationModule.loadDefaultV2IntegrationOrFallback()).resolves.toBeUndefined();
    expect(integrationModule.hasRealV2Integration(integrationModule.createDefaultV2Integration())).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('[SuperDoc] DOCX Engine failed to load; using the stub.', loadError);

    consoleError.mockRestore();
  });

  it('retries the engine loader after a transient failure', async () => {
    vi.resetModules();
    const integrationModule = await import('./v2-integration.js');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce({
        createSuperDocV2Integration: () => ({ version: 2, EditorComponent: { name: 'EngineEditor' } }),
      });

    integrationModule.configureDefaultV2IntegrationLoader(loader);

    await integrationModule.loadDefaultV2IntegrationOrFallback();
    expect(integrationModule.hasRealV2Integration(integrationModule.createDefaultV2Integration())).toBe(false);

    await integrationModule.loadDefaultV2Integration();
    expect(integrationModule.hasRealV2Integration(integrationModule.createDefaultV2Integration())).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2);

    consoleError.mockRestore();
  });
});
