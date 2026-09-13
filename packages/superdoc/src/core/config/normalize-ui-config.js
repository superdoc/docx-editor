/**
 * The one place that decides which built-in UI SuperDoc renders.
 *
 * Today that decision is spread across `Config.modules.*`, four top-level
 * toolbar aliases, `disableContextMenu`, `rulers`, and two entries under
 * `modules.surfaces` — read directly at roughly forty call sites. This module
 * collapses all of it into a single normalized object so the rest of the
 * runtime can ask one question instead of re-deriving precedence per surface.
 *
 * The rules it encodes:
 *
 *   - `ui` omitted preserves today's behavior exactly, including its
 *     asymmetries. Comments are on and the toolbar is off unless it is given
 *     somewhere to mount. That is not a tidy default profile, but changing it
 *     silently would break working applications, so it is reproduced as-is.
 *   - `ui: false` renders no built-in chrome. It is an explicit
 *     no-built-in-UI profile, not the inverse of a hypothetical `ui: true`,
 *     and it never disables document content, the Document API, or
 *     `superdoc.ui`.
 *   - `ui: { ... }` opts in per surface. An omitted key keeps that surface's
 *     historical default rather than inheriting from its siblings.
 *
 * AIDEV-NOTE: legacy-public - the `modules.*` built-in UI spellings shipped in
 * stable 2.3.0 and stay supported for all of v2, so these branches are load
 * bearing rather than scaffolding. Every built-in surface now has a canonical
 * path: use `ui.*`, `interaction.*`, `surfaces.*`, or `hyperlinks.*`, with
 * comment policy on `interaction.comments` and hyperlink activation on
 * `hyperlinks.onActivate`. Earliest removal: v3.0.
 */

import { firstDefined, mergeDefined } from './merge-defined.js';
import { normalizeCommentsUiConfig } from '../../helpers/comment-small-screen.js';
import { TOOLBAR_ITEM_ALIASES } from '../../internal/toolbar/toolbar-item-aliases.js';

/** Surfaces that render when the consumer says nothing at all. */
const HISTORICAL_DEFAULTS = Object.freeze({
  // A toolbar needs a mount target, so "on" here still renders nothing until
  // `container` resolves. Kept separate from `container` so `ui.toolbar: false`
  // can suppress a toolbar that a top-level alias would otherwise mount.
  toolbar: true,
  comments: true,
  contextMenu: true,
  // The blocking loader the document renders behind while it opens.
  loading: true,
  // Opt-in surfaces: historically off unless configured.
  search: false,
  linkPopover: false,
  ruler: false,
  contentControls: true,
});

/**
 * The group ids the built-in toolbar ships with, which is also what
 * `Config.toolbarGroups` defaults to.
 *
 * Used to tell a group the consumer left out of a selection apart from one the
 * selection could never have named. Anything outside this set is a custom
 * group and survives filtering.
 */
const DEFAULT_TOOLBAR_GROUP_IDS = Object.freeze(['left', 'center', 'right']);

// Includes the two horizontal margin pixels on `ToolbarButton`. The rendered
// width is derived from this same value below, so responsive layout never has
// to guess from a custom label.
const CUSTOM_TOOLBAR_ITEM_WIDTHS = Object.freeze({ compact: 32, default: 80, wide: 120 });

/** Every built-in surface `ui: false` turns off. */
const BUILT_IN_SURFACES = Object.freeze(Object.keys(HISTORICAL_DEFAULTS));

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read a surface's enabled state from a `ui` block.
 *
 * `false` disables, `true` or an options object enables, and `undefined`
 * falls through to the historical default so partial configs stay additive.
 *
 * @param {Record<string, unknown> | undefined} ui
 * @param {string} key
 * @returns {boolean}
 */
function resolveSurface(ui, key) {
  const value = ui?.[key];
  if (value === false) return false;
  if (value === undefined) return HISTORICAL_DEFAULTS[key];
  return true;
}

