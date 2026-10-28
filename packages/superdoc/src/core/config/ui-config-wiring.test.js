/**
 * The profile has to reach the runtime, not just resolve correctly.
 *
 * `normalize-ui-config.test.js` proves the table. These cases prove the
 * instance exposes it and that the toolbar — the one surface whose mount
 * decision lives in `SuperDoc.ts` rather than the Vue shell — follows it.
 */
import { describe, expect, it, vi } from 'vite-plus/test';
import SuperDocSource from '../../SuperDoc.vue?raw';
import { mergeCommentsConfig } from './merge-comments-config.js';
import { normalizeUiConfig } from './normalize-ui-config.js';
import { mergeDefined } from './merge-defined.js';

describe('uiConfig reaches the runtime', () => {
  describe('toolbar mount decision', () => {
    // Mirrors the `toolbarRequested` gate in SuperDoc#addToolbar. Kept as a
    // pure function so the mount rule can be checked without standing up a
    // document, a DOM, and the v2 engine.
    const toolbarRequested = (config) => {
      const ui = normalizeUiConfig(config);
      const legacy = config.modules?.toolbar;
      return (
        ui.toolbar.enabled &&
        (Boolean(ui.toolbar.container) ||
          legacy === true ||
          (legacy != null && typeof legacy === 'object') ||
          config.ui?.toolbar !== undefined)
      );
    };

    it('does not mount when nothing asks for a toolbar', () => {
      expect(toolbarRequested({ selector: '#e' })).toBe(false);
    });

    it('mounts from the top-level container alias', () => {
      expect(toolbarRequested({ selector: '#e', toolbar: '#t' })).toBe(true);
    });

    it('mounts from ui.toolbar with a container', () => {
      expect(toolbarRequested({ selector: '#e', ui: { toolbar: { container: '#t' } } })).toBe(true);
    });

    it('creates the handle for ui.toolbar: true even with nowhere to render', () => {
      // Matches the documented `modules.toolbar: true` behavior: the
      // `superdoc.toolbar` handle exists so command routing works, but no
      // toolbar appears until a container resolves.
      const config = { selector: '#e', ui: { toolbar: true } };

      expect(toolbarRequested(config)).toBe(true);
      expect(normalizeUiConfig(config).toolbar.container).toBeNull();
    });

    it('does not mount when ui.toolbar is false, even with a container', () => {
      expect(toolbarRequested({ selector: '#e', toolbar: '#t', ui: { toolbar: false } })).toBe(false);
    });

    it('does not mount under ui: false, even with a container', () => {
      expect(toolbarRequested({ selector: '#e', toolbar: '#t', ui: false })).toBe(false);
    });

    it('still mounts from the legacy module block', () => {
      expect(toolbarRequested({ selector: '#e', modules: { toolbar: { selector: '#t' } } })).toBe(true);
    });
  });

  describe('editor options derived from the profile', () => {
    // The shell forwards these three into editor options. Each is a negation
    // or a substitution rather than a pass-through, so they are worth pinning.
    it('disables the context menu when the surface is off', () => {
      expect(normalizeUiConfig({ ui: false }).contextMenu.enabled).toBe(false);
      expect(normalizeUiConfig({ ui: { contextMenu: false } }).contextMenu.enabled).toBe(false);
      expect(normalizeUiConfig({ disableContextMenu: true }).contextMenu.enabled).toBe(false);
    });

    describe('link popover resolver', () => {
      // The value `SuperDoc.vue` hands `useLinkPopover`, read off the profile
      // rather than recomputed here. An earlier version of this block restated
      // the precedence as a local mirror, which is how the same rule passed
      // for content controls while production had stopped reading the
      // canonical option at all.
      const resolverOf = (config) => normalizeUiConfig(config).linkPopover.options.popoverResolver;

      it('leaves an unconfigured surface with no resolver and no veto', () => {
        // `undefined` reads as "no opinion" and renders the built-in popover,
        // which is the default this surface has always had.
        const ui = normalizeUiConfig({ selector: '#e' }).linkPopover;

        expect(ui.options.popoverResolver).toBeUndefined();
        expect(ui.suppressed).toBe(false);
        expect(ui.enabled).toBe(false);
      });

      it('carries a canonical resolver through to the reader', () => {
        const resolver = vi.fn();

        expect(resolverOf({ ui: { linkPopover: { popoverResolver: resolver } } })).toBe(resolver);
        expect(normalizeUiConfig({ ui: { linkPopover: { popoverResolver: resolver } } }).linkPopover.enabled).toBe(
          true,
        );
      });

      it('still honors the legacy spelling on its own', () => {
        const resolver = vi.fn();

        expect(resolverOf({ modules: { links: { popoverResolver: resolver } } })).toBe(resolver);
      });

      it('lets the canonical resolver win over the legacy one', () => {
        const canonical = vi.fn();
        const legacy = vi.fn();

        expect(
          resolverOf({
            ui: { linkPopover: { popoverResolver: canonical } },
            modules: { links: { popoverResolver: legacy } },
          }),
        ).toBe(canonical);
      });

      it('reports an opted-in surface with no resolver as unconfigured', () => {
        // The shape of #1099: `ui.linkPopover: true` turned the surface on and
        // supplied nothing to run, and `enabled` said it was configured. There
        // is no resolver here, so there is nothing to report as one.
        expect(normalizeUiConfig({ ui: { linkPopover: true } }).linkPopover.enabled).toBe(false);
        expect(resolverOf({ ui: { linkPopover: true } })).toBeUndefined();
      });

      it('withholds either spelling when the surface is off', () => {
        const resolver = vi.fn();
        const config = { ui: false, modules: { links: { popoverResolver: resolver } } };

        // A forbidden surface hands back nothing to run; the shell answers
        // `suppressed` with its own closing resolver. The consumer's function
        // is left untouched on the config either way.
        expect(resolverOf(config)).toBeUndefined();
        expect(normalizeUiConfig(config).linkPopover.suppressed).toBe(true);
        expect(config.modules.links.popoverResolver).toBe(resolver);

        expect(
          resolverOf({ ui: { linkPopover: false }, modules: { links: { popoverResolver: resolver } } }),
        ).toBeUndefined();
        expect(resolverOf({ ui: { linkPopover: false } })).toBeUndefined();
      });
    });

    it('forces content-control chrome off rather than passing undefined', () => {
      // `undefined` means "use the default", which renders chrome. Disabling
      // the surface has to resolve to an explicit 'none'.
      expect(normalizeUiConfig({ ui: false }).contentControls.enabled).toBe(false);
      expect(normalizeUiConfig({ ui: { contentControls: false } }).contentControls.enabled).toBe(false);
    });
  });

  describe('comments stay consistent across both spellings', () => {
    it('treats ui.comments: false the same as modules.comments: false', () => {
      expect(normalizeUiConfig({ ui: { comments: false } }).comments.enabled).toBe(false);
      expect(normalizeUiConfig({ modules: { comments: false } }).comments.enabled).toBe(false);
    });

    it('keeps comments on for the default config', () => {
      expect(normalizeUiConfig({ selector: '#e' }).comments.enabled).toBe(true);
    });

    it('panel: false hides the built-in panel and highlights reach the painter separately', async () => {
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      const superdoc = new SuperDoc({ selector, telemetry: { enabled: false }, ui: { comments: { panel: false } } });

      expect(superdoc.config.modules.comments).toBe(false);
      expect(superdoc.uiConfig.comments.highlights).toBe(true);
      expect(SuperDocSource).toContain('commentHighlights: proxy.$superdoc.uiConfig.comments.highlights');
      superdoc.destroy?.();
      document.body.innerHTML = '';
    });
  });

  describe('the legacy comments sentinel still carries policy', () => {
    it('coerces modules.comments: true before assigning the policy', async () => {
      // `Object.assign` onto a primitive silently discards every value, so the
      // `true` sentinel would drop `readOnly` while reporting comments enabled.
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      const superdoc = new SuperDoc({
        selector,
        telemetry: { enabled: false },
        modules: { comments: true },
        interaction: { comments: { readOnly: true } },
      });

      expect(superdoc.config.modules.comments).toMatchObject({ readOnly: true });
      superdoc.destroy?.();
      document.body.innerHTML = '';
    });
  });

  describe('the resolved configs reach the instance', () => {
    // The fields and getters can exist while nothing assigns them, in which case
    // every read returns the empty default — `readOnly` silently false, no
    // resolver. That fails open, so assert against a real instance rather than
    // the normalizers, which pass either way.
    const mount = async (config) => {
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      return new SuperDoc({ selector, telemetry: { enabled: false }, ...config });
    };

    it('exposes the resolved interaction policy', async () => {
      const superdoc = await mount({ interaction: { comments: { readOnly: true, allowResolve: false } } });

      expect(superdoc.interactionConfig.comments.level).toBe('read');
      expect(superdoc.interactionConfig.comments.readOnly).toBe(true);
      expect(superdoc.interactionConfig.comments.allowResolve).toBe(false);
      expect(superdoc.interactionConfig.trackedChanges.allowDecisions).toBe(false);
      superdoc.destroy?.();
      document.body.innerHTML = '';
    });

    it('exposes independent canonical comment and tracked-change capabilities', async () => {
      const superdoc = await mount({
        interaction: { comments: { level: 'read' }, trackedChanges: { allowDecisions: true } },
      });

      expect(superdoc.interactionConfig.comments).toEqual({
        level: 'read',
        readOnly: true,
        allowResolve: false,
      });
      expect(superdoc.interactionConfig.trackedChanges).toEqual({ allowDecisions: true });
      superdoc.destroy?.();
      document.body.innerHTML = '';
    });

    it('wires canonical hyperlink behavior under ui: false without exposing an internal profile', async () => {
      const onActivate = vi.fn();
      const superdoc = await mount({ ui: false, hyperlinks: { onActivate } });

      expect(superdoc.config.hyperlinks).toEqual({ onActivate });
      expect(SuperDocSource).toContain('normalizeHyperlinksConfig(proxy.$superdoc?.config)');
      expect(SuperDocSource).toContain('getActivationHandler: getHyperlinkActivationHandler');
      expect(SuperDocSource).toContain('getActivationHandlerSource: getHyperlinkActivationSource');
      expect(SuperDocSource).toContain('linkPopoverResolver: getHyperlinkActivationHandler()');
      expect(superdoc).not.toHaveProperty('hyperlinksConfig');
      superdoc.destroy?.();
      document.body.innerHTML = '';
    });

    it('exposes the resolved surfaces config', async () => {
      const resolver = () => ({ type: 'none' });
      const superdoc = await mount({ surfaces: { resolver, dialog: { maxWidth: 480 } } });

      expect(superdoc.surfacesConfig.resolver).toBe(resolver);
      expect(superdoc.surfacesConfig.dialog).toMatchObject({ maxWidth: 480 });
      superdoc.destroy?.();
      document.body.innerHTML = '';
    });
  });

  describe('the context-menu toggle survives a remount', () => {
    // Mirrors what `editorOptions` forwards. It is re-evaluated per document,
    // so reading only the profile would revert `setDisableContextMenu()` on
    // every remount — the same shape as the ruler bug.
    // `#init` seeds the live flag from the profile, so the OR starts from the
    // profile's answer rather than the raw consumer value. `live` is what a
    // later `setDisableContextMenu()` would have written.
    const seed = (config) => !normalizeUiConfig(config).contextMenu.enabled;
    const forwarded = (config, live = seed(config)) => !normalizeUiConfig(config).contextMenu.enabled || live === true;

    it('honors a post-mount disable under the default profile', () => {
      expect(forwarded({ selector: '#e' })).toBe(false);
      expect(forwarded({ selector: '#e' }, true)).toBe(true);
    });

    it('does not let a leftover legacy flag re-disable an explicit opt-in', () => {
      // The hazard the seed exists for: ORing the raw consumer value back in
      // would undo `ui.contextMenu: true` for anyone mid-migration.
      expect(forwarded({ ui: { contextMenu: true }, disableContextMenu: true })).toBe(false);
      expect(forwarded({ disableContextMenu: true })).toBe(true);
    });

    it('will not let setDisableContextMenu re-enable a forbidden surface', async () => {
      // The seed makes `config.disableContextMenu` true under `ui: false`, so
      // the early-return in the setter is what stops `setDisableContextMenu(false)`
      // from pushing `false` to every live editor and undoing the veto.
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      const superdoc = new SuperDoc({ selector, telemetry: { enabled: false }, ui: false });

      expect(superdoc.config.disableContextMenu).toBe(true);
      superdoc.setDisableContextMenu(false);
      expect(superdoc.config.disableContextMenu).toBe(true);

      superdoc.destroy?.();
      document.body.innerHTML = '';
    });

    it('still lets a legacy disableContextMenu instance re-enable at runtime', async () => {
      // The legacy flag was a starting value, not a veto: an instance created
      // with `disableContextMenu: true` could always turn its context menu
      // back on, and the guard must not take that away.
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      const superdoc = new SuperDoc({ selector, telemetry: { enabled: false }, disableContextMenu: true });

      expect(superdoc.config.disableContextMenu).toBe(true);
      superdoc.setDisableContextMenu(false);
      expect(superdoc.config.disableContextMenu).toBe(false);

      superdoc.destroy?.();
      document.body.innerHTML = '';
    });

    it('still lets a permitted surface be toggled both ways', async () => {
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } });

      superdoc.setDisableContextMenu(true);
      expect(superdoc.config.disableContextMenu).toBe(true);
      superdoc.setDisableContextMenu(false);
      expect(superdoc.config.disableContextMenu).toBe(false);

      superdoc.destroy?.();
      document.body.innerHTML = '';
    });

    it('seeds the live flag on a real instance rather than adopting the raw value', async () => {
      // The cases above model the seed, so they cannot see it go missing.
      // This asserts the instance actually performs it: without the seed,
      // `config.disableContextMenu` stays the consumer's `true` and the OR in
      // `editorOptions` re-disables a surface `ui.contextMenu: true` enabled.
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      const superdoc = new SuperDoc({
        selector,
        telemetry: { enabled: false },
        ui: { contextMenu: true },
        disableContextMenu: true,
      });

      expect(superdoc.config.disableContextMenu).toBe(false);
      superdoc.destroy?.();
      document.body.innerHTML = '';
    });

    it('keeps a forbidden surface disabled regardless of the live value', () => {
      expect(forwarded({ ui: false }, false)).toBe(true);
      expect(forwarded({ ui: { contextMenu: false } }, false)).toBe(true);
    });
  });

  describe('the ruler veto leaves the runtime toggle reachable', () => {
    // Mirrors the profile check in `shouldShowV2Ruler`. It runs before the
    // live `doc.rulers` state that `toggleRuler()` writes, so vetoing on
    // `enabled` would make the toolbar button inert for every consumer who
    // never set `rulers`.
    const vetoed = (config) => normalizeUiConfig(config).ruler.suppressed;

    it('does not veto the default profile, where the toggle starts off', () => {
      expect(vetoed({ selector: '#e' })).toBe(false);
      expect(normalizeUiConfig({ selector: '#e' }).ruler.enabled).toBe(false);
    });

    it('does not veto an explicit rulers: false, which the toggle can flip', () => {
      expect(vetoed({ rulers: false })).toBe(false);
    });

    it('vetoes only when the consumer forbade the surface', () => {
      expect(vetoed({ ui: { ruler: false } })).toBe(true);
      expect(vetoed({ ui: false })).toBe(true);
    });
  });

  // Each of these covers a consumer that used to read `modules.*` directly.
  // Resolving correctly was never the gap: the profile already held the right
  // answer and nothing asked it for one, so canonical config typechecked and
  // then did nothing at runtime. The normalizer cases below fix precedence;
  // the instance and composable cases prove the value actually arrives, which
  // is the part a mirrored helper cannot show.
  describe('canonical options reach the surface that renders them', () => {
    const mountInstance = async (config) => {
      const { SuperDoc } = await import('../SuperDoc.js');
      const selector = document.createElement('div');
      document.body.append(selector);
      return new SuperDoc({ selector, telemetry: { enabled: false }, ...config });
    };

    const cleanup = (superdoc) => {
      superdoc?.destroy?.();
      document.body.innerHTML = '';
    };

    describe('context menu items', () => {
      const section = (id) => ({ id, items: [{ id: `${id}-item`, label: id }] });
      const forwarded = (config) => normalizeUiConfig(config).contextMenu.options;

      it('carries canonical items on a real instance', async () => {
        const superdoc = await mountInstance({
          ui: { contextMenu: { openOnSlash: false, defaultItems: false, sections: [section('app')] } },
        });

        // What `editorOptions().contextMenuConfig` forwards to the v2 shell,
        // which passes it to `resolveSections`.
        expect(superdoc.uiConfig.contextMenu.options.sections).toEqual([section('app')]);
        expect(superdoc.uiConfig.contextMenu.options.defaultItems).toBe(false);
        expect(superdoc.uiConfig.contextMenu.options.openOnSlash).toBe(false);
        cleanup(superdoc);
      });

      it('forwards resolved interaction policy to the v2 shell', () => {
        expect(SuperDocSource).toContain('interaction: proxy.$superdoc.interactionConfig');
      });

      it('normalizes deprecated fields from both legacy module locations', () => {
        expect(forwarded({ modules: { contextMenu: { customItems: [section('app')] } } })).toEqual({
          sections: [section('app')],
        });
        expect(forwarded({ modules: { slashMenu: { customItems: [section('app')] } } })).toEqual({
          sections: [section('app')],
        });
      });

      it('normalizes deprecated fields from the canonical UI location', () => {
        expect(
          forwarded({
            ui: { contextMenu: { customItems: [section('app')], includeDefaultItems: false } },
          }),
        ).toEqual({ sections: [section('app')], defaultItems: false });
      });

      it('lets canonical fields win over deprecated fields in one source', () => {
        expect(
          forwarded({
            ui: {
              contextMenu: {
                sections: [section('new')],
                customItems: [section('old')],
                defaultItems: true,
                includeDefaultItems: false,
              },
            },
          }),
        ).toEqual({ sections: [section('new')], defaultItems: true });
      });

      it('keeps canonical UI precedence during a partial field migration', () => {
        expect(
          forwarded({
            modules: { contextMenu: { sections: [section('old')], defaultItems: false } },
            ui: { contextMenu: { customItems: [section('new')], includeDefaultItems: true } },
          }),
        ).toEqual({ sections: [section('new')], defaultItems: true });
      });

      it('carries no items when the surface is off', () => {
        expect(forwarded({ ui: false, modules: { contextMenu: { customItems: [section('app')] } } })).toEqual({});
      });

      it('treats the boolean legacy forms as carrying no items', () => {
        expect(forwarded({ modules: { contextMenu: true } })).toEqual({});
      });
    });

    describe('find and replace', () => {
      // Driven through the real composable rather than a mirror of the getter.
      // `ui.search: true` passed the gate that draws the toolbar's Search
      // button and failed the one that opens the panel, so asserting on
      // `wouldOpen()` is what distinguishes a rendered-but-inert button from a
      // working surface.
      const drive = async (config) => {
        const { useFindReplace } = await import('../../composables/use-find-replace.js');
        const superdoc = await mountInstance(config);
        const findReplace = useFindReplace({
          getSurfaceManager: () => ({ open: () => ({ id: 's', close() {}, result: new Promise(() => {}) }) }),
          // A live search session, so `wouldOpen` reflects only the config.
          getActiveEditor: () => ({ editorVersion: 2, commands: null }),
          getSuperDocUI: () => ({ search: { find() {}, getSnapshot: () => ({ available: true }) } }),
          // The expression under test, copied from `SuperDoc.vue`.
          getFindReplaceConfig: () => (superdoc.uiConfig.search.enabled ? superdoc.uiConfig.search.options : false),
        });
        return { superdoc, findReplace };
      };

      it('opens for the canonical switch alone', async () => {
        const { superdoc, findReplace } = await drive({ ui: { search: true } });
        expect(findReplace.wouldOpen()).toBe(true);
        cleanup(superdoc);
      });

      it('opens for the legacy switch alone', async () => {
        const { superdoc, findReplace } = await drive({ modules: { surfaces: { findReplace: true } } });
        expect(findReplace.wouldOpen()).toBe(true);
        cleanup(superdoc);
      });

      it('stays closed when unset, or when either spelling is turned off', async () => {
        for (const config of [
          {},
          { ui: { search: false }, modules: { surfaces: { findReplace: true } } },
          { ui: false, modules: { surfaces: { findReplace: true } } },
        ]) {
          const { superdoc, findReplace } = await drive(config);
          expect(findReplace.wouldOpen()).toBe(false);
          cleanup(superdoc);
        }
      });

      it('carries options from either spelling, canonical winning', () => {
        const resolved = (config) => {
          const ui = normalizeUiConfig(config);
          return ui.search.enabled ? ui.search.options : false;
        };
        expect(resolved({ ui: { search: { replaceControls: false } } })).toEqual({ replaceEnabled: false });
        expect(resolved({ modules: { surfaces: { findReplace: { replaceEnabled: false } } } })).toEqual({
          replaceEnabled: false,
        });
        expect(
          resolved({
            modules: { surfaces: { findReplace: { replaceEnabled: false, includeDeletedText: true } } },
            ui: { search: { replaceEnabled: true } },
          }),
        ).toEqual({ replaceEnabled: true, includeDeletedText: true });
      });
    });

    describe('comment presentation', () => {
      // `commentsModuleConfig` merges the profile's presentation options over
      // the live `modules.comments` block, so the assertion is on that merge:
      // presentation arrives, and the policy the runtime assigned survives it.
      const merged = (superdoc) =>
        mergeCommentsConfig(superdoc.config.modules.comments, superdoc.uiConfig.comments.options);

      it('carries the canonical layout and responsive settings to the UI', async () => {
        const superdoc = await mountInstance({
          ui: { comments: { layout: 'auto', responsive: { target: '#workspace', breakpoint: 1200 } } },
        });
        expect(merged(superdoc)).toMatchObject({
          layout: 'auto',
          responsive: { target: '#workspace', breakpoint: 1200 },
        });
        cleanup(superdoc);
      });

      it('combines responsive settings while each field is migrated independently', async () => {
        const legacyTarget = await mountInstance({
          modules: { comments: { compactMeasurementSelector: '#legacy-workspace' } },
          ui: { comments: { responsive: { breakpoint: 1200 } } },
        });
        expect(merged(legacyTarget).responsive).toEqual({ target: '#legacy-workspace', breakpoint: 1200 });
        cleanup(legacyTarget);

        const legacyBreakpoint = await mountInstance({
          modules: { comments: { compactBreakpointPx: 960 } },
          ui: { comments: { responsive: { target: '#workspace' } } },
        });
        expect(merged(legacyBreakpoint).responsive).toEqual({ target: '#workspace', breakpoint: 960 });
        cleanup(legacyBreakpoint);
      });

      it('prefers canonical responsive settings when both spellings set the same field', async () => {
        const superdoc = await mountInstance({
          modules: {
            comments: {
              compactMeasurementSelector: '#legacy-workspace',
              compactBreakpointPx: 960,
            },
          },
          ui: { comments: { responsive: { target: '#workspace', breakpoint: 1200 } } },
        });

        expect(merged(superdoc).responsive).toEqual({ target: '#workspace', breakpoint: 1200 });
        cleanup(superdoc);
      });

      it('validates the canonical spelling the same way the legacy block is validated', async () => {
        const superdoc = await mountInstance({ ui: { comments: { layout: 'bogus' } } });
        expect(merged(superdoc).layout).toBeUndefined();
        cleanup(superdoc);

        const bad = normalizeUiConfig({ ui: { comments: { responsive: { breakpoint: -1 } } } });
        expect(bad.comments.options).toEqual({});
      });

      it('never lets a ui-bucket policy value outrank the resolved policy', async () => {
        // `readOnly`, `allowResolve`, and `permissionResolver` decide what a
        // user may do and resolve through the interaction profile. A copy in
        // the presentation bag would win the merge and silently override it.
        const permissionResolver = () => true;
        const superdoc = await mountInstance({
          interaction: { comments: { readOnly: false, allowResolve: true } },
          ui: { comments: { layout: 'auto', readOnly: true, allowResolve: false, permissionResolver } },
        });

        expect(superdoc.uiConfig.comments.options).toEqual({ layout: 'auto' });

        const view = merged(superdoc);
        expect(view.readOnly).toBe(false);
        expect(view.allowResolve).toBe(true);
        expect(view.permissionResolver).toBeUndefined();
        cleanup(superdoc);
      });

      it('carries nothing when built-in comments are off', () => {
        expect(
          normalizeUiConfig({ ui: false, modules: { comments: { displayMode: 'auto' } } }).comments.options,
        ).toEqual({});
      });
    });

    describe('content controls', () => {
      // The value `SuperDoc.vue` hands the layout engine as
      // `contentControlsChrome`, read straight off the profile rather than
      // recomputed here. An earlier version of this block restated the
      // precedence rule as a local mirror, which passed just as well after
      // production stopped reading the canonical option at all. The cases in
      // `normalize-ui-config.test.js` stop at `enabled`, and `chrome` is the
      // whole option bag this surface has.
      //
      // Precedence only. That the value then reaches the painter is the one
      // thing this file cannot show — the reader is a single property access
      // with no branch to catch — so it is asserted in the browser by
      // `tests/behavior/tests/sdt/canonical-ui-content-controls-chrome.spec.ts`.
      //
      // `'default'` and `'none'` are the entire value space: `V2HostMountOptions`
      // and the painter both type it `'default' | 'none'` and coerce anything
      // else. A style like `'outline'` would assert that an unsupported value
      // survives normalization, which is not a promise worth pinning while
      // `ui.contentControls` is still `Record<string, unknown>` (#1094).
      const chrome = (config) => normalizeUiConfig(config).contentControls.options.chrome;

      it('draws the default chrome when nobody expressed an opinion', () => {
        // `undefined` is not "off" here: it means the layout engine keeps its
        // own default, which renders chrome.
        expect(chrome({ selector: '#e' })).toBeUndefined();
      });

      it('forces chrome off rather than passing undefined when the surface is off', () => {
        expect(chrome({ ui: false })).toBe('none');
        expect(chrome({ ui: { contentControls: false } })).toBe('none');
        expect(chrome({ modules: { contentControls: { chrome: 'none' } } })).toBe('none');
      });

      it('carries a canonical chrome style through to the reader', async () => {
        expect(chrome({ ui: { contentControls: { chrome: 'default' } } })).toBe('default');

        // And on a real instance, because a surface whose options never get
        // assigned would leave `uiConfig` an empty object that a normalizer
        // call on its own cannot distinguish.
        const superdoc = await mountInstance({ ui: { contentControls: { chrome: 'default' } } });
        expect(superdoc.uiConfig.contentControls.options.chrome).toBe('default');
        cleanup(superdoc);
      });

      it('does not let a leftover legacy none win over an explicit opt-in', () => {
        // The hazard the normalizer comment names: `'none'` is the legacy
        // disable sentinel, already consumed by `enabled`, so a consumer
        // mid-migration keeps their chrome instead of losing it to a value
        // they thought they had overridden.
        expect(
          chrome({ ui: { contentControls: true }, modules: { contentControls: { chrome: 'none' } } }),
        ).toBeUndefined();
      });

      it('still honors a legacy chrome style the profile did not veto', () => {
        expect(chrome({ modules: { contentControls: { chrome: 'default' } } })).toBe('default');
      });
    });

    describe('ruler', () => {
      it('shows the ruler for the canonical switch alone', async () => {
        // `config.rulers` is the live visibility state every document copies.
        // Resolving `ui.ruler` without seeding it left the ruler hidden until
        // something toggled the legacy flag.
        const superdoc = await mountInstance({ ui: { ruler: true } });
        expect(superdoc.config.rulers).toBe(true);
        cleanup(superdoc);
      });

      it('shows the ruler when only a canonical container is given', async () => {
        const superdoc = await mountInstance({ ui: { ruler: { container: '#ruler' } } });
        expect(superdoc.config.rulers).toBe(true);
        expect(superdoc.uiConfig.ruler.container).toBe('#ruler');
        cleanup(superdoc);
      });

      it('still honors the legacy flag, and lets the canonical veto win', async () => {
        const legacy = await mountInstance({ rulers: true });
        expect(legacy.config.rulers).toBe(true);
        cleanup(legacy);

        const vetoed = await mountInstance({ ui: { ruler: false }, rulers: true });
        expect(vetoed.config.rulers).toBe(false);
        expect(vetoed.uiConfig.ruler.container).toBe(null);
        cleanup(vetoed);
      });

      it('resolves the canonical container over the legacy alias', () => {
        expect(
          normalizeUiConfig({ ui: { ruler: { container: '#new' } }, rulerContainer: '#old' }).ruler.container,
        ).toBe('#new');
        expect(normalizeUiConfig({ rulerContainer: '#old' }).ruler.container).toBe('#old');
      });
    });
  });
});
