/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');

const instances: InstanceType<typeof SuperDoc>[] = [];

function createInstance() {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
  instances.push(instance);
  return instance;
}

function attachFontRuntime(instance: InstanceType<typeof SuperDoc>) {
  const map = vi.fn();
  instance.activeEditor = {
    editorVersion: 2,
    fonts: {
      getReport: () => [],
      getMissingFonts: () => [],
      getDocumentFonts: () => [],
      getDocumentFontOptions: () => [],
      getFontFamilyOptions: () => [],
      getLastFontsChangedPayload: () => null,
      map,
      unmap: vi.fn(),
      add: vi.fn(),
      preload: vi.fn(),
    },
  } as never;
  return map;
}

function attachFontRelay(instance: InstanceType<typeof SuperDoc>, editorVersion = 2) {
  let relay: ((payload: { missingFonts?: string[] }) => void) | undefined;
  const editor = {
    editorVersion,
    on: vi.fn((event: string, callback: typeof relay) => {
      if (event === 'fonts-changed') relay = callback;
    }),
    documentRenderer: { getLastFontsChangedPayload: () => null },
  } as never;
  instance.activeEditor = editor;
  Reflect.set(instance, 'superdocStore', { documents: [] });
  instance.broadcastEditorCreate(editor);
  Reflect.deleteProperty(instance, 'superdocStore');
  return (payload: { missingFonts?: string[] }) => relay?.(payload);
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SuperDoc fonts API', () => {
  it('rejects positional map calls instead of forwarding a string', () => {
    const instance = createInstance();
    const map = attachFontRuntime(instance);

    expect(() => Reflect.apply(instance.fonts.map, instance.fonts, ['Aptos', 'Carlito'])).toThrow(
      'superdoc.fonts.map requires a mapping object',
    );
    expect(map).not.toHaveBeenCalled();
  });

  it('forwards the documented object map call', () => {
    const instance = createInstance();
    const map = attachFontRuntime(instance);
    const mappings = { Aptos: 'Carlito' };

    instance.fonts.map(mappings);

    expect(map).toHaveBeenCalledOnce();
    expect(map).toHaveBeenCalledWith(mappings);
  });

  it('warns once for missing v2 fonts on localhost and links to the guide', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const instance = createInstance();
    const report = attachFontRelay(instance);

    report({ missingFonts: ['Aptos'] });
    report({ missingFonts: ['Aptos'] });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Missing document font: "Aptos"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('https://docs.superdoc.dev/editor/fonts/'));
  });

  it('does not emit the v2 warning for legacy editor reports', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const instance = createInstance();
    const report = attachFontRelay(instance, 1);

    report({ missingFonts: ['Aptos'] });

    expect(warn).not.toHaveBeenCalled();
  });
});