/**
 * Per-surface options, if the consumer passed an object rather than a flag.
 *
 * @param {Record<string, unknown> | undefined} ui
 * @param {string} key
 * @returns {Record<string, unknown>}
 */
function resolveOptions(ui, key) {
  const value = ui?.[key];
  return isPlainObject(value) ? value : {};
}

/**
 * Fields that decide what a user may do, not what SuperDoc draws.
 *
 * They resolve through `normalizeInteractionConfig` and are assigned onto the
 * live `modules.comments` block, which is also where the comments store and
 * dialog read them. Letting them ride along in the presentation bag would let
 * a value in the wrong bucket win over the resolved policy for anything
 * reading the merged view, so they are dropped here and the consumer keeps
 * seeing the authoritative ones underneath.
 *
 * `permissionResolver` is resolved separately from the canonical top-level
 * field and its deprecated `modules.comments` fallback.
 */
const COMMENT_POLICY_FIELDS = Object.freeze(['level', 'readOnly', 'allowResolve', 'permissionResolver']);

/**
 * Drop policy fields from a presentation options bag.
 *
 * @param {Record<string, unknown>} options
 * @returns {Record<string, unknown>}
 */
function withoutCommentPolicy(options) {
  if (!COMMENT_POLICY_FIELDS.some((field) => field in options)) return options;
  const presentation = { ...options };
  for (const field of COMMENT_POLICY_FIELDS) delete presentation[field];
  return presentation;
}

/**
 * Resolve renamed context-menu fields within one config source.
 *
 * Normalizing before the legacy/canonical source merge preserves the source
 * precedence during partial migrations. For example, `ui.contextMenu.customItems`
 * must beat `modules.contextMenu.sections` even though the former uses the old
 * field name.
 *
 * @param {Record<string, unknown>} options
 * @returns {Record<string, unknown>}
 */
function normalizeContextMenuOptions(options) {
  const normalized = { ...options };
  const sections = firstDefined(options.sections, options.customItems);
  const defaultItems = firstDefined(options.defaultItems, options.includeDefaultItems);

  delete normalized.customItems;
  delete normalized.includeDefaultItems;

  return mergeDefined(normalized, { sections, defaultItems });
}

const SEARCH_STRING_KEYS = Object.freeze({
  findPlaceholder: 'findPlaceholder',
  findAriaLabel: 'findAriaLabel',
  replacePlaceholder: 'replacePlaceholder',
  replaceAriaLabel: 'replaceAriaLabel',
  noResults: 'noResultsLabel',
  previousMatchTitle: 'previousMatchLabel',
  previousMatchAriaLabel: 'previousMatchAriaLabel',
  nextMatchTitle: 'nextMatchLabel',
  nextMatchAriaLabel: 'nextMatchAriaLabel',
  closeTitle: 'closeLabel',
  closeAriaLabel: 'closeAriaLabel',
  replace: 'replaceLabel',
  replaceAll: 'replaceAllLabel',
  toggleReplaceTitle: 'toggleReplaceLabel',
  toggleReplaceAriaLabel: 'toggleReplaceAriaLabel',
  matchCase: 'matchCaseLabel',
  matchCaseAriaLabel: 'matchCaseAriaLabel',
  ignoreDiacritics: 'ignoreDiacriticsLabel',
  ignoreDiacriticsAriaLabel: 'ignoreDiacriticsAriaLabel',
  regex: 'regexLabel',
  regexAriaLabel: 'regexAriaLabel',
  invalidPattern: 'invalidPatternLabel',
});

function normalizeSearchStrings(strings) {
  if (!isPlainObject(strings)) return {};
  return Object.fromEntries(
    Object.entries(strings)
      .filter(([key, value]) => SEARCH_STRING_KEYS[key] !== undefined && value !== undefined)
      .map(([key, value]) => [SEARCH_STRING_KEYS[key], value]),
  );
}

function normalizeSearchOptions(options) {
  const normalized = { ...options };
  delete normalized.strings;
  delete normalized.replaceControls;
  delete normalized.includeTrackedDeletions;

  return mergeDefined(normalized, normalizeSearchStrings(options.strings), {
    replaceEnabled: firstDefined(options.replaceControls, options.replaceEnabled),
    includeDeletedText: firstDefined(options.includeTrackedDeletions, options.includeDeletedText),
  });
}

