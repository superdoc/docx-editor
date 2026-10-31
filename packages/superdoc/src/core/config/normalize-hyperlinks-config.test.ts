import { describe, expect, it, vi } from 'vite-plus/test';
import { normalizeHyperlinksConfig } from './normalize-hyperlinks-config.js';

describe('normalizeHyperlinksConfig', () => {
  it('uses SuperDoc mode-aware behavior when no handler is configured', () => {
    expect(normalizeHyperlinksConfig({})).toEqual({
      handler: undefined,
      handlerSource: undefined,
      editableActivationDisabled: false,
      builtInEditorDisabled: false,
      interceptsNavigationOnly: false,
    });
  });

  it('uses hyperlinks.onActivate', () => {
    const onActivate = vi.fn();

    expect(normalizeHyperlinksConfig({ hyperlinks: { onActivate } })).toEqual({
      handler: onActivate,
      handlerSource: 'hyperlinks.onActivate',
      editableActivationDisabled: false,
      builtInEditorDisabled: false,
      interceptsNavigationOnly: true,
    });
  });

  it('prefers hyperlinks.onActivate over both deprecated spellings', () => {
    const onActivate = vi.fn();
    const uiResolver = vi.fn();
    const moduleResolver = vi.fn();

    expect(
      normalizeHyperlinksConfig({
        hyperlinks: { onActivate },
        ui: { linkPopover: { popoverResolver: uiResolver } },
        modules: { links: { popoverResolver: moduleResolver } },
      }).handler,
    ).toBe(onActivate);
  });

  it('keeps the deprecated ui.linkPopover resolver ahead of modules.links', () => {
    const uiResolver = vi.fn();
    const moduleResolver = vi.fn();

    expect(
      normalizeHyperlinksConfig({
        ui: { linkPopover: { popoverResolver: uiResolver } },
        modules: { links: { popoverResolver: moduleResolver } },
      }).handler,
    ).toBe(uiResolver);
  });

  it('still accepts modules.links.popoverResolver', () => {
    const popoverResolver = vi.fn();

    expect(normalizeHyperlinksConfig({ modules: { links: { popoverResolver } } })).toMatchObject({
      handler: popoverResolver,
      handlerSource: 'compatibility',
    });
  });

  it('lets hyperlinks: false suppress every deprecated handler', () => {
    const popoverResolver = vi.fn();

    expect(
      normalizeHyperlinksConfig({
        hyperlinks: false,
        ui: { linkPopover: { popoverResolver } },
        modules: { links: { popoverResolver } },
      }),
    ).toEqual({
      handler: undefined,
      handlerSource: undefined,
      editableActivationDisabled: true,
      builtInEditorDisabled: false,
      interceptsNavigationOnly: true,
    });
  });

  it('preserves deprecated UI suppression when no canonical handler is present', () => {
    const popoverResolver = vi.fn();

    expect(normalizeHyperlinksConfig({ ui: false, modules: { links: { popoverResolver } } })).toEqual({
      handler: undefined,
      handlerSource: undefined,
      editableActivationDisabled: true,
      builtInEditorDisabled: true,
      interceptsNavigationOnly: false,
    });
    expect(normalizeHyperlinksConfig({ ui: { linkPopover: false }, modules: { links: { popoverResolver } } })).toEqual({
      handler: undefined,
      handlerSource: undefined,
      editableActivationDisabled: true,
      builtInEditorDisabled: true,
      interceptsNavigationOnly: false,
    });
  });

  it('keeps a canonical handler active when built-in UI is disabled', () => {
    const onActivate = vi.fn();

    expect(normalizeHyperlinksConfig({ ui: false, hyperlinks: { onActivate } })).toEqual({
      handler: onActivate,
      handlerSource: 'hyperlinks.onActivate',
      editableActivationDisabled: false,
      builtInEditorDisabled: true,
      interceptsNavigationOnly: true,
    });
    expect(normalizeHyperlinksConfig({ ui: { linkPopover: false }, hyperlinks: { onActivate } })).toEqual({
      handler: onActivate,
      handlerSource: 'hyperlinks.onActivate',
      editableActivationDisabled: false,
      builtInEditorDisabled: true,
      interceptsNavigationOnly: true,
    });
  });
});
