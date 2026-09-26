/**
 * The truth table for built-in UI configuration.
 *
 * The migration's whole risk is that "omitted `ui`" stops meaning what it
 * means today. These cases pin the current profile, including the parts that
 * are not symmetrical, so a later refactor cannot quietly normalize them away.
 */
import { describe, expect, it } from 'vite-plus/test';
import { BUILT_IN_SURFACES, normalizeUiConfig } from './normalize-ui-config.js';

describe('normalizeUiConfig', () => {
  it('normalizes opt-in Watermark composition, icon and text overrides', () => {
    const options = normalizeUiConfig({
      ui: {
        toolbar: {
          items: { right: ['watermark'] },
          includeItems: ['watermark'],
          icons: { watermark: '<svg />' },
          strings: { watermark: 'Document watermark' },
        },
      },
    }).toolbar.options;
    expect(options.showWatermarkButton).toBe(true);
    expect(options.groups).toEqual({ right: ['watermark'] });
    expect(options.icons.watermark).toBe('<svg />');
    expect(options.texts.watermark).toBe('Document watermark');
    expect(
      normalizeUiConfig({ ui: { toolbar: { includeItems: ['watermark'] } } }).toolbar.options.showWatermarkButton,
    ).toBe(true);
    expect(normalizeUiConfig({ ui: { toolbar: true } }).toolbar.options.showWatermarkButton).toBe(false);
  });
  describe('omitted ui preserves the historical profile', () => {
    it('renders comments, the context menu, and content-control chrome', () => {
      const ui = normalizeUiConfig({});

      expect(ui.enabled).toBe(true);
      expect(ui.comments.enabled).toBe(true);
      expect(ui.contextMenu.enabled).toBe(true);
      expect(ui.contentControls.enabled).toBe(true);
    });

    it('draws the loading overlay', () => {
      expect(normalizeUiConfig({}).loading.enabled).toBe(true);
    });

    it('leaves the opt-in surfaces off', () => {
      const ui = normalizeUiConfig({});

      expect(ui.search.enabled).toBe(false);
      expect(ui.linkPopover.enabled).toBe(false);
      expect(ui.ruler.enabled).toBe(false);
    });

    it('keeps the toolbar mountable but without a target', () => {
      // The asymmetry worth stating outright: the toolbar is "enabled" yet
      // renders nothing, because rendering needs a container. Callers must
      // check both, exactly as the current runtime does.
      const ui = normalizeUiConfig({});

      expect(ui.toolbar.enabled).toBe(true);
      expect(ui.toolbar.container).toBeNull();
    });
  });

  describe('ui: false', () => {
    it('disables every built-in surface', () => {
      const ui = normalizeUiConfig({ ui: false });

      expect(ui.enabled).toBe(false);
      for (const surface of BUILT_IN_SURFACES) {
        expect(ui[surface].enabled, `${surface} should be disabled`).toBe(false);
      }
    });

    it('turns the loading overlay off through either spelling', () => {
      // The surface has no legacy field, so these two inputs are the whole
      // truth table for disabling it.
      expect(normalizeUiConfig({ ui: false }).loading.enabled).toBe(false);
      expect(normalizeUiConfig({ ui: { loading: false } }).loading.enabled).toBe(false);
      // An unrelated surface opting out must not take the loader with it.
      expect(normalizeUiConfig({ ui: { comments: false } }).loading.enabled).toBe(true);
      expect(normalizeUiConfig({ ui: { loading: true } }).loading.enabled).toBe(true);
    });

    it('reports no toolbar container or options', () => {
      // `enabled` already gates every caller, but handing back a live mount
      // target for a surface that cannot render invites acting on it.
      const ui = normalizeUiConfig({ ui: false, toolbar: '#bar', toolbarIcons: { bold: 'B' } });

      expect(ui.toolbar.container).toBeNull();
      expect(ui.toolbar.options).toEqual({});
    });

    it('reports no ruler mount target either', () => {
      expect(normalizeUiConfig({ ui: false, rulerContainer: '#r' }).ruler.container).toBeNull();
      expect(normalizeUiConfig({ ui: { ruler: false }, rulerContainer: '#r' }).ruler.container).toBeNull();
    });

    it('wins over legacy fields that would otherwise enable a surface', () => {
      // Someone flipping `ui: false` on an existing config must not keep
      // chrome alive through config they forgot to delete.
      const ui = normalizeUiConfig({
        ui: false,
        toolbar: '#toolbar',
        rulers: true,
        modules: {
          surfaces: { findReplace: true },
          links: { popoverResolver: () => null },
        },
      });

      expect(ui.toolbar.enabled).toBe(false);
      expect(ui.ruler.enabled).toBe(false);
      expect(ui.search.enabled).toBe(false);
      expect(ui.linkPopover.enabled).toBe(false);
    });
  });

  describe('selective ui', () => {
    it('disables one surface without touching its siblings', () => {
      const ui = normalizeUiConfig({ ui: { comments: false } });

      expect(ui.comments.enabled).toBe(false);
      expect(ui.contextMenu.enabled).toBe(true);
      expect(ui.contentControls.enabled).toBe(true);
    });

    it('enables an opt-in surface without enabling the others', () => {
      const ui = normalizeUiConfig({ ui: { search: true } });

      expect(ui.search.enabled).toBe(true);
      expect(ui.linkPopover.enabled).toBe(false);
      expect(ui.ruler.enabled).toBe(false);
    });

    it('treats an options object as opting in', () => {
      const ui = normalizeUiConfig({ ui: { toolbar: { container: '#bar' } } });

      expect(ui.toolbar.enabled).toBe(true);
      expect(ui.toolbar.container).toBe('#bar');
    });

    it('accepts an element as a toolbar container', () => {
      const element = { nodeType: 1 };
      const ui = normalizeUiConfig({ ui: { toolbar: { container: element } } });

      expect(ui.toolbar.container).toBe(element);
    });
  });

  describe('canonical toolbar options', () => {
    it('maps the public names to the existing toolbar runtime', () => {
      const onSelect = () => 'saved';
      const options = normalizeUiConfig({
        ui: {
          toolbar: {
            items: {
              left: ['undo', 'redo'],
              center: ['font-family', 'bold', 'document-mode', 'table-of-contents'],
            },
            excludeItems: ['table-actions'],
            includeItems: ['formatting-marks'],
            icons: { 'text-color': '<svg />' },
            strings: { 'document-mode-editing': 'Write' },
            overflow: 'visible',
            responsiveTo: 'container',
            fontOptions: [{ value: 'Inter', label: 'Inter', previewFamily: 'Inter, sans-serif' }],
            customItems: [
              {
                type: 'button',
                id: 'save',
                label: 'Save',
                region: 'right',
                size: 'compact',
                onSelect,
              },
            ],
          },
        },
      }).toolbar.options;

      expect(options.groups).toEqual({
        left: ['undo', 'redo'],
        center: ['fontFamily', 'bold', 'documentMode', 'tableOfContents'],
        right: ['formattingMarks'],
      });
      expect(options.excludeItems).toEqual(['tableActions']);
      expect(options.icons).toEqual({ color: '<svg />' });
      expect(options.texts).toEqual({ documentEditingMode: 'Write' });
      expect(options.hideButtons).toBe(false);
      expect(options.responsiveToContainer).toBe(true);
      expect(options.fonts).toEqual([
        { key: 'Inter', value: 'Inter', label: 'Inter', props: { style: { fontFamily: 'Inter, sans-serif' } } },
      ]);
      expect(options.showFormattingMarksButton).toBe(true);
      expect(options.showTableOfContentsButton).toBe(true);
      expect(options.customButtons[0]).toMatchObject({
        type: 'button',
        name: 'save',
        label: 'Save',
        defaultLabel: 'Save',
        group: 'right',
        isNarrow: true,
        isWide: false,
        layoutWidth: 32,
        style: { width: '30px' },
      });
      expect(options.customButtons[0]).not.toHaveProperty('id');
      expect(options.customButtons[0]).not.toHaveProperty('onSelect');

      const context = { item: {}, argument: 42, option: { id: 'row' }, documentMode: 'editing' };
      expect(options.customButtons[0].command(context)).toBe('saved');
    });

    it('keeps font labels separate from the values written to the document', () => {
      const options = normalizeUiConfig({
        ui: {
          toolbar: {
            fontOptions: [{ value: 'Arial', label: 'Corporate Sans', previewFamily: 'Arial, sans-serif' }],
          },
        },
      }).toolbar.options;

      expect(options.fonts).toEqual([
        {
          key: 'Arial',
          value: 'Arial',
          label: 'Corporate Sans',
          props: { style: { fontFamily: 'Arial, sans-serif' } },
        },
      ]);
    });

    it('places included controls in their built-in regions for an explicit item layout', () => {
      const options = normalizeUiConfig({
        ui: {
          toolbar: {
            items: { left: ['undo'], center: ['table-of-contents'] },
            includeItems: ['table-of-contents', 'formatting-marks'],
          },
        },
      }).toolbar.options;

      expect(options.groups).toEqual({
        left: ['undo'],
        center: ['tableOfContents'],
        right: ['formattingMarks'],
      });
      expect(options.showFormattingMarksButton).toBe(true);
      expect(options.showTableOfContentsButton).toBe(true);
    });

    it('applies canonical additions to a legacy item layout during migration', () => {
      const options = normalizeUiConfig({
        ui: {
          toolbar: {
            includeItems: ['table-of-contents'],
            customItems: [{ type: 'button', id: 'save', label: 'Save', region: 'right', onSelect: () => {} }],
          },
        },
        modules: { toolbar: { groups: { left: ['undo'], center: ['tableOfContents'] } } },
      }).toolbar.options;

      expect(options.groups).toEqual({
        left: ['undo'],
        center: ['tableOfContents'],
        right: [],
      });
      expect(options.customButtons[0]).toMatchObject({ name: 'save', group: 'right' });
    });

    it('lets canonical items replace deprecated group selection', () => {
      const options = normalizeUiConfig({
        ui: { toolbar: { items: { center: ['bold'], right: ['document-mode'] } } },
        modules: { toolbar: { groups: ['left'] } },
        toolbarGroups: ['left'],
      }).toolbar.options;

      expect(options.groups).toEqual({ center: ['bold'], right: ['documentMode'] });
      expect(options.toolbarGroups).toEqual(['center', 'right']);
    });

    it('treats an empty items map as an empty allowlist', () => {
      const options = normalizeUiConfig({ ui: { toolbar: { items: {} } } }).toolbar.options;

      expect(options.groups).toEqual({ center: [] });
      expect(options.toolbarGroups).toEqual(['center']);
    });

    it('maps dropdown values into the current selection contract', () => {
      const onSelect = (context) => context;
      const [item] = normalizeUiConfig({
        ui: {
          toolbar: {
            customItems: [
              {
                type: 'dropdown',
                id: 'status',
                label: 'Status',
                options: [
                  { id: 'draft', label: 'Draft' },
                  { id: 'approved', label: 'Approved', value: 2 },
                ],
                onSelect,
              },
            ],
          },
        },
      }).toolbar.options.customButtons;

      expect(item).toMatchObject({
        name: 'status',
        defaultLabel: 'Status',
        dropdownValueKey: 'value',
        options: [
          { id: 'draft', label: 'Draft', key: 'draft', value: 'draft' },
          { id: 'approved', label: 'Approved', key: 2, value: 2 },
        ],
      });

      expect(item.command({ item: {}, argument: 2, option: item.options[1], documentMode: 'editing' })).toMatchObject({
        value: 2,
        option: { id: 'approved' },
        documentMode: 'editing',
      });
      expect(item.attributes.ariaLabel).toBe('Status');
    });

    it('keeps an explicit custom-item accessible name', () => {
      const [item] = normalizeUiConfig({
        ui: {
          toolbar: {
            customItems: [
              {
                type: 'dropdown',
                id: 'status',
                label: 'Status',
                attributes: { ariaLabel: 'Review status' },
                options: [{ id: 'draft', label: 'Draft' }],
                onSelect: () => {},
              },
            ],
          },
        },
      }).toolbar.options.customButtons;

      expect(item.attributes.ariaLabel).toBe('Review status');
    });

    it('prefers canonical names when deprecated names are also present', () => {
      const options = normalizeUiConfig({
        ui: {
          toolbar: {
            items: { center: ['bold'] },
            groups: { center: ['italic'] },
            icons: { color: 'deprecated', 'text-color': 'canonical' },
            strings: { bold: 'Strong' },
            texts: { bold: 'Legacy' },
            overflow: 'menu',
            hideButtons: false,
            responsiveTo: 'viewport',
            responsiveToContainer: true,
            includeItems: [],
            showFormattingMarksButton: true,
            showTableOfContentsButton: true,
          },
        },
      }).toolbar.options;

      expect(options.groups).toEqual({ center: ['bold'] });
      expect(options.icons.color).toBe('canonical');
      expect(options.texts.bold).toBe('Strong');
      expect(options.hideButtons).toBe(true);
      expect(options.responsiveToContainer).toBe(false);
      expect(options.showFormattingMarksButton).toBe(false);
      expect(options.showTableOfContentsButton).toBe(false);
    });

    it('keeps deprecated toolbar names operational', () => {
      const options = normalizeUiConfig({
        ui: {
          toolbar: {
            groups: { center: ['fontFamily'] },
            texts: { documentEditingMode: 'Write' },
            hideButtons: false,
            responsiveToContainer: true,
            fonts: [{ key: 'Inter', label: 'Inter' }],
            customButtons: [{ type: 'button', name: 'save', icon: '<svg />' }],
            showFormattingMarksButton: true,
            showTableOfContentsButton: true,
          },
        },
      }).toolbar.options;

      expect(options).toMatchObject({
        groups: { center: ['fontFamily'] },
        texts: { documentEditingMode: 'Write' },
        hideButtons: false,
        responsiveToContainer: true,
        fonts: [{ key: 'Inter', label: 'Inter' }],
        customButtons: [{ type: 'button', name: 'save', icon: '<svg />' }],
        showFormattingMarksButton: true,
        showTableOfContentsButton: true,
      });
    });
  });

  describe('legacy input', () => {
    it('honors modules.comments: false', () => {
      expect(normalizeUiConfig({ modules: { comments: false } }).comments.enabled).toBe(false);
    });

    it('honors disableContextMenu', () => {
      expect(normalizeUiConfig({ disableContextMenu: true }).contextMenu.enabled).toBe(false);
    });

    it('honors modules.contentControls.chrome: none', () => {
      const ui = normalizeUiConfig({ modules: { contentControls: { chrome: 'none' } } });

      expect(ui.contentControls.enabled).toBe(false);
    });

    it('enables search from modules.surfaces.findReplace', () => {
      expect(normalizeUiConfig({ modules: { surfaces: { findReplace: true } } }).search.enabled).toBe(true);
    });

    it('enables the ruler from the top-level flag and keeps its container', () => {
      const ui = normalizeUiConfig({ rulers: true, rulerContainer: '#ruler' });

      expect(ui.ruler.enabled).toBe(true);
      expect(ui.ruler.container).toBe('#ruler');
    });

    it('prefers the toolbar module selector over the top-level alias', () => {
      const ui = normalizeUiConfig({
        toolbar: '#top-level',
        modules: { toolbar: { selector: '#module' } },
      });

      expect(ui.toolbar.container).toBe('#module');
    });

    it('falls back to the top-level toolbar alias', () => {
      expect(normalizeUiConfig({ toolbar: '#top-level' }).toolbar.container).toBe('#top-level');
    });

    it('layers toolbar icons and texts over the top-level aliases', () => {
      const ui = normalizeUiConfig({
        toolbarIcons: { bold: 'alias-bold', italic: 'alias-italic' },
        toolbarTexts: { bold: 'Alias' },
        modules: { toolbar: { icons: { bold: 'module-bold' } } },
      });

      expect(ui.toolbar.options.icons).toEqual({ bold: 'module-bold', italic: 'alias-italic' });
      expect(ui.toolbar.options.texts).toEqual({ bold: 'Alias' });
    });

    it('reads group ordering from the top-level alias', () => {
      const ui = normalizeUiConfig({ toolbarGroups: ['left', 'center'] });

      expect(ui.toolbar.options.toolbarGroups).toEqual(['left', 'center']);
    });

    it('keeps ordering out of the composition slot', () => {
      // The regression this guards: `toolbarGroups` defaults to
      // `['left','center','right']`, and routing it into `groups` handed the
      // toolbar a composition map whose "item names" were group names. Nothing
      // matched, every item filtered away, and the default toolbar rendered
      // with no buttons at all — the CDN and behavior suites saw a toolbar
      // element with no `btn-bold` inside it.
      const ui = normalizeUiConfig({ toolbar: '#toolbar', toolbarGroups: ['left', 'center', 'right'] });

      expect(ui.toolbar.options.groups).toBeUndefined();
      expect(ui.toolbar.options.toolbarGroups).toEqual(['left', 'center', 'right']);
    });

    it('routes an array passed to ui.toolbar.groups to ordering', () => {
      // `ui.toolbar.groups` accepts either shape, so the shape decides which
      // setting it means rather than the key it arrived under.
      const ui = normalizeUiConfig({ ui: { toolbar: { groups: ['left', 'right'] } } });

      expect(ui.toolbar.options.groups).toBeUndefined();
      expect(ui.toolbar.options.toolbarGroups).toEqual(['left', 'right']);
    });

    it('keeps a legacy composition map when ui.toolbar.groups carries ordering', () => {
      // The mid-migration shape: ordering moved to the new spelling while the
      // composition map is still in the legacy block. Resolving both meanings
      // from whichever `groups` value came first dropped the one that lost, so
      // the configured right-hand buttons silently became the defaults.
      const ui = normalizeUiConfig({
        ui: { toolbar: { groups: ['right'] } },
        modules: { toolbar: { groups: { right: ['bold'] } } },
      });

      expect(ui.toolbar.options.groups).toEqual({ right: ['bold'] });
      expect(ui.toolbar.options.toolbarGroups).toEqual(['right']);
    });

    it('applies an explicit ordering as a filter over the composition map', () => {
      // `BuiltInToolbar.#initToolbarGroups()` rebuilds the group order from
      // `Object.keys(groups)` whenever a composition map is present. Passing
      // the ordering alongside an unfiltered map let that rebuild put the
      // filtered-out groups back, so `left` rendered despite the consumer
      // asking for `right` alone. The map itself has to carry the order.
      const ui = normalizeUiConfig({
        ui: { toolbar: { groups: ['right'] } },
        modules: { toolbar: { groups: { left: ['italic'], right: ['bold'] } } },
      });

      expect(ui.toolbar.options.groups).toEqual({ right: ['bold'] });
      expect(Object.keys(ui.toolbar.options.groups)).toEqual(['right']);
      expect(ui.toolbar.options.toolbarGroups).toEqual(['right']);
    });

    it('applies a top-level selection to the composition map too', () => {
      // `Config.toolbarGroups` is the third spelling of the same selection, so
      // it has to filter the map like the other two. Forwarding it without
      // projecting left every composition key in place, and the toolbar's
      // rebuild put the filtered-out group back.
      const ui = normalizeUiConfig({
        toolbarGroups: ['right'],
        modules: { toolbar: { groups: { left: ['italic'], right: ['bold'] } } },
      });

      expect(Object.keys(ui.toolbar.options.groups)).toEqual(['right']);
    });

    it('ignores inherited names in the selection', () => {
      // `in` walks the prototype chain, so `['constructor', 'right']` used to
      // project `Object.prototype.constructor` in as a group. The toolbar then
      // treats that function as a list of item names and throws while building.
      const ui = normalizeUiConfig({
        ui: { toolbar: { groups: ['constructor', 'right'] } },
        modules: { toolbar: { groups: { right: ['bold'] } } },
      });

      expect(Object.keys(ui.toolbar.options.groups)).toEqual(['right']);
      expect(Object.values(ui.toolbar.options.groups).every(Array.isArray)).toBe(true);
    });

    it('keeps custom groups that no selection could have named', () => {
      // Once defaults are merged the selection always holds the three built-in
      // ids, and an explicit `['left','center','right']` cannot be told apart
      // from that default. Filtering custom names on it would delete groups
      // nobody asked to remove, so only built-in names are ever dropped.
      const defaulted = normalizeUiConfig({
        modules: { toolbar: { groups: { custom: ['bold'] } } },
        toolbarGroups: ['left', 'center', 'right'],
      });
      expect(defaulted.toolbar.options.groups).toEqual({ custom: ['bold'] });

      const selected = normalizeUiConfig({
        ui: { toolbar: { groups: ['right'] } },
        modules: { toolbar: { groups: { right: ['bold'], custom: ['italic'] } } },
      });
      expect(Object.keys(selected.toolbar.options.groups)).toEqual(['right', 'custom']);
    });

    it('routes an object passed to ui.toolbar.groups to composition', () => {
      const ui = normalizeUiConfig({
        ui: { toolbar: { groups: { center: ['bold'] } } },
        toolbarGroups: ['left', 'center'],
      });

      expect(ui.toolbar.options.groups).toEqual({ center: ['bold'] });
      expect(ui.toolbar.options.toolbarGroups).toEqual(['left', 'center']);
    });
  });

  describe('canonical search options', () => {
    it('maps canonical options to the existing Search runtime', () => {
      const ui = normalizeUiConfig({
        ui: {
          search: {
            replaceControls: false,
            includeTrackedDeletions: true,
            strings: {
              findPlaceholder: 'Find in document',
              noResults: 'No matches',
              previousMatchTitle: 'Previous result',
              replaceAll: 'Replace every match',
            },
            floating: { placement: 'bottom-right', autoFocus: false },
          },
        },
      });

      expect(ui.search.options).toEqual({
        replaceEnabled: false,
        includeDeletedText: true,
        findPlaceholder: 'Find in document',
        noResultsLabel: 'No matches',
        previousMatchLabel: 'Previous result',
        replaceAllLabel: 'Replace every match',
        floating: { placement: 'bottom-right', autoFocus: false },
      });
    });

    it('prefers canonical fields when both spellings are present', () => {
      const ui = normalizeUiConfig({
        ui: {
          search: {
            replaceControls: true,
            replaceEnabled: false,
            includeTrackedDeletions: false,
            includeDeletedText: true,
            strings: { noResults: 'No matches' },
            noResultsLabel: 'Nothing found',
          },
        },
      });

      expect(ui.search.options).toEqual({
        replaceEnabled: true,
        includeDeletedText: false,
        noResultsLabel: 'No matches',
      });
    });

    it('keeps legacy fields working while canonical ui options win by key', () => {
      const ui = normalizeUiConfig({
        modules: {
          surfaces: {
            findReplace: {
              replaceEnabled: false,
              includeDeletedText: true,
              noResultsLabel: 'Nothing found',
            },
          },
        },
        ui: {
          search: {
            replaceControls: true,
            strings: { noResults: 'No matches' },
          },
        },
      });

      expect(ui.search.options).toEqual({
        replaceEnabled: true,
        includeDeletedText: true,
        noResultsLabel: 'No matches',
      });
    });
  });

  describe('precedence between ui and legacy input', () => {
    it('lets an explicit ui.search: false beat a leftover legacy field', () => {
      // The migration hazard: an application adds `ui.search: false` but has
      // not yet deleted `modules.surfaces.findReplace`. Reading the legacy
      // field as an opt-in would silently ignore what they just asked for.
      const ui = normalizeUiConfig({ ui: { search: false }, modules: { surfaces: { findReplace: true } } });

      expect(ui.search.enabled).toBe(false);
    });

    it('lets an explicit ui.linkPopover: false beat a leftover resolver', () => {
      const ui = normalizeUiConfig({ ui: { linkPopover: false }, modules: { links: { popoverResolver: () => null } } });

      expect(ui.linkPopover.enabled).toBe(false);
    });

    it('lets an explicit ui.ruler: false beat rulers: true', () => {
      expect(normalizeUiConfig({ ui: { ruler: false }, rulers: true }).ruler.enabled).toBe(false);
    });

    it('treats an undefined nested option as unset rather than an override', () => {
      // Configs assembled from optional properties carry `undefined` values
      // the consumer meant nothing by. A plain spread would read them as
      // deliberate overrides and erase the legacy setting underneath.
      const undefinedOption = undefined;
      const options = normalizeUiConfig({
        ui: { toolbar: { excludeItems: undefinedOption, container: '#t' } },
        modules: { toolbar: { excludeItems: ['fontSize'] } },
      }).toolbar.options;

      expect(options.excludeItems).toEqual(['fontSize']);

      const icons = normalizeUiConfig({
        ui: { toolbar: { icons: { bold: undefinedOption } } },
        toolbarIcons: { bold: 'B' },
      }).toolbar.options.icons;

      expect(icons.bold).toBe('B');
    });

    it('separates a suppressed context menu from a legacy disable', () => {
      // `setDisableContextMenu()` toggles this surface at runtime, and the
      // legacy flag was only a starting value it could flip back. Only an
      // explicit `ui` decision forbids the surface.
      expect(normalizeUiConfig({}).contextMenu.suppressed).toBe(false);
      expect(normalizeUiConfig({ disableContextMenu: true }).contextMenu.suppressed).toBe(false);
      expect(normalizeUiConfig({ ui: { contextMenu: false } }).contextMenu.suppressed).toBe(true);
      expect(normalizeUiConfig({ ui: false }).contextMenu.suppressed).toBe(true);
    });

    it('separates a suppressed link popover from one with no custom resolver', () => {
      // The default config has no resolver, so `enabled` is false while the
      // built-in link editor still opens. Only `suppressed` means "forbidden".
      expect(normalizeUiConfig({}).linkPopover.suppressed).toBe(false);
      expect(normalizeUiConfig({ ui: { linkPopover: false } }).linkPopover.suppressed).toBe(true);
      expect(normalizeUiConfig({ ui: false }).linkPopover.suppressed).toBe(true);
    });

    it('separates a suppressed ruler from one that is merely off', () => {
      // `enabled` is the ruler's starting visibility, which `toggleRuler()`
      // flips at runtime. `suppressed` is the consumer forbidding the surface
      // outright. Collapsing the two would make the historical default
      // (`rulers` unset, toolbar button turns it on) unreachable.
      expect(normalizeUiConfig({}).ruler.suppressed).toBe(false);
      expect(normalizeUiConfig({ rulers: false }).ruler.suppressed).toBe(false);
      expect(normalizeUiConfig({ ui: { ruler: false } }).ruler.suppressed).toBe(true);
      expect(normalizeUiConfig({ ui: false }).ruler.suppressed).toBe(true);
    });

    it('lets an explicit ui.contentControls: true beat legacy chrome: none', () => {
      const ui = normalizeUiConfig({
        ui: { contentControls: true },
        modules: { contentControls: { chrome: 'none' } },
      });

      expect(ui.contentControls.enabled).toBe(true);
    });

    it('lets an explicit ui.comments: true beat modules.comments: false', () => {
      expect(normalizeUiConfig({ ui: { comments: true }, modules: { comments: false } }).comments.enabled).toBe(true);
    });

    it('lets an explicit ui.contextMenu: true beat disableContextMenu', () => {
      const ui = normalizeUiConfig({ ui: { contextMenu: true }, disableContextMenu: true });

      expect(ui.contextMenu.enabled).toBe(true);
    });

    it('keeps a legacy toolbar composition map when ui says nothing', () => {
      // `modules.toolbar.groups` was a group-to-item map, distinct from the
      // `toolbarGroups` ordering array. Reading only the ordering alias
      // dropped the composition entirely.
      const ui = normalizeUiConfig({ modules: { toolbar: { groups: { center: ['bold'] } } } });

      expect(ui.toolbar.options.groups).toEqual({ center: ['bold'] });
    });

    it('still opts in from a legacy field when ui says nothing', () => {
      expect(normalizeUiConfig({ modules: { surfaces: { findReplace: true } } }).search.enabled).toBe(true);
      expect(normalizeUiConfig({ rulers: true }).ruler.enabled).toBe(true);
    });

    it('lets ui.comments: false override an enabling legacy block', () => {
      const ui = normalizeUiConfig({ ui: { comments: false }, modules: { comments: {} } });

      expect(ui.comments.enabled).toBe(false);
    });

    it('lets modules.comments: false win when ui says nothing about comments', () => {
      const ui = normalizeUiConfig({ ui: { search: true }, modules: { comments: false } });

      expect(ui.comments.enabled).toBe(false);
      expect(ui.search.enabled).toBe(true);
    });
  });

  describe('input tolerance', () => {
    it('accepts no argument at all', () => {
      expect(normalizeUiConfig().enabled).toBe(true);
    });

    it('ignores a non-object ui value rather than throwing', () => {
      // `ui: true` is not part of the contract; it must not read as "enable
      // everything", which would turn on surfaces that default to off.
      const ui = normalizeUiConfig({ ui: true });

      expect(ui.enabled).toBe(true);
      expect(ui.search.enabled).toBe(false);
      expect(ui.comments.enabled).toBe(true);
    });
  });
});