const TOOLBAR_ICON_ALIASES = Object.freeze({
  'text-color': 'color',
  'table-of-contents': 'tableOfContents',
  'align-left': 'alignLeft',
  'align-right': 'alignRight',
  'align-center': 'alignCenter',
  'align-justify': 'alignJustify',
  'bullet-list': 'bulletList',
  'numbered-list': 'numberedList',
  'indent-decrease': 'indentLeft',
  'indent-increase': 'indentRight',
  'copy-format': 'copyFormat',
  'clear-formatting': 'clearFormatting',
  'track-changes-accept-selection': 'trackChangesAccept',
  'track-changes-reject-selection': 'trackChangesReject',
  'document-mode': 'documentMode',
  'document-mode-editing': 'documentEditingMode',
  'document-mode-suggesting': 'documentSuggestingMode',
  'document-mode-viewing': 'documentViewingMode',
  'highlight-color': 'highlight',
  'linked-style': 'paintbrush',
  'table-actions': 'tableActions',
  'split-cell': 'splitCell',
  'merge-cells': 'mergeCells',
  'insert-row-before': 'addRowBefore',
  'insert-row-after': 'addRowAfter',
  'insert-column-before': 'addColumnBefore',
  'insert-column-after': 'addColumnAfter',
  'delete-row': 'deleteRow',
  'delete-column': 'deleteColumn',
  'delete-table': 'deleteTable',
  'remove-borders': 'deleteBorders',
  'fix-tables': 'fixTables',
  'line-height': 'lineHeight',
  'formatting-marks': 'formattingMarks',
});

const TOOLBAR_STRING_ALIASES = Object.freeze({
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'highlight-color': 'highlight',
  'text-color': 'color',
  'table-of-contents': 'tableOfContents',
  'table-actions': 'tableActions',
  'insert-row-before': 'addRowBefore',
  'insert-row-after': 'addRowAfter',
  'insert-column-before': 'addColumnBefore',
  'insert-column-after': 'addColumnAfter',
  'delete-row': 'deleteRow',
  'delete-column': 'deleteColumn',
  'delete-table': 'deleteTable',
  'remove-borders': 'removeBorders',
  'merge-cells': 'mergeCells',
  'split-cell': 'splitCell',
  'fix-tables': 'fixTables',
  'text-align': 'textAlign',
  'bullet-list': 'bulletList',
  'numbered-list': 'numberedList',
  'indent-decrease': 'indentLeft',
  'indent-increase': 'indentRight',
  'measurement-unit': 'measurementUnit',
  'track-changes-accept-selection': 'trackChangesAccept',
  'track-changes-reject-selection': 'trackChangesReject',
  'clear-formatting': 'clearFormatting',
  'copy-format': 'copyFormat',
  'line-height': 'lineHeight',
  'linked-style-label': 'formatText',
  'formatting-marks': 'formattingMarks',
  'document-mode-editing': 'documentEditingMode',
  'document-mode-suggesting': 'documentSuggestingMode',
  'document-mode-viewing': 'documentViewingMode',
  'document-mode-editing-description': 'documentEditingModeDescription',
  'document-mode-suggesting-description': 'documentSuggestingModeDescription',
  'document-mode-viewing-description': 'documentViewingModeDescription',
  'linked-style': 'linkedStyles',
});

function mapToolbarKey(key, aliases) {
  return aliases[key] ?? key;
}

function mapToolbarRecord(record, aliases) {
  if (!isPlainObject(record)) return undefined;
  const entries = Object.entries(record);
  const passthroughEntries = entries.filter(([key]) => aliases[key] === undefined);
  const aliasedEntries = entries.filter(([key]) => aliases[key] !== undefined);
  return Object.fromEntries(
    [...passthroughEntries, ...aliasedEntries].map(([key, value]) => [mapToolbarKey(key, aliases), value]),
  );
}

function mapToolbarItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => mapToolbarKey(item, TOOLBAR_ITEM_ALIASES));
}

function mapToolbarRegions(regions) {
  if (!isPlainObject(regions)) return regions;
  return Object.fromEntries(Object.entries(regions).map(([region, items]) => [region, mapToolbarItems(items)]));
}

function addCustomItemRegions(regions, customItems) {
  if (!isPlainObject(regions) || !Array.isArray(customItems)) return regions;
  const result = { ...regions };
  for (const item of customItems) {
    if (!isPlainObject(item)) continue;
    const region = item.region ?? 'center';
    if (result[region] === undefined) result[region] = [];
  }
  return result;
}

const TOOLBAR_OPTIONAL_ITEM_REGIONS = Object.freeze({
  'formatting-marks': 'right',
  'table-of-contents': 'center',
});

function addIncludedToolbarItems(regions, includeItems) {
  if (!isPlainObject(regions) || !Array.isArray(includeItems)) return regions;

  const result = Object.fromEntries(
    Object.entries(regions).map(([region, items]) => [region, Array.isArray(items) ? [...items] : items]),
  );
  const configuredItems = new Set(
    Object.values(result)
      .flatMap((items) => (Array.isArray(items) ? items : []))
      .map((item) => mapToolbarKey(item, TOOLBAR_ITEM_ALIASES)),
  );

  for (const item of includeItems) {
    const mappedItem = mapToolbarKey(item, TOOLBAR_ITEM_ALIASES);
    if (configuredItems.has(mappedItem)) continue;
    const region = TOOLBAR_OPTIONAL_ITEM_REGIONS[item];
    if (!region) continue;
    if (!Array.isArray(result[region])) result[region] = [];
    result[region].push(item);
    configuredItems.add(mappedItem);
  }

  return result;
}

function extendToolbarRegions(regions, options) {
  return addCustomItemRegions(addIncludedToolbarItems(regions, options.includeItems), options.customItems);
}

function mapToolbarFontOptions(options) {
  if (!Array.isArray(options)) return options;
  return options.map((option) => {
    if (!isPlainObject(option)) return option;
    const { value, label, previewFamily } = option;
    return {
      key: value,
      value,
      label,
      ...(previewFamily ? { props: { style: { fontFamily: previewFamily } } } : {}),
    };
  });
}

function mapToolbarCustomItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!isPlainObject(item) || typeof item.id !== 'string') return item;

    const size = item.size ?? 'default';
    const layoutWidth = item.type === 'separator' ? undefined : CUSTOM_TOOLBAR_ITEM_WIDTHS[size];
    const mapped = {
      ...item,
      name: item.id,
      group: item.region,
      isNarrow: size === 'compact',
      isWide: size === 'wide',
      ...(layoutWidth
        ? {
            layoutWidth,
            style: { ...item.style, width: `${layoutWidth - 2}px` },
          }
        : {}),
    };

    if (item.label) {
      if (mapped.defaultLabel === undefined) mapped.defaultLabel = item.label;
      mapped.attributes = {
        ...item.attributes,
        ariaLabel: item.attributes?.ariaLabel ?? item.label,
      };
    }

    if (item.type === 'dropdown' && Array.isArray(item.options)) {
      mapped.options = item.options.map((option) => {
        if (!isPlainObject(option)) return option;
        return {
          ...option,
          key: option.value ?? option.id,
          value: option.value ?? option.id,
        };
      });
      mapped.dropdownValueKey = 'value';
    }

    if (typeof item.onSelect === 'function') {
      mapped.command = ({ item: _item, argument, payload: _payload, ...context }) =>
        item.onSelect({ ...context, value: argument });
    }

    delete mapped.id;
    delete mapped.region;
    delete mapped.size;
    delete mapped.onSelect;
    return mapped;
  });
}

function normalizeToolbarOptions(options) {
  const normalized = { ...options };
  const configuredItems = firstDefined(options.items, isPlainObject(options.groups) ? options.groups : undefined);
  const items =
    isPlainObject(options.items) && Object.keys(options.items).length === 0 ? { center: [] } : configuredItems;
  const groupedItems = extendToolbarRegions(items, options);
  const groups = groupedItems === undefined ? options.groups : mapToolbarRegions(groupedItems);
  const icons = mapToolbarRecord(options.icons, TOOLBAR_ICON_ALIASES);
  const texts = mergeDefined(
    mapToolbarRecord(options.texts, {}),
    mapToolbarRecord(options.strings, TOOLBAR_STRING_ALIASES),
  );
  const includeItems = Array.isArray(options.includeItems) ? new Set(options.includeItems) : null;
  const itemIds = isPlainObject(items)
    ? new Set(Object.values(items).flatMap((regionItems) => (Array.isArray(regionItems) ? regionItems : [])))
    : new Set();

  delete normalized.items;
  delete normalized.includeItems;
  delete normalized.overflow;
  delete normalized.responsiveTo;
  delete normalized.fontOptions;
  delete normalized.customItems;
  delete normalized.strings;

  return mergeDefined(normalized, {
    groups,
    excludeItems: mapToolbarItems(options.excludeItems),
    icons,
    texts,
    hideButtons: options.overflow === undefined ? options.hideButtons : options.overflow === 'menu',
    responsiveToContainer:
      options.responsiveTo === undefined ? options.responsiveToContainer : options.responsiveTo === 'container',
    fonts: options.fontOptions === undefined ? options.fonts : mapToolbarFontOptions(options.fontOptions),
    customButtons:
      options.customItems === undefined ? options.customButtons : mapToolbarCustomItems(options.customItems),
    showFormattingMarksButton:
      includeItems === null && !itemIds.has('formatting-marks')
        ? options.showFormattingMarksButton
        : itemIds.has('formatting-marks') || includeItems?.has('formatting-marks'),
    showTableOfContentsButton:
      includeItems === null && !itemIds.has('table-of-contents')
        ? options.showTableOfContentsButton
        : itemIds.has('table-of-contents') || includeItems?.has('table-of-contents'),
  });
}

/**
 * Collapse a consumer config into the effective built-in UI profile.
 *
 * @param {Record<string, any>} [config] Raw consumer config.
 * @returns {{
 *   enabled: boolean,
 *   toolbar: { enabled: boolean, container: string | HTMLElement | null, options: Record<string, unknown> },
 *   comments: { enabled: boolean, options: Record<string, unknown> },
 *   contextMenu: { enabled: boolean, suppressed: boolean, options: Record<string, unknown> },
 *   loading: { enabled: boolean },
 *   search: { enabled: boolean, options: Record<string, unknown> },
 *   linkPopover: { enabled: boolean, suppressed: boolean, options: Record<string, unknown> },
 *   ruler: { enabled: boolean, suppressed: boolean, container: string | HTMLElement | null },
 *   contentControls: { enabled: boolean, options: Record<string, unknown> },
 * }}
 */
export function normalizeUiConfig(config = {}) {
  const raw = config.ui;

  // `ui: false` is the only input that suppresses everything at once. An
  // object or an omitted value both resolve per surface.
  const allDisabled = raw === false;
  const ui = isPlainObject(raw) ? raw : undefined;

  const enabled = (key) => !allDisabled && resolveSurface(ui, key);
  // `undefined` when the consumer said nothing about a surface, so a caller can
  // tell "unset" apart from "explicitly off" and let the explicit value win
  // over a legacy field that would otherwise re-enable it.
  const explicit = (key) => {
    if (allDisabled) return false;
    return ui?.[key] === undefined ? undefined : resolveSurface(ui, key);
  };
  const options = (key) => (allDisabled ? {} : resolveOptions(ui, key));

  const rulerSuppressed = allDisabled || explicit('ruler') === false;
  const linkPopoverSuppressed = allDisabled || explicit('linkPopover') === false;
  // Legacy under canonical, the same precedence every other surface uses. A
  // suppressed surface resolves to no resolver at all: the shell answers
  // `suppressed` with a resolver that closes the popover, and handing back a
  // live one beside it invites a caller to run it anyway.
  const linkPopoverResolver = linkPopoverSuppressed
    ? undefined
    : firstDefined(options('linkPopover').popoverResolver, config.modules?.links?.popoverResolver);
  const contentControlsEnabled =
    explicit('contentControls') ?? (!allDisabled && config.modules?.contentControls?.chrome !== 'none');
  // `'none'` is the legacy disable sentinel, not a style, and `enabled` above
  // has already consumed it. Carrying it forward as a style would let a
  // leftover legacy value outrank an explicit `ui.contentControls` opt-in.
  const legacyContentControlsChrome =
    config.modules?.contentControls?.chrome === 'none' ? undefined : config.modules?.contentControls?.chrome;
  const rawToolbarOptions = options('toolbar');
  const toolbarOptions = normalizeToolbarOptions(rawToolbarOptions);
  const hasCanonicalToolbarItems = isPlainObject(rawToolbarOptions.items);
  const legacyToolbar = config.modules?.toolbar;
  const legacyToolbarOptions = isPlainObject(legacyToolbar) ? legacyToolbar : {};
  // `modules.slashMenu` is the older spelling of `modules.contextMenu`; the
  // shell warns about it and prefers the newer one, so the same order applies
  // here. Only object forms carry options — the boolean sentinels are
  // enable/disable decisions that `enabled` and `suppressed` already resolve.
  const legacyContextMenuRaw = config.modules?.contextMenu ?? config.modules?.slashMenu;
  const legacyContextMenu = isPlainObject(legacyContextMenuRaw) ? legacyContextMenuRaw : {};
  const legacySearchRaw = config.modules?.surfaces?.findReplace;
  const legacySearch = normalizeSearchOptions(isPlainObject(legacySearchRaw) ? legacySearchRaw : {});

  // Composition and ordering are two settings with two shapes, and collapsing
  // them into one field is what broke the default toolbar. `groups` maps a
  // group name to the item names inside it; `toolbarGroups` selects which
  // groups render. The latter is a membership list rather than a sort order:
  // `Toolbar.vue` lays groups out left, center, right, and renders center
  // whether or not it is listed. `toolbarGroups` defaults to `['left','center',
  // 'right']`, so letting it fall through into the composition slot handed the
  // toolbar an item list naming three groups. No item is named after a group,
  // every item filtered away, and the toolbar rendered with no buttons.
  //
  // `ui.toolbar.groups` still accepts either shape, so route by shape: an
  // array is ordering, an object is composition.
  //
  // Each is resolved across both sources independently rather than picking one
  // source for both. Mid-migration a config can set ordering in the new
  // spelling while its composition map is still in the legacy block, and
  // taking the first `groups` value for both meanings drops whichever one lost.
  // Canonical additions extend a legacy composition map during a gradual
  // migration. Without this merge, the later legacy fallback restores the map
  // but silently drops the added controls and custom-item regions.
  const legacyToolbarGroups = isPlainObject(legacyToolbarOptions.groups)
    ? mapToolbarRegions(extendToolbarRegions(legacyToolbarOptions.groups, rawToolbarOptions))
    : legacyToolbarOptions.groups;
  const groupCandidates = [toolbarOptions.groups, legacyToolbarGroups];
  const composedGroups = groupCandidates.find(isPlainObject);
  const orderedGroups = groupCandidates.find(Array.isArray);

  // Every spelling of the selection, including the top-level alias.
  const selectedGroups = hasCanonicalToolbarItems
    ? Object.keys(toolbarOptions.groups ?? {})
    : firstDefined(orderedGroups, legacyToolbarOptions.toolbarGroups, config.toolbarGroups);
  const selection = Array.isArray(selectedGroups) ? selectedGroups : null;

  // `BuiltInToolbar.#initToolbarGroups()` rebuilds the group list from
  // `Object.keys(groups)` whenever a composition map is present, which would
  // undo the selection above and render groups the consumer left out. Project
  // the map onto the selection so its key order carries the intent and the
  // rebuild becomes a no-op.
  //
  // A key is dropped only when it names a built-in group the selection omits.
  // Custom group names are always kept: once defaults are merged the selection
  // always holds the three built-in ids, and an explicit `['left','center',
  // 'right']` is indistinguishable from that default, so filtering on it would
  // delete custom groups nobody asked to remove. The cost is that an explicit
  // selection cannot drop a custom group, which is the safer way to be wrong.
  //
  // `hasOwnProperty` rather than `in`: `in` walks the prototype chain, so a
  // selection naming `constructor` would project a function into the map and
  // crash the toolbar when it treats that value as a list of item names.
  // Matches the `Object.hasOwn` avoidance elsewhere in this directory, which
  // is ES2022 and outside what this package targets.
  const ownGroup = (map, group) => Object.prototype.hasOwnProperty.call(map, group);
  const projectedGroups =
    composedGroups && selection
      ? Object.fromEntries(
          [
            ...selection.filter((group) => ownGroup(composedGroups, group)),
            ...Object.keys(composedGroups).filter((group) => !DEFAULT_TOOLBAR_GROUP_IDS.includes(group)),
          ].map((group) => [group, composedGroups[group]]),
        )
      : composedGroups;

  return {
    // False only when the consumer asked for no built-in UI at all. Callers
    // use this for the coarse "does SuperDoc own any chrome" question; the
    // per-surface flags below stay authoritative for rendering.
    enabled: !allDisabled,

    toolbar: {
      enabled: enabled('toolbar'),
      // Precedence preserved from the current runtime: the toolbar block's own
      // target wins, then the top-level alias.
      // `ui: false` means no built-in chrome, so the toolbar reports nothing to
      // mount into. `enabled` already gates every caller, but handing back a
      // live container for a surface that cannot render invites acting on it.
      container: allDisabled
        ? null
        : (firstDefined(toolbarOptions.container, legacyToolbarOptions.selector, config.toolbar) ?? null),
      // `mergeDefined` rather than spread throughout: a config assembled from
      // optional properties carries `undefined` values that a spread would
      // treat as deliberate overrides, erasing the legacy setting underneath.
      options: allDisabled
        ? {}
        : {
            ...mergeDefined(legacyToolbarOptions, toolbarOptions),
            // Composition only. `undefined` here means "no override", which is
            // what makes the toolbar render its full default item set.
            groups: projectedGroups,
            // Selection only, in the same precedence the runtime always used.
            toolbarGroups: selectedGroups,
            icons: mergeDefined(config.toolbarIcons, legacyToolbarOptions.icons, toolbarOptions.icons),
            texts: mergeDefined(config.toolbarTexts, legacyToolbarOptions.texts, toolbarOptions.texts),
          },
    },

    comments: {
      // An explicit `ui.comments` wins; `modules.comments: false` only
      // disables when the consumer said nothing in the new shape.
      enabled: explicit('comments') ?? (!allDisabled && config.modules?.comments !== false),
      // Presentation settings only. `modules.comments` also carries interaction
      // policy and collaboration state, and the runtime keeps mutating that
      // object after this runs, so the live block stays the base layer and the
      // consumer merges this over it rather than the other way around. Policy
      // is stripped rather than merged: it resolves through the interaction
      // profile, and a copy here would outrank it in the merged view.
      //
      // Validate this block with the same rules used for `modules.comments` so
      // invalid canonical values cannot reach the layout code.
      options: allDisabled ? {} : normalizeCommentsUiConfig(withoutCommentPolicy(options('comments'))),
    },

    contextMenu: {
      // Same rule. `disableContextMenu` is a negative legacy flag, so it can
      // only suppress, and only when `ui.contextMenu` is unset.
      enabled: explicit('contextMenu') ?? (!allDisabled && config.disableContextMenu !== true),
      // Same split as the ruler. `setDisableContextMenu()` toggles this surface
      // at runtime, and the legacy `disableContextMenu` was only ever a
      // starting value that the toggle could flip back. Only an explicit
      // `ui` decision forbids the surface outright.
      suppressed: allDisabled || explicit('contextMenu') === false,
      // Resolve renamed fields inside each source before putting canonical UI
      // over legacy modules. This keeps source precedence intact even when an
      // application migrates the location and field names in separate releases.
      options: allDisabled
        ? {}
        : mergeDefined(
            normalizeContextMenuOptions(legacyContextMenu),
            normalizeContextMenuOptions(options('contextMenu')),
          ),
    },

    loading: {
      // No legacy spelling to reconcile: the loader has only ever been on, so
      // the historical default carries it and `ui.loading` / `ui: false` are
      // the only inputs that turn it off.
      //
      // Presentation only. The loader's visibility is still owned by the host's
      // readiness model; this decides whether SuperDoc draws anything for it.
      enabled: enabled('loading'),
    },

    search: {
      // An explicit `ui.search` is authoritative. The legacy field only opts
      // in when the consumer said nothing, so `ui.search: false` alongside a
      // leftover `modules.surfaces.findReplace` disables the surface rather
      // than being silently overridden.
      enabled: explicit('search') ?? (!allDisabled && Boolean(config.modules?.surfaces?.findReplace)),
      // `modules.surfaces.findReplace` is `true | object | undefined`, and the
      // `true` sentinel only ever meant "on with defaults", so it contributes
      // no options — `enabled` above already carries that decision.
      options: allDisabled ? {} : mergeDefined(legacySearch, normalizeSearchOptions(options('search'))),
    },

    linkPopover: {
      // Same split as the ruler, for the same reason. `enabled` here means
      // "a custom resolver is configured", which is false for the default
      // config that still opens the built-in link editor. Only `suppressed`
      // answers "the consumer forbade this surface".
      //
      // Read off the resolved resolver rather than the presence of the
      // canonical key. `ui.linkPopover: true` turns a surface on and supplies
      // nothing to run, and reporting that as configured is what let an inert
      // options bag look wired from every angle the profile exposes (#1099).
      enabled: typeof linkPopoverResolver === 'function',
      suppressed: linkPopoverSuppressed,
      options: mergeDefined(options('linkPopover'), { popoverResolver: linkPopoverResolver }),
    },

    ruler: {
      enabled: explicit('ruler') ?? (!allDisabled && Boolean(config.rulers)),
      // The ruler is the one surface with a runtime toggle, so "off" and
      // "forbidden" have to stay distinct. `enabled` is only the starting
      // visibility that `toggleRuler()` flips; `suppressed` is the consumer
      // saying the surface may not appear at all. Treating the historical
      // default (`rulers` unset) as suppression would make the toolbar's
      // ruler button and `SuperDoc.toggleRuler()` permanently inert.
      suppressed: rulerSuppressed,
      // A suppressed ruler reports no mount target, for the same reason the
      // toolbar does: handing back a live container for a surface that cannot
      // render invites a caller to act on it.
      container: rulerSuppressed ? null : (options('ruler').container ?? config.rulerContainer ?? null),
    },

    contentControls: {
      // Same precedence as the other surfaces: an explicit `ui.contentControls`
      // is authoritative, and the legacy `chrome: 'none'` only suppresses when
      // the consumer said nothing in the new shape.
      enabled: contentControlsEnabled,
      // `chrome` is resolved here rather than at the reader, like every other
      // surface's options, so the layout engine gets one answer instead of
      // re-deriving precedence. A disabled surface reports `'none'` because
      // `undefined` means "keep the engine default", which draws chrome.
      // An absent `chrome` on an enabled surface stays absent for that reason.
      //
      // Nothing else survives the disabled branch: options only exist when
      // `ui.contentControls` is an object, and that spelling always enables.
      options: contentControlsEnabled
        ? mergeDefined({ chrome: legacyContentControlsChrome }, options('contentControls'))
        : { chrome: 'none' },
    },
  };
}

export { BUILT_IN_SURFACES, HISTORICAL_DEFAULTS };
